import { defineCompute, params, texture } from '../../../../shared/compute';
import { BREAKER_CAPACITY } from './breakerSpec';
import { BREAKER_EMIT_ACCESS, BREAKER_SPRAY_CLOUDS, BREAKER_SPRAY_DROPS, BREAKER_SPRAY_MIST, BREAKER_SPRAY_SEED, BREAKER_SPRAY_SHAPE } from './breakerSprayHlsl';
import { CASCADE_DISPLACEMENT, CASCADE_TEXTURE_NAMES } from './oceanCascades';
import { COMPUTE_ACCESS, SHORE_EXTENT, SHORE_ORIGIN, shoreMath } from './oceanShore';
import { CASCADE_SIZES } from './oceanSpectrum';
import { prefixScan, SPRAY_BODY, SPRAY_COMMON, SPRAY_INTEGRATE, SPRAY_RING_WRITE, SPRAY_WATER, sprayRequestLookup } from './sprayHlsl';
import {
  SPRAY_BUDGET_START,
  SPRAY_BUDGET_WINDOW,
  SPRAY_CPU,
  SPRAY_DEPOSIT_RES,
  SPRAY_DEPOSIT_TILE,
  SPRAY_EMITTED_WRAP,
  SPRAY_HEAD_FIRST_SAMPLE,
  SPRAY_HEAD_SAMPLES,
  SPRAY_OCCURRENCE_TEXELS,
  SPRAY_REQUEST_GROUPS,
  SPRAY_REQUESTS_PER_GROUP,
  SPRAY_RING,
  SPRAY_SCAN_THREADS,
  SPRAY_TOTAL,
  SPRAY_BODY_PARAMS,
  SPRAY_REQUEST_PARAMS,
} from './spraySpec';

const num = (value: number) => value.toFixed(6);
const SCAN = SPRAY_SCAN_THREADS;
const TILE = SPRAY_DEPOSIT_TILE;

const REQUEST_RESOURCES = Object.fromEntries(
  Array.from({ length: SPRAY_REQUEST_GROUPS }, (_, g) => [`Requests${g}`, params(...SPRAY_REQUEST_PARAMS.slice(g * SPRAY_REQUESTS_PER_GROUP, (g + 1) * SPRAY_REQUESTS_PER_GROUP))]),
);

const SPAWN = `
bool SpraySpawn(uint i, float4 cpu, uint fs, inout SprayParticle s) {
  if (i < ${SPRAY_RING}u) return false;
  uint k = (i - ${SPRAY_RING}u + ${SPRAY_CPU}u - uint(cpu.x)) % ${SPRAY_CPU}u;
  if (k >= uint(cpu.y)) return false;
  uint r = 0u;
  [loop] for (uint j = 0u; j < uint(cpu.z); j++) { r = j; if (float(k) < SprayRequest(j * 4u).w) break; }
  float4 r0 = SprayRequest(r * 4u); float4 r1 = SprayRequest(r * 4u + 1u); float4 r2 = SprayRequest(r * 4u + 2u); float4 r3 = SprayRequest(r * 4u + 3u);
  float h0 = SprayRand(i, 11u, fs); float h1 = SprayRand(i, 12u, fs); float h2 = SprayRand(i, 13u, fs);
  float h3 = SprayRand(i, 14u, fs); float h4 = SprayRand(i, 15u, fs); float h5 = SprayRand(i, 16u, fs); float h6 = SprayRand(i, 17u, fs);
  float3 p = lerp(r0.xyz, r1.xyz, h0) + float3(h1 - 0.5, h2 - 0.5, h3 - 0.5) * (r3.y * 2.0);
  float3 v = r2.xyz + float3(h4 - 0.5, h5 - 0.5, h6 - 0.5) * (r3.x * 2.0);
  s.pos = float4(p, 0.0);
  s.vel = float4(v, r1.w * (1.0 + (h2 - 0.5) * r3.w));
  s.info = float4(r2.w, r3.z * (h3 * 0.5 + 0.75), p.y, h5);
  return true;
}
`;

