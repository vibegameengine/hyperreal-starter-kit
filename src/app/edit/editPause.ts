import { pauseWorldKeepingCamera, resumeWorld } from '../../shared/engine/pause';
import { editState, report } from './editState';

let announce = () => {};

export function onEditPauseChange(listener: () => void) {
  announce = listener;
}

export function setEditPaused(paused: boolean) {
  if (paused === editState.paused) return;
  editState.paused = paused;
  if (paused) pauseWorldKeepingCamera();
  else resumeWorld();
  report(paused ? 'the world is paused' : 'the world runs');
  announce();
}

export const toggleEditPause = () => setEditPaused(!editState.paused);
