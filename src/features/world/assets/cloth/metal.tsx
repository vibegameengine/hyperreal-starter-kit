import { defineInstance, defineMaterial, param } from '../../../../shared/material';

const metal = defineMaterial(
  <material
    usage={['skeletalMesh']}
    baseColor={param('color', [0.6, 0.6, 0.62])}
    metallic={param('metallic', 1)}
    roughness={param('roughness', 0.32)}
  />,
);
export default metal;

export const brass = defineInstance(metal, { color: [0.78, 0.58, 0.3], roughness: 0.4 });
