import { defineMaterial } from '../../../shared/material';

export const probeScreen = defineMaterial(
  <material
    shadingModel="Unlit"
    emissiveColor={<textureSampleParameter2D parameterName="Probe" texture="/Engine/EngineResources/WhiteSquareTexture" samplerType="Color" coordinates={<textureCoordinate />} />}
  />,
);