const UPDATE_BODY = `uint i = DTid.x;
if (i >= ${SPRAY_TOTAL}u) return;
int2 at = SprayTexel(i);
float4 step = SprayStep();
SprayParticle s; s.pos = PosLoad(at); s.vel = VelLoad(at); s.info = InfoLoad(at); s.death = float4(0.0, 0.0, 0.0, 0.0);
bool spawned = SpraySpawn(i, SprayCpu(), uint(step.z), s);
bool alive = s.info.y > 0.0;
if (alive) s = SprayIntegrate(s, step.x, step.y);
if (alive || spawned) { PosStore(at, s.pos); VelStore(at, s.vel); InfoStore(at, s.info); }
DeathStore(at, s.death);`;

const DEATHS_BODY = `uint t = GTid.x;
uint per = ${Math.ceil(SPRAY_TOTAL / SCAN)}u;
uint first = t * per;
float own = 0.0;
[loop] for (uint k = 0u; k < per; k++) { uint s = first + k; if (s < ${SPRAY_TOTAL}u && DeathLoad(SprayTexel(s)).w > 0.5) own += 1.0; }
SprayDeathScan[t] = own;
GroupMemoryBarrierWithGroupSync();
${prefixScan('SprayDeathScan', SCAN)}
uint at = uint(SprayDeathScan[t] - own);
[loop] for (uint k2 = 0u; k2 < per; k2++) {
  uint s = first + k2;
  if (s >= ${SPRAY_TOTAL}u) break;
  float4 d = DeathLoad(SprayTexel(s));
  if (d.w > 0.5) { DeathListStore(SprayTexel(at), d); at++; }
}
if (t == 0u) TallyStore(int2(0, 0), float4(SprayDeathScan[${SCAN - 1}], 0.0, 0.0, 0.0));`;

const DEPOSIT_BODY = `uint t = GTid.y * ${TILE}u + GTid.x;
SprayDepositTile[t] = 0u;
GroupMemoryBarrierWithGroupSync();
uint count = uint(TallyLoad(int2(0, 0)).x);
[loop] for (uint j = t; j < count; j += ${TILE * TILE}u) {
  float4 d = DeathListLoad(SprayTexel(j));
  float2 uv = (d.xy - ${num(SHORE_ORIGIN)}) / ${num(SHORE_EXTENT)};
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
    uint2 cell = uint2(uv * ${SPRAY_DEPOSIT_RES}.0);
    if (all(cell / ${TILE}u == Gid.xy)) InterlockedAdd(SprayDepositTile[(cell.y % ${TILE}u) * ${TILE}u + cell.x % ${TILE}u], uint(d.z));
  }
}
GroupMemoryBarrierWithGroupSync();
uint drops = SprayDepositTile[t];
if (drops > 0u) { int2 px = int2(DTid.xy); DepositStore(px, DepositLoad(px) + float(drops)); }`;

const UPDATE_RESOURCES = ['Ground', 'Field', ...CASCADE_TEXTURE_NAMES, 'Wake', 'Pos', 'Vel', 'Info', 'Death', 'Spray', ...Object.keys(REQUEST_RESOURCES)];

