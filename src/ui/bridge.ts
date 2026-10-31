export type GameMessage = { type: string; [key: string]: unknown };

interface VgeBinding {
  post(json: string): void;
  setinteractiverects(json: string): void;
}

declare global {
  interface Window {
    ue?: { vge?: VgeBinding };
    __vgeReceive?: (message: GameMessage) => void;
  }
}

const listeners = new Set<(message: GameMessage) => void>();
window.__vgeReceive = (message) => listeners.forEach((listener) => listener(message));

export const inGame = () => Boolean(window.ue?.vge);

export function post(message: GameMessage) {
  if (window.ue?.vge) window.ue.vge.post(JSON.stringify(message));
  else console.log('[ui] no game bridge, would post', message);
}

export function onGameMessage(listener: (message: GameMessage) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let scheduled = false;
function reportInteractiveRects() {
  scheduled = false;
  const rects = [...document.querySelectorAll<HTMLElement>('[data-hit]')].map((element) => {
    const r = element.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  window.ue?.vge?.setinteractiverects(JSON.stringify({ width: window.innerWidth, rects }));
}
function scheduleReport() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(reportInteractiveRects);
  }
}
new MutationObserver(scheduleReport).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
new ResizeObserver(scheduleReport).observe(document.documentElement);
window.addEventListener('resize', scheduleReport);

const PROBE_MS = 3000;

function repaintMarker() {
  const marker = document.createElement('div');
  marker.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none';
  document.body.appendChild(marker);
  return marker;
}

function probeFrames(durationMs: number, repaint: boolean) {
  const marker = repaint ? repaintMarker() : undefined;
  const frames: number[] = [];
  const longTasks: number[] = [];
  const observer = 'PerformanceObserver' in window ? new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(entry.duration))) : undefined;
  try {
    observer?.observe({ type: 'longtask', buffered: false });
  } catch {
    observer?.disconnect();
  }
  const start = performance.now();
  const tick = (now: number) => {
    frames.push(now);
    if (marker) marker.style.background = frames.length % 2 ? 'rgba(0,0,0,0.01)' : 'rgba(0,0,0,0.02)';
    if (now - start < durationMs) {
      requestAnimationFrame(tick);
      return;
    }
    observer?.disconnect();
    marker?.remove();
    const gaps = frames.slice(1).map((at, index) => at - frames[index]);
    const sorted = [...gaps].sort((a, b) => a - b);
    post({
      type: 'vge:hud-probe-result',
      framesPerSecond: Math.round((gaps.length / (now - start)) * 1000 * 10) / 10,
      medianFrameMs: Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10,
      worstFrameMs: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((sum, duration) => sum + duration, 0)),
      elements: document.getElementsByTagName('*').length,
    });
  };
  requestAnimationFrame(tick);
}

function probeInput(durationMs: number) {
  let moves = 0;
  const count = () => moves++;
  window.addEventListener('pointermove', count, true);
  const start = performance.now();
  setTimeout(() => {
    window.removeEventListener('pointermove', count, true);
    post({ type: 'vge:hud-input-probe-result', movesPerSecond: Math.round((moves / (performance.now() - start)) * 1000 * 10) / 10 });
  }, durationMs);
}

onGameMessage((message) => {
  if (message.type === 'vge:hud-input-probe') probeInput(Number(message.durationMs) || PROBE_MS);
  if (message.type === 'vge:hud-probe') probeFrames(Number(message.durationMs) || PROBE_MS, message.repaint === true);
  if (message.type === 'vge:hud-echo') post({ type: 'vge:hud-echo-result', id: message.id });
});
