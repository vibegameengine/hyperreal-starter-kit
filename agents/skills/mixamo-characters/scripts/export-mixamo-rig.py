import os
import re
import struct
import sys
import zlib

import bpy
from mathutils import Vector

ROOT_NAME = "root"
PELVIS_NAMES = ("mixamorig:Hips", "mixamorig1:Hips", "Hips")
CM_PER_M = 100.0


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) < 2:
        raise SystemExit("usage: blender -b --factory-startup -P export-mixamo-rig.py -- <input.fbx|input.blend> <output.fbx>")
    return args[0], args[1]


def load(source):
    if source.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=source)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=source)
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if len(armatures) != 1:
        raise SystemExit(f"expected one armature, found {len(armatures)}")
    arm = armatures[0]
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and (o.parent is arm or any(m.type == "ARMATURE" and m.object is arm for m in o.modifiers))]
    if not meshes:
        raise SystemExit("no mesh is skinned to the armature")
    return arm, meshes


def pelvis_name(arm):
    for name in PELVIS_NAMES:
        if name in arm.data.bones:
            return name
    raise SystemExit("no Hips bone in the armature")


def apply_transforms(objects, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def to_centimetres(arm, meshes):
    units = bpy.context.scene.unit_settings
    already_cm = abs(units.scale_length - 0.01) < 1e-6
    apply_transforms([arm, *meshes], arm)
    if not already_cm:
        units.system = "METRIC"
        units.scale_length = 0.01
        units.length_unit = "CENTIMETERS"
        arm.scale = (CM_PER_M, CM_PER_M, CM_PER_M)
        bpy.context.view_layer.update()
        apply_transforms([arm, *meshes], arm)


def add_root(arm, pelvis):
    if pelvis_parent(arm, pelvis) == ROOT_NAME:
        return
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    bones = arm.data.edit_bones
    root = bones.new(ROOT_NAME)
    length = (bones[pelvis].head.z or 100.0) * 0.2
    root.head = Vector((0.0, 0.0, 0.0))
    root.tail = Vector((0.0, 0.0, length))
    root.use_deform = True
    bones[pelvis].parent = root
    bones[pelvis].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")


def pelvis_parent(arm, pelvis):
    parent = arm.data.bones[pelvis].parent
    return parent.name if parent else None


def save_textures(meshes, folder):
    os.makedirs(folder, exist_ok=True)
    saved = []
    for o in meshes:
        for slot in o.material_slots:
            if not slot.material or not slot.material.use_nodes:
                continue
            for node in slot.material.node_tree.nodes:
                if node.type != "TEX_IMAGE" or not node.image or node.image.name in {s[0] for s in saved}:
                    continue
                image = node.image
                if image.size[0] == 0:
                    print(f"TEXTURE skipped {image.name}: no pixel data")
                    continue
                stem = re.sub(r"[^\w\-]", "_", image.name.rsplit(".", 1)[0])
                path = os.path.join(folder, stem + ".png")
                image.filepath_raw = path
                image.file_format = "PNG"
                image.save()
                saved.append((image.name, path))
    return saved


def export(arm, meshes, target):
    bpy.ops.object.select_all(action="DESELECT")
    for o in (arm, *meshes):
        o.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=target,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",
        global_scale=1.0,
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        use_armature_deform_only=False,
        bake_anim=False,
        mesh_smooth_type="FACE",
        embed_textures=True,
        path_mode="COPY",
    )