export const oceanSprayUpdate = defineCompute({
  resources: {
    Ground: texture(),
    Field: texture(),
    ...Object.fromEntries(CASCADE_TEXTURE_NAMES.map((name) => [name, texture()])),
    Wake: texture(),
    Pos: texture(),
    Vel: texture(),
    Info: texture(),
    Death: texture(),
    DeathList: texture(),
    Tally: texture(),
    Deposit: texture(),
    Spray: params('SprayStep', 'SprayCpu', 'WakeWindow', ...SPRAY_BODY_PARAMS),
    ...REQUEST_RESOURCES,
  },
  kernels: {
    SprayUpdate: {
      group: [64, 1, 1],
      threads: [SPRAY_TOTAL, 1, 1],
      uses: UPDATE_RESOURCES,
      shared: `${shoreMath(CASCADE_SIZES, COMPUTE_ACCESS)}${CASCADE_DISPLACEMENT}${SPRAY_COMMON}${SPRAY_WATER}${SPRAY_BODY}${sprayRequestLookup(SPRAY_REQUEST_PARAMS)}${SPRAY_INTEGRATE}${SPAWN}`,
      body: UPDATE_BODY,
    },
    SprayDeaths: {
      group: [SCAN, 1, 1],
      threads: [SCAN, 1, 1],
      uses: ['Death', 'DeathList', 'Tally'],
      shared: `${SPRAY_COMMON}\ngroupshared float SprayDeathScan[${SCAN}];`,
      body: DEATHS_BODY,
    },
    SprayDeposit: {
      group: [TILE, TILE, 1],
      threads: [SPRAY_DEPOSIT_RES, SPRAY_DEPOSIT_RES, 1],
      uses: ['DeathList', 'Tally', 'Deposit'],
      shared: `${SPRAY_COMMON}\ngroupshared uint SprayDepositTile[${TILE * TILE}];`,
      body: DEPOSIT_BODY,
    },
  },
});

const BUDGET = `
void SprayBudget(float4 state, float total, float now) {
  float4 clock = HeadLoad(int2(1, 0));
  bool fresh = state.w < 0.5 || now < clock.y;
  float budget = fresh ? ${num(SPRAY_BUDGET_START)} : state.y;
  float emitted = fresh ? 0.0 : state.z;
  float writeIndex = fresh ? 0.0 : clock.x;
  float lastSample = fresh ? -1e9 : clock.y;
  if (fresh) { [loop] for (uint c = 0u; c < ${SPRAY_HEAD_SAMPLES}u; c++) HeadStore(int2(${SPRAY_HEAD_FIRST_SAMPLE} + c, 0), float4(0.0, 0.0, 0.0, 0.0)); }
  float head = fmod(state.x + total, ${SPRAY_RING}.0);
  emitted = fmod(emitted + total, ${SPRAY_EMITTED_WRAP}.0);
  if (now - lastSample >= ${num(SPRAY_BUDGET_WINDOW / SPRAY_HEAD_SAMPLES)}) {
    HeadStore(int2(${SPRAY_HEAD_FIRST_SAMPLE} + uint(writeIndex), 0), float4(emitted, now, 1.0, 0.0));
    writeIndex = fmod(writeIndex + 1.0, ${SPRAY_HEAD_SAMPLES}.0);
    lastSample = now;
  }
  float oldestT = now; float oldestE = emitted;
  [loop] for (uint k = 0u; k < ${SPRAY_HEAD_SAMPLES}u; k++) {
    float4 sample = HeadLoad(int2(${SPRAY_HEAD_FIRST_SAMPLE} + k, 0));
    if (sample.z > 0.5 && sample.y < oldestT && now - sample.y <= ${num(SPRAY_BUDGET_WINDOW * (1 + 1 / SPRAY_HEAD_SAMPLES))}) { oldestT = sample.y; oldestE = sample.x; }
  }
  float span = now - oldestT;
  float rate = 0.0;
  if (span > 1.0) {
    rate = fmod(emitted - oldestE + ${SPRAY_EMITTED_WRAP}.0, ${SPRAY_EMITTED_WRAP}.0) / span;
    float want = rate > 1.0 ? budget * sqrt(${num(SPRAY_RING / 2)} / rate) : 1.0;
    budget = clamp(budget + (want - budget) * 0.04, 0.05, 1.0);
  }
  HeadStore(int2(0, 0), float4(head, budget, emitted, 1.0));
  HeadStore(int2(1, 0), float4(writeIndex, lastSample, rate, 0.0));
}
`;

