// Rewrites a model file into what Interchange's glTF translator in 5.8 reads, shared by the dev content
// pipeline and the release build:
// - data in extensions Interchange cannot decode (meshopt, Draco, quantization, WebP/AVIF) becomes plain glTF/PNG;
// - ':' leaves node names (Mixamo's FBX-to-glTF exports keep "mixamorig:Hips", three.js-era exports have
//   "mixamorigHips"), so files from both sources name the same bones the same way;
// - an FBX model becomes a GLB first (fbx2gltf, as the web kit's fbxAssetLoaderPlugin does), its node names losing
//   the namespace the way Unreal's FBX import drops it ("mixamorig:Hips" -> "Hips"), so FBX clips still match;
// - a skin whose top joint stands above the ground (a Mixamo skeleton whose root is Hips) gets a `root` joint at
//   its parent's origin above it (tech debt: tasks/todo/skeleton-root-bone-crutch.md).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, textureCompress } from '@gltf-transform/functions';
import convertFbxToGltf from 'fbx2gltf';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { Matrix4 } from 'three';

const COMPRESSION_EXTENSIONS = ['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_mesh_quantization'];
const TEXTURE_EXTENSIONS = ['EXT_texture_webp', 'EXT_texture_avif'];
const GLTF = /\.(glb|gltf)$/i;
const FBX = /\.fbx$/i;
const GROUND_ROOT = 'root';

function addGroundRoots(document) {
  const root = document.getRoot();
  let added = false;
  for (const skin of root.listSkins()) {
    const joints = skin.listJoints();
    const top = joints.find((joint) => !joints.includes(joint.getParentNode()));
    if (!top || top.getName() === GROUND_ROOT || Math.hypot(...top.getWorldTranslation()) < 0.01) continue;
    const parent = top.getParentNode();
    const ground = parent?.getName() === GROUND_ROOT ? parent : document.createNode(GROUND_ROOT);
    if (ground !== parent) {
      if (parent) {
        parent.removeChild(top);
        parent.addChild(ground);
      } else {
        for (const scene of root.listScenes().filter((each) => each.listChildren().includes(top))) {
          scene.removeChild(top);
          scene.addChild(ground);
        }
      }
      ground.addChild(top);
    }
    const matrices = skin.getInverseBindMatrices();
    const inverseBind = new Matrix4().fromArray(ground.getWorldMatrix()).invert().toArray();
    matrices.setArray(new Float32Array([...matrices.getArray(), ...inverseBind]));
    skin.addJoint(ground);
    added = true;
  }
  return added;
}

export function createDecoder() {
  let io;
  async function getIO() {
    if (!io) {
      await MeshoptDecoder.ready;
      io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'draco3d.decoder': await draco3d.createDecoderModule(),
      });
    }
    return io;
  }

  // Returns the file to import (`source` itself when nothing had to change, else `target`) and what was rewritten.
  return async function decode(source, target) {
    const fromFbx = FBX.test(source);
    if (fromFbx) await convertFbxToGltf(source, target, ['--binary']);
    else if (!GLTF.test(source)) return { file: source, decoded: [] };
    const gltfIO = await getIO();
    const document = await gltfIO.read(fromFbx ? target : source);
    const root = document.getRoot();
    const used = root.listExtensionsUsed().map((e) => e.extensionName);
    const unsupported = used.filter((name) => COMPRESSION_EXTENSIONS.includes(name) || TEXTURE_EXTENSIONS.includes(name));
    const decoded = fromFbx ? ['fbx', ...unsupported] : [...unsupported];

    if (root.listNodes().some((node) => node.getName().includes(':'))) {
      for (const node of root.listNodes()) node.setName(fromFbx ? node.getName().replace(/^.*:/, '') : node.getName().replaceAll(':', ''));
      decoded.push('node-names');
    }
    if (addGroundRoots(document)) decoded.push('ground-root');
    if (decoded.length === 0) return { file: source, decoded };

    if (unsupported.length > 0) {
      const transforms = [dequantize()];
      if (unsupported.some((name) => TEXTURE_EXTENSIONS.includes(name))) {
        transforms.push(textureCompress({ encoder: sharp, targetFormat: 'png', pattern: /.*/ }));
      }
      await document.transform(...transforms);
      for (const extension of root.listExtensionsUsed()) {
        if (unsupported.includes(extension.extensionName)) extension.dispose();
      }
    }
    await gltfIO.write(target, document);
    return { file: target, decoded };
  };
}

// The content-path name of a model file: flight-case.glb -> FlightCase.
export const assetName = (file) =>
  file
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());
