import { defineCompute, params, texture } from '../../../shared/compute';

export const PROBE_SIZE = 256;

export const probe = defineCompute({
  resources: { Target: texture(), Clock: params('Clock') },
  kernels: {
    Probe: {
      group: [8, 8, 1],
      threads: [PROBE_SIZE, PROBE_SIZE, 1],
      uses: ['Target', 'Clock'],
      body: `float t = Clock().x;
TargetStore(int2(DTid.xy), float4(DTid.x / ${PROBE_SIZE}.0, DTid.y / ${PROBE_SIZE}.0, 0.5 + 0.5 * sin(t), 1.0));`,
    },
  },
});
