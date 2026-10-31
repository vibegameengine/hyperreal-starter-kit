import * as UE from 'ue';
import { useRef, useState } from 'react';
import { useFrame } from '../../../../shared/react';
import { VIEWER_AT } from './lab';
import { ViolationLog, drawPose, measurePose, type Foot, type Pose } from './probe';

const clipName = (path: string) => path.slice(path.lastIndexOf('.') + 1);
const TRACE_FRAMES = 600;

interface TraceFrame {
  clipTime: number;
  feet: Foot[];
  points: number[][];
  root: number[];
}

export function useClipViewer() {
  const component = useRef<UE.SkeletalMeshComponent | undefined>(undefined);
  const pose = useRef<Pose | undefined>(undefined);
  const log = useRef(new ViolationLog(false));
  const t = useRef(0);
  const pendingTime = useRef<number | undefined>(undefined);
  const trace = useRef<TraceFrame[]>([]);
  const [clip, setClip] = useState<string>();

  useFrame((dt) => {
    const mesh = component.current;
    if (!mesh || !clip) return;
    t.current += dt;
    pose.current = measurePose(mesh, { ground: VIEWER_AT[2] }, pose.current, dt);
    const root = mesh.GetSocketLocation('root');
    trace.current.push({ clipTime: mesh.GetPosition(), feet: pose.current.feet, points: pose.current.points.map((point) => [point.X, point.Y, point.Z]), root: [root.X, root.Y] });
    if (trace.current.length > TRACE_FRAMES) trace.current.shift();
    if (mesh.IsPlaying()) log.current.add({ t: +t.current.toFixed(3), step: 'clip', speed: 0, clip: clipName(clip), clipTime: mesh.GetPosition(), cost: 0, continuing: false, playRate: mesh.GetPlayRate(), pose: pose.current });
    drawPose(pose.current);
  });

  const seek = (mesh: UE.SkeletalMeshComponent, time: number) => {
    mesh.SetPosition(time, false);
    mesh.Stop();
    pendingTime.current = undefined;
  };

  const select = (path: string, time?: number) => {
    if (path !== clip) {
      component.current = undefined;
      log.current.clear();
      trace.current = [];
      pose.current = undefined;
      t.current = 0;
    }
    pendingTime.current = time;
    if (time !== undefined && component.current && path === clip) seek(component.current, time);
    setClip(path);
  };

  const onReady = (mesh: UE.SkeletalMeshComponent) => {
    component.current = mesh;
    if (pendingTime.current !== undefined) seek(mesh, pendingTime.current);
  };

  return { component, pose, log, trace, clip, clipName: clip ? clipName(clip) : '', select, onReady };
}

export type Viewer = ReturnType<typeof useClipViewer>;
