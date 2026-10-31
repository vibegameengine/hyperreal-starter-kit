import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { loadContent } from '../../../../shared/engine/content';
import { useHudMessages, useHudState } from '../../../../shared/react';
import { SCENARIO, TIME_SCALES, type Clip, type Mode, type View } from './lab';
import { LIMITS, segmentsOf } from './probe';
import type { Recorder } from './useRecorder';
import type { Transport } from './useTransport';
import type { Viewer } from './useClipViewer';

export interface Lab {
  mode: Mode;
  setMode: (mode: Mode) => void;
  view: View;
  setView: (view: View) => void;
  clips: Clip[];
  recorder: Recorder;
  viewer: Viewer;
  transport: Transport;
}

const hundredths = (value: number) => Math.round(value * 100) / 100;

function showClip({ setMode, view, setView, clips, viewer }: Lab, name: unknown, time?: number) {
  const path = typeof name === 'string' && name.startsWith('/') ? name : clips.find((clip) => clip.name === name)?.path;
  if (!path) return;
  setMode('clip');
  setView(view === 'player' ? 'side' : view);
  viewer.select(path, time);
}

function runScenario({ setMode, view, setView, recorder, transport }: Lab) {
  setMode('scenario');
  setView(view === 'player' ? 'side' : view);
  transport.setPaused(false);
  recorder.restart(true);
}

function useLabCommands(lab: Lab) {
  const { setMode, view, setView, viewer, transport } = lab;
  useHudMessages((message) => {
    const mesh = viewer.component.current;
    if (message.type === 'motionMatchingLab/mode') {
      setMode(message.mode as Mode);
      setView(message.mode === 'drive' ? 'player' : view === 'player' ? 'side' : view);
    } else if (message.type === 'motionMatchingLab/view') setView(message.view as View);
    else if (message.type === 'motionMatchingLab/run') runScenario(lab);
    else if (message.type === 'motionMatchingLab/pause') transport.setPaused(!transport.paused);
    else if (message.type === 'motionMatchingLab/step') transport.step();
    else if (message.type === 'motionMatchingLab/timeScale') transport.setTimeScale(Number(message.timeScale));
    else if (message.type === 'motionMatchingLab/clip') showClip(lab, message.clip);
    else if (message.type === 'motionMatchingLab/inspect') showClip(lab, message.clip, Number(message.time));
    else if (message.type === 'motionMatchingLab/clipPlaying' && mesh) {
      if (message.playing) mesh.Play(true);
      else mesh.Stop();
    } else if (message.type === 'motionMatchingLab/clipTime') mesh?.SetPosition(Number(message.time), false);
  });
}

function describeViewer(viewer: Viewer) {
  const mesh = viewer.component.current && UE.KismetSystemLibrary.IsValid(viewer.component.current) ? viewer.component.current : undefined;
  const sequence = viewer.clip ? loadContent<UE.AnimSequenceBase>(viewer.clip) : undefined;
  return {
    clip: viewer.clipName,
    time: hundredths(mesh?.GetPosition() ?? 0),
    length: hundredths(sequence?.GetPlayLength() ?? 0),
    playing: mesh?.IsPlaying() ?? false,
  };
}

function describeLab({ mode, view, clips, recorder, viewer, transport }: Lab) {
  const sample = mode === 'clip' ? undefined : recorder.current.current;
  const pose = mode === 'clip' ? viewer.pose.current : sample?.pose;
  const log = mode === 'clip' ? viewer.log.current : recorder.log.current;
  return {
    mode,
    view,
    paused: transport.paused,
    timeScale: transport.timeScale,
    timeScales: TIME_SCALES,
    limits: LIMITS,
    t: hundredths(recorder.recording.current.t),
    scenario: recorder.recording.current.scripted,
    step: sample?.step ?? '',
    speed: sample?.speed ?? 0,
    clip: sample?.clip ?? '',
    clipTime: hundredths(sample?.clipTime ?? 0),
    cost: hundredths(sample?.cost ?? 0),
    continuing: sample?.continuing ?? false,
    playRate: hundredths(sample?.playRate ?? 1),
    pelvis: Math.round(pose?.pelvis ?? 0),
    feet: pose?.feet.map((foot) => ({ heel: Math.round(foot.heel), ball: Math.round(foot.ball), slide: Math.round(foot.slide), planted: foot.planted })) ?? [],
    clips: clips.map((clip) => clip.name),
    viewer: describeViewer(viewer),
    segments: segmentsOf(recorder.recording.current.samples),
    violations: log.all().slice(-40).map((violation) => ({ ...violation, worst: Math.round(violation.worst) })),
  };
}

function useAutomation(lab: Lab) {
  const latest = useRef(lab);
  latest.current = lab;
  useEffect(() => {
    (globalThis as any).motionMatchingLab = {
      run: () => {
        runScenario(latest.current);
        return SCENARIO[SCENARIO.length - 1].until;
      },
      running: () => latest.current.recorder.recording.current.scripted,
      samples: () => latest.current.recorder.recording.current.samples.map(({ pose, ...rest }) => ({ ...rest, feet: pose.feet, pelvis: pose.pelvis })),
      violations: () => latest.current.recorder.log.current.all(),
      clipViolations: () => latest.current.viewer.log.current.all(),
      showClip: (name: string, time?: number) => showClip(latest.current, name, time),
      viewerMesh: () => latest.current.viewer.component.current,
      viewerTrace: () => latest.current.viewer.trace.current,
      timeScale: (scale: number) => latest.current.transport.setTimeScale(scale),
      pause: (paused: boolean) => latest.current.transport.setPaused(paused),
    };
    return () => {
      delete (globalThis as any).motionMatchingLab;
    };
  }, []);
}

export function useLabHud(lab: Lab) {
  useLabCommands(lab);
  useHudState('motionMatchingLab/state', () => describeLab(lab));
  useAutomation(lab);
}
