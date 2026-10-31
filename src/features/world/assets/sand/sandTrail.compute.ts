import { buffer, defineCompute, params, texture } from '../../../../shared/compute';
import { SHORE_EXTENT, SHORE_ORIGIN } from '../ocean/oceanShore';
import { SHORE_SIM_RES } from '../ocean/oceanSpectrum';
import { PRINT_DEPTH, SAND, TRAIL_RES, TRAIL_SPAN, TRAIL_TEXEL } from './sandTrailSpec';

const N = TRAIL_RES;
const S = SHORE_SIM_RES;
const num = (value: number) => value.toFixed(6);

const PRINT = `
float Ellipse(float2 q, float2 c, float2 r) { return length((q - c) / r); }
float2 Footprint(float2 local, float side, float firm) {
  float2 q = float2(local.x, local.y * side);
  float heel = Ellipse(q, float2(-0.085, 0.0), float2(0.042, 0.036));
  float arch = Ellipse(q, float2(-0.02, -0.012), float2(0.07, 0.022));
  float ball = Ellipse(q, float2(0.045, 0.004), float2(0.05, 0.046));
  float toes = Ellipse(q, float2(0.105, 0.0), float2(0.024, 0.044));
  float e = min(min(heel, arch), min(ball, toes));
  float press = 1.0 - smoothstep(lerp(0.7, ${num(SAND.wetWallStart)}, firm), 1.0, e);
  float heelDeep = lerp(1.0, lerp(1.25, 1.08, firm), smoothstep(1.2, 0.0, heel));
  float rimOuter = lerp(1.7, 1.3, firm);
  float rim = smoothstep(1.0, 1.15, e) * smoothstep(rimOuter, 1.15, e);
  return float2(press * heelDeep * lerp(1.0, ${num(SAND.wetDepth)}, firm), rim * lerp(${num(SAND.dryRim)}, ${num(SAND.wetRim)}, firm));
}
float2 Stamp(float2 w, float4 foot, float firm) {
  if (foot.w == 0.0) return 0.0;
  float2 d = w - foot.xy;
  if (dot(d, d) > 0.09) return 0.0;
  float c = cos(foot.z); float s = sin(foot.z);
  float2 local = float2(d.x * c + d.y * s, -d.x * s + d.y * c);
  return Footprint(local, sign(foot.w), firm) * abs(foot.w);
}
float4 TrailRead(uint k, bool odd) { return odd ? DepthBLoad(k) : DepthALoad(k); }
float4 TrailNeighbour(int2 id, float4 own, float2 centre, bool odd) {
  uint2 q = uint2(id & ${N - 1});
  float2 base = (float2(q) + 0.5) * ${num(TRAIL_TEXEL)};
  float2 tile = round((centre - base) / ${num(TRAIL_SPAN)});
  float4 c = TrailRead(q.y * ${N}u + q.x, odd);
  return abs(c.w - (tile.x * 4096.0 + tile.y)) > 0.5 ? own : c;
}
float4 ShoreAt(float2 su) {
  float2 fp = clamp(su * ${S}.0 - 0.5, 0.0, ${S - 1.001});
  int2 i = int2(floor(fp)); float2 t = frac(fp);
  float4 a = StateLoad(i); float4 b = StateLoad(i + int2(1, 0));
  float4 c = StateLoad(i + int2(0, 1)); float4 d = StateLoad(i + int2(1, 1));
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
}
`;

export const sandTrail = defineCompute({
  resources: {
    DepthA: buffer(N * N, 4),
    DepthB: buffer(N * N, 4),
    Pond: buffer(N * N, 1),
    Trail: texture(),
    State: texture(),
    Feet: params('Window', 'FootA', 'FootB', 'Step'),
  },
  kernels: {
    SandTrail: {
      group: [8, 8, 1],
      threads: [N, N, 1],
      uses: ['DepthA', 'DepthB', 'Pond', 'Trail', 'State', 'Feet'],
      shared: PRINT,
      body: `uint k = DTid.y * ${N}u + DTid.x;
float4 win = Window();
float dt = win.w;
bool odd = Step().x > 0.5;
float period = ${num(TRAIL_SPAN)};
float2 base = (float2(DTid.xy) + 0.5) * ${num(TRAIL_TEXEL)};
float2 tile = round((win.xy - base) / period);
float2 w = base + tile * period;
float tileId = tile.x * 4096.0 + tile.y;
float4 cell = TrailRead(k, odd);
float pond = PondLoad(k);
bool fresh = win.z > 0.5 || abs(cell.w - tileId) > 0.5;
if (fresh) { cell = float4(0.0, 0.0, 0.0, tileId); pond = 0.0; }
float wet = 0.0;
float2 su = (w - ${num(SHORE_ORIGIN)}) / ${num(SHORE_EXTENT)};
if (all(su > 0.0) && all(su < 1.0)) {
  float4 shore = ShoreAt(su);
  wet = shore.y;
  float wash = smoothstep(${num(SAND.coverWet)}, 0.995, wet);
  if (wash > 0.0 && !fresh) {
    int2 id = int2(DTid.xy);
    float4 sum = TrailNeighbour(id + int2(1, 0), cell, win.xy, odd) + TrailNeighbour(id - int2(1, 0), cell, win.xy, odd)
      + TrailNeighbour(id + int2(0, 1), cell, win.xy, odd) + TrailNeighbour(id - int2(0, 1), cell, win.xy, odd);
    float spread = saturate(wash * 4.0 * ${num(SAND.swashDiffusion)} * dt / ${num(TRAIL_TEXEL * TRAIL_TEXEL)});
    cell.xy = lerp(cell.xy, sum.xy * 0.25, spread);
    float bore = shore.x;
    cell.x *= exp(-dt * wash * (${num(SAND.fillRate)} + ${num(SAND.boreRate)} * bore));
    cell.y *= exp(-dt * wash * (${num(SAND.rimWashRate)} + ${num(SAND.boreRate)} * bore));
  }
  float drain = lerp(${num(SAND.drainDry)}, ${num(SAND.drainSaturated)}, smoothstep(0.4, 0.95, wet));
  pond = max(pond * exp(-dt / drain), wash);
}
float firm = smoothstep(${num(SAND.firmFrom)}, ${num(SAND.firmFull)}, wet);
float2 a = Stamp(w, FootA(), firm);
float2 b = Stamp(w, FootB(), firm);
float press = max(a.x, b.x) * ${num(PRINT_DEPTH)};
if (press > cell.x) cell = float4(press, cell.y, firm, cell.w);
cell.y = max(cell.y, max(a.y, b.y) * ${num(PRINT_DEPTH)});
if (press > 0.0) pond = max(pond, smoothstep(${num(SAND.seepFrom)}, ${num(SAND.seepFull)}, wet) * ${num(SAND.seepLevel)});
if (odd) DepthAStore(k, cell); else DepthBStore(k, cell);
PondStore(k, pond);
TrailStore(int2(DTid.xy), float4(cell.x, cell.y, cell.z, pond));`,
    },
  },
});
