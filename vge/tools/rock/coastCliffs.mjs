import { COAST_HALF_SIZE } from '../../../src/features/world/assets/coastShape.ts';
import { columnOf, makeSampler } from './coastField.mjs';
import { contourChunk } from './dualContour.mjs';

const sampleRock = makeSampler();
export const CELL_SIZE = 15;
export const CHUNK_CELLS = 64;
export const CHUNK_SIZE = CELL_SIZE * CHUNK_CELLS;
export const SEGMENT_CHUNKS = 4;

function chunkSpan(x0, y0) {
  let low = Infinity;
  let high = -Infinity;
  let rocky = 0;
  for (let j = 0; j <= 8; j++) {
    for (let i = 0; i <= 8; i++) {
      const x = x0 + (i / 8) * CHUNK_SIZE;
      const y = y0 + (j / 8) * CHUNK_SIZE;
      const column = columnOf(x, y);
      low = Math.min(low, column.height);
      high = Math.max(high, Math.min(column.height, column.top));
      rocky = Math.max(rocky, column.rock);
    }
  }
  return { low, high, rocky };
}

export function cliffChunks() {
  const chunks = [];
  for (let y0 = -COAST_HALF_SIZE; y0 < COAST_HALF_SIZE; y0 += CHUNK_SIZE) {
    for (let x0 = -COAST_HALF_SIZE; x0 < COAST_HALF_SIZE; x0 += CHUNK_SIZE) {
      const span = chunkSpan(x0, y0);
      if (span.rocky < 0.2 || span.high - span.low < 250) continue;
      for (let z0 = Math.floor((span.low - 300) / CHUNK_SIZE) * CHUNK_SIZE; z0 < span.high + 200; z0 += CHUNK_SIZE) chunks.push([x0, y0, z0]);
    }
  }
  return chunks;
}

export function meshChunk(origin) {
  return contourChunk({ origin, cells: CHUNK_CELLS, cellSize: CELL_SIZE, sample: sampleRock, column: columnOf });
}

export function segmentKey([x0, y0]) {
  const span = CHUNK_SIZE * SEGMENT_CHUNKS;
  return `${Math.floor(x0 / span)}_${Math.floor(y0 / span)}`;
}
