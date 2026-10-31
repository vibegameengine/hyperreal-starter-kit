import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { gameInstance, onFrame } from '../engine/world';

export type HudMessage = { type: string; [key: string]: unknown };

const hudPage = () => gameInstance.UI as UE.VgeUI;

export function sendToHud(message: HudMessage) {
  hudPage().Send(JSON.stringify(message));
}

const HUD_STATE_HEARTBEAT_MS = 500;
export function useHudState(type: string, state: () => Record<string, unknown>) {
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    let sent = '';
    let sentAt = 0;
    return onFrame(() => {
      const text = JSON.stringify({ type, ...latest.current() });
      const now = Date.now();
      if (text === sent && now - sentAt < HUD_STATE_HEARTBEAT_MS) return;
      sent = text;
      sentAt = now;
      hudPage().Send(text);
    }, { tickEvenWhenPaused: true });
  }, [type]);
}

export function useHudMessages(handle: (message: HudMessage) => void) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const listener = (json: string) => latest.current(JSON.parse(json) as HudMessage);
    hudPage().OnMessage.Add(listener);
    return () => hudPage().OnMessage.Remove(listener);
  }, []);
}

export function onHudMessage(handle: (message: HudMessage) => void) {
  const listener = (json: string) => handle(JSON.parse(json) as HudMessage);
  hudPage().OnMessage.Add(listener);
  return () => hudPage().OnMessage.Remove(listener);
}
