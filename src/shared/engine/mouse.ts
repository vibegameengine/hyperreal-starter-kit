import * as UE from 'ue';
import { isGameInputHeld } from './gameInput';
import { everyFrame, own, world, type Scope } from './world';

const ESCAPE = new UE.Key('Escape');
const CLICK = new UE.Key('LeftMouseButton');

const controller = () => UE.GameplayStatics.GetPlayerController(world, 0) as UE.PlayerController | undefined;

export function isMouseCaptured() {
  const player = controller();
  return !!player && !player.bShowMouseCursor;
}

export function captureMouse() {
  const player = controller();
  if (!player) return;
  player.bShowMouseCursor = false;
  UE.WidgetBlueprintLibrary.SetInputMode_GameOnly(player, true);
}

export function releaseMouse() {
  const player = controller();
  if (!player) return;
  player.bShowMouseCursor = true;
  UE.WidgetBlueprintLibrary.SetInputMode_GameAndUIEx(player, undefined, UE.EMouseLockMode.DoNotLock, false, true);
}

export function wantMouseCapture(scope: Scope = 'scene') {
  const stopTicking = everyFrame(() => {
    const player = controller();
    if (!player || isGameInputHeld()) return;
    if (player.bShowMouseCursor) {
      if (player.WasInputKeyJustPressed(CLICK)) captureMouse();
    } else if (player.WasInputKeyJustPressed(ESCAPE)) {
      releaseMouse();
    }
  }, scope);
  return own(() => {
    stopTicking();
    releaseMouse();
  }, scope);
}
