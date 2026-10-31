import { defineInstance } from '../../../shared/material';

const ENGINE_CLOUDS = '/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst';

export const eveningClouds = defineInstance(ENGINE_CLOUDS, { Cloud_GlobalCoverage: -0.2, Cloud_GlobalDensity: 0.008, Layout_CloudGlobalScale: 256 });
