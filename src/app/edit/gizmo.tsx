import { defineMaterial, param } from '../../shared/material';

const gizmo = defineMaterial(
  <material
    blendMode="Translucent"
    shadingModel="Unlit"
    twoSided
    disableDepthTest
    emissiveColor={<eyeAdaptationInverse lightValueInput={param('color', [1, 1, 1])} alphaInput={1} />}
    opacity={param('alpha', 0.6)}
  />,
);
export default gizmo;