const RESERVE_BODY = `uint t = GTid.x;
float4 ctl = ReserveControl();
uint n = uint(ctl.x);
uint per = (n + ${SCAN - 1}u) / ${SCAN}u;
uint first = t * per;
float own = 0.0;
[loop] for (uint k = 0u; k < per; k++) { uint s = first + k; if (s < n) own += EmitLoad(BreakerEmitTexel(s, 0u)).y; }
SprayReserveScan[t] = own;
GroupMemoryBarrierWithGroupSync();
${prefixScan('SprayReserveScan', SCAN)}
float4 state = HeadLoad(int2(0, 0));
float run = state.x + SprayReserveScan[t] - own;
[loop] for (uint k2 = 0u; k2 < per; k2++) {
  uint s = first + k2;
  if (s >= n) break;
  BaseStore(BreakerStationTexel(s), float4(run - floor(run / ${SPRAY_RING}.0) * ${SPRAY_RING}.0, 0.0, 0.0, 0.0));
  run += EmitLoad(BreakerEmitTexel(s, 0u)).y;
}
if (t == 0u) SprayBudget(state, SprayReserveScan[${SCAN - 1}], ctl.y);`;

export const oceanSprayReserve = defineCompute({
  resources: { Emit: texture(), Base: texture(), Head: texture(), Reserve: params('ReserveControl') },
  kernels: {
    SprayReserve: {
      group: [SCAN, 1, 1],
      threads: [SCAN, 1, 1],
      uses: ['Emit', 'Base', 'Head', 'Reserve'],
      shared: `${BREAKER_EMIT_ACCESS}${BUDGET}\ngroupshared float SprayReserveScan[${SCAN}];`,
      body: RESERVE_BODY,
    },
  },
});

const OCCURRENCE = (n: number) => `EmitLoad(BreakerEmitTexel(i, at + ${n}u))`;

const EMIT_BODY = `uint i = DTid.x;
float4 ctl = EmitControl();
if (i >= uint(ctl.x)) return;
float4 header = EmitLoad(BreakerEmitTexel(i, 0u));
if (header.y < 0.5) return;
uint ring = uint(BaseLoad(BreakerStationTexel(i)).x);
[loop] for (uint o = 0u; o < uint(header.x); o++) {
  uint at = 1u + o * ${SPRAY_OCCURRENCE_TEXELS}u;
  float4 t4 = ${OCCURRENCE(4)}; float4 t5 = ${OCCURRENCE(5)}; float4 t6 = ${OCCURRENCE(6)}; float4 t7 = ${OCCURRENCE(7)};
  BreakerSprayContext C = BreakerSprayContextAt(i, ${OCCURRENCE(0)}, ${OCCURRENCE(1)}, ${OCCURRENCE(2)}, ${OCCURRENCE(3)}, uint(ctl.y));
  ring = BreakerSprayDrops(C, t4, t5, ring);
  ring = BreakerSprayClouds(C, t5.w, t6, ring);
  ring = BreakerSprayLipMist(C, t7.x, ring);
  ring = BreakerSprayMist(C, t6.w, t7.y, ring);
}`;

export const oceanSprayEmit = defineCompute({
  resources: { Emit: texture(), Base: texture(), Pos: texture(), Vel: texture(), Info: texture(), Emitter: params('EmitControl') },
  kernels: {
    SprayEmit: {
      group: [64, 1, 1],
      threads: [BREAKER_CAPACITY, 1, 1],
      uses: ['Emit', 'Base', 'Pos', 'Vel', 'Info', 'Emitter'],
      shared: `${SPRAY_COMMON}${BREAKER_EMIT_ACCESS}${SPRAY_RING_WRITE}${BREAKER_SPRAY_SEED}${BREAKER_SPRAY_SHAPE}${BREAKER_SPRAY_DROPS}${BREAKER_SPRAY_CLOUDS}${BREAKER_SPRAY_MIST}`,
      body: EMIT_BODY,
    },
  },
});
