import * as UE from 'ue';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { useMotionMatchingClass } from '../../../../shared/react';
import { mannyMotion } from '../../assets/manny.motion';
import { MANNY_SITUATIONS } from '../../assets/mannySituations';
import { ImportedCharacter } from '../../entities/ImportedCharacter';
import { MANNEQUIN_MESHES } from '../../entities/mannequin';
import { Player } from '../../entities/Player';
import { CAMERA_DISTANCE, CAMERA_HEIGHT, CAPSULE_HALF_HEIGHT, START, VIEWER_AT, databaseClips, pawnOf, type Mode, type View } from './lab';
import { BlendMirror } from './BlendMirror';
import { useLabHud, type Lab } from './labHud';
import { useClipViewer, type Viewer } from './useClipViewer';
import { useLabCamera } from './useLabCamera';
import { useRecorder } from './useRecorder';
import { useTransport } from './useTransport';

function cameraTarget(mode: Mode, viewer: Viewer) {
  if (mode === 'clip') {
    const pelvis = viewer.component.current?.GetSocketLocation('pelvis');
    return pelvis && new UE.Vector(pelvis.X, pelvis.Y, VIEWER_AT[2] + CAMERA_HEIGHT);
  }
  const at = pawnOf()?.K2_GetActorLocation();
  return at && new UE.Vector(at.X, at.Y, at.Z - CAPSULE_HALF_HEIGHT + CAMERA_HEIGHT);
}

export function Scene() {
  const camera = useRef<UE.CameraActor>(null);
  const [mode, setMode] = useState<Mode>('scenario');
  const [view, setView] = useState<View>('side');
  const [legs, setLegs] = useState(true);
  useEffect(() => {
    (globalThis as any).motionMatchingLegs = setLegs;
  }, []);
  const graphClass = useMotionMatchingClass(mannyMotion);
  const clips = useMemo(() => databaseClips(graphClass), [graphClass]);
  const recorder = useRecorder(mode);
  const viewer = useClipViewer();
  const transport = useTransport();
  const lab: Lab = { mode, setMode, view, setView, clips, recorder, viewer, transport };

  useLabCamera(camera, view, () => cameraTarget(mode, viewer));
  useLabHud(lab);
  useEffect(() => {
    if (mode === 'clip' && !viewer.clip && clips.length) viewer.select(clips[0].path);
  }, [mode, clips]);

  return (
    <>
      <LabStage groundSize={80} camera={null} />
      <cameraActor ref={camera} location={[START[0], START[1] - CAMERA_DISTANCE, CAMERA_HEIGHT]} rotation={[-4, 90, 0]} />
      <Player at={START} motion={mannyMotion} situations={MANNY_SITUATIONS} legs={legs} />
      <BlendMirror />
      {viewer.clip && <ImportedCharacter key={viewer.clip} mesh={MANNEQUIN_MESHES.manny} animation={viewer.clip} location={VIEWER_AT} rotation={[0, -90, 0]} onReady={viewer.onReady} />}
    </>
  );
}
