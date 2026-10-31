import { defineMaterial, param } from '../../shared/material';

const DEPTH_TOLERANCE_CM = 2;
const DEPTH_TOLERANCE_FRACTION = 0.002;
const OCCLUDED_ALPHA = 0.35;
const VISIBLE_ALPHA = 254 / 255;
const NOTHING_CAPTURED_CM = 1e7;
const PLACEHOLDER_TEXTURE = '/Engine/EngineResources/Black.Black';
const CENTRE: readonly [number, number] = [0, 0];
const AXES: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

type Offset = readonly [number, number];
type Expression = ReturnType<typeof capturedDepthAt>;

const outputPixel = <sceneTexture sceneTextureId="PostProcessInput0" output="InvSize" />;
const uvAt = ([dx, dy]: Offset) => (dx === 0 && dy === 0 ? <textureCoordinate /> : <add a={<textureCoordinate />} b={<multiply a={[dx, dy]} b={outputPixel} />} />);
const capturedDepthAt = (texture: string, offset: Offset) => <componentMask r input={<textureSampleParameter2D parameterName={texture} texture={PLACEHOLDER_TEXTURE} coordinates={uvAt(offset)} />} />;
const isSet = (value: Expression) => <step y={0.5} x={value} />;
const isCaptured = (depth: Expression) => <step y={depth} x={NOTHING_CAPTURED_CM} />;
const maxOf = (values: Expression[]) => values.reduce((a, b) => <max a={a} b={b} />);
const minOf = (values: Expression[]) => values.reduce((a, b) => <min a={a} b={b} />);

function selectionAt(offset: Offset) {
  const selected = capturedDepthAt('selectedDepth', offset);
  const active = capturedDepthAt('activeDepth', offset);
  const activeWins = <multiply a={isCaptured(active)} b={<step y={active} x={selected} />} />;
  const id = <linearInterpolate a={isCaptured(selected)} b={2} alpha={activeWins} />;
  return { id, depth: <min a={selected} b={active} /> };
}

const centre = selectionAt(CENTRE);
const near = AXES.map(selectionAt);

const onEdge = maxOf(near.map(({ id }) => isSet(<abs input={<subtract a={id} b={centre.id} />} />)));
const insideSelection = isSet(centre.id);

const colourId = <linearInterpolate a={maxOf(near.map(({ id }) => id))} b={centre.id} alpha={insideSelection} />;
const outlineColour = <linearInterpolate a={param('selected', [0.945, 0.345, 0])} b={param('active', [1, 0.667, 0.251])} alpha={<saturate input={<subtract a={colourId} b={1} />} />} />;

const outlineDepth = <linearInterpolate a={minOf(near.map(({ depth }) => depth))} b={centre.depth} alpha={insideSelection} />;
const sceneDepth = <componentMask r input={<sceneTexture sceneTextureId="SceneDepth" />} />;
const tolerance = <add a={DEPTH_TOLERANCE_CM} b={<multiply a={sceneDepth} b={DEPTH_TOLERANCE_FRACTION} />} />;
const visible = <step y={outlineDepth} x={<add a={sceneDepth} b={tolerance} />} />;
const alpha = <multiply a={onEdge} b={<linearInterpolate a={OCCLUDED_ALPHA} b={VISIBLE_ALPHA} alpha={visible} />} />;

const sceneColour = <componentMask r g b input={<sceneTexture sceneTextureId="PostProcessInput0" />} />;

const outline = defineMaterial(
  <material
    materialDomain="PostProcess"
    blendableLocation="SceneColorAfterTonemapping"
    emissiveColor={<linearInterpolate a={sceneColour} b={outlineColour} alpha={alpha} />}
  />,
);
export default outline;