def read_fbx(path):
    data = open(path, "rb").read()
    version = struct.unpack_from("<I", data, 23)[0]
    fmt = "<QQQ" if version >= 7500 else "<III"
    simple = {"Y": "<h", "C": "<?", "I": "<i", "F": "<f", "D": "<d", "L": "<q"}
    arrays = {"f": "f", "d": "d", "l": "q", "i": "i", "b": "?"}

    def prop(pos):
        code = chr(data[pos])
        pos += 1
        if code in simple:
            return struct.unpack_from(simple[code], data, pos)[0], pos + struct.calcsize(simple[code])
        if code in arrays:
            count, encoding, length = struct.unpack_from("<III", data, pos)
            raw = data[pos + 12:pos + 12 + length]
            raw = zlib.decompress(raw) if encoding == 1 else raw
            return list(struct.unpack("<%d%s" % (count, arrays[code]), raw)), pos + 12 + length
        length = struct.unpack_from("<I", data, pos)[0]
        raw = data[pos + 4:pos + 4 + length]
        return (raw.decode("utf-8", "replace") if code == "S" else raw), pos + 4 + length

    def node(pos):
        end, count, _ = struct.unpack_from(fmt, data, pos)
        pos += struct.calcsize(fmt)
        if end == 0:
            return None, pos
        name = data[pos + 1:pos + 1 + data[pos]].decode()
        pos += 1 + data[pos]
        props = []
        for _ in range(count):
            value, pos = prop(pos)
            props.append(value)
        children = []
        while pos < end:
            child, pos = node(pos)
            if child is None:
                break
            children.append(child)
        return (name, props, children), end

    roots, pos = [], 27
    while pos < len(data) - 160:
        found, pos = node(pos)
        if found is None:
            break
        roots.append(found)
    return data, roots


def check(path, pelvis, textures):
    data, roots = read_fbx(path)
    facts = {"unit": None, "models": {}, "connections": []}

    def walk(n):
        name, props, children = n
        if name == "P" and props and props[0] == "UnitScaleFactor":
            facts["unit"] = props[-1]
        if name == "Model" and len(props) >= 2:
            label = str(props[1]).split("\x00")[0]
            translation = [0.0, 0.0, 0.0]
            for child in children:
                if child[0] == "Properties70":
                    for p in child[2]:
                        if p[1] and p[1][0] == "Lcl Translation":
                            translation = p[1][-3:]
            facts["models"][props[0]] = (label, translation)
        if name == "C" and len(props) >= 3 and props[0] == "OO":
            facts["connections"].append((props[1], props[2]))
        for c in children:
            walk(c)

    for r in roots:
        walk(r)
    by_label = {label: (uid, t) for uid, (label, t) in facts["models"].items()}
    parent_of = {child: parent for child, parent in facts["connections"] if parent in facts["models"]}
    problems = []
    if facts["unit"] is None or abs(facts["unit"] - 1.0) > 1e-6:
        problems.append(f"UnitScaleFactor is {facts['unit']}, expected 1.0 (centimetres)")
    if pelvis not in by_label:
        problems.append(f"no {pelvis} in the file")
    else:
        uid, translation = by_label[pelvis]
        height = max(abs(c) for c in translation)
        if not 30.0 <= height <= 300.0:
            problems.append(f"{pelvis} offset {translation} is not in centimetres")
        parent = facts["models"].get(parent_of.get(uid), ("", None))[0]
        if parent != ROOT_NAME:
            problems.append(f"{pelvis} parent is '{parent}', expected '{ROOT_NAME}'")
    embedded = len(re.findall(re.escape(b"\x89PNG\r\n\x1a\n"), data)) + len(re.findall(re.escape(b"\xff\xd8\xff"), data))
    if embedded < len(textures):
        problems.append(f"{embedded} images embedded, {len(textures)} textures used")
    if problems:
        raise SystemExit("export check failed: " + "; ".join(problems))
    print(f"CHECK ok: UnitScaleFactor 1.0, {pelvis} offset {[round(c, 2) for c in by_label[pelvis][1]]} cm under {ROOT_NAME}, {embedded} images embedded")


def check_only(path):
    data = open(path, "rb").read()
    pelvis = next((name for name in PELVIS_NAMES if name.encode() + b"\x00" in data), PELVIS_NAMES[0])
    check(path, pelvis, [])


def main():
    if "--check" in sys.argv:
        check_only(sys.argv[sys.argv.index("--check") + 1])
        return
    source, target = parse_args()
    arm, meshes = load(source)
    pelvis = pelvis_name(arm)
    to_centimetres(arm, meshes)
    add_root(arm, pelvis)
    textures = save_textures(meshes, os.path.join(os.path.dirname(os.path.abspath(target)), os.path.splitext(os.path.basename(target))[0] + "-textures"))
    export(arm, meshes, target)
    check(target, pelvis, textures)


main()
