import { defineInstance } from '../../../shared/material';

const ENGINE_CLOUDS = '/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud.m_SimpleVolumetricCloud';

export const eveningClouds = defineInstance(ENGINE_CLOUDS, { Cloud_GlobalCoverage: 0.35, Cloud_GlobalDensity: 0.6, Layout_CloudGlobalScale: 1.5 });
