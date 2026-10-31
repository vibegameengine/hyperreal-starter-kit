import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { DEFAULT_FRAME_RATE_LIMIT, setFrameRateLimit } from '../shared/engine/display';
import { initialScene, openScene } from './scenes';
import { mountUIHost } from './ui-host';

function frameRateLimitFromCommandLine() {
  const value = $ref('');
  if (!UE.KismetSystemLibrary.ParseParamValue(UE.KismetSystemLibrary.GetCommandLine(), 'FrameRateLimit=', value)) return undefined;
  const limit = Number($unref(value));
  return Number.isFinite(limit) ? limit : undefined;
}

setFrameRateLimit(frameRateLimitFromCommandLine() ?? DEFAULT_FRAME_RATE_LIMIT);
mountUIHost();
openScene(initialScene()).catch((err: any) => console.error(`[scenes] opening the first scene failed: ${err?.stack ?? err}`));
