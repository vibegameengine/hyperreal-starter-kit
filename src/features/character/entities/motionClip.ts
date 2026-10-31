import * as UE from 'ue';
import { useEffect, useState } from 'react';
import { onMotionMatching } from '../../../shared/engine/content';
import type { MotionMatchingRef } from '../../../shared/motion';
import { motionDatabaseOf } from '../../../shared/react';

const LINKED_GRAPH = /linkedGraph#(\d+)/;

export function linkedAnimInstance(character: UE.Character): UE.AnimInstance | undefined {
  const graph = character.Mesh?.GetAnimInstance() as UE.VgeAnimInstance | undefined;
  const id = graph && LINKED_GRAPH.exec(graph.DescribeGraph() ?? '')?.[1];
  return id ? graph.GetLinkedInstance(id) : undefined;
}

export function currentClipOf(character: unknown): string | undefined {
  if (!(character instanceof UE.Character)) return undefined;
  const instance = linkedAnimInstance(character);
  if (!instance) return undefined;
  const clip = UE.VgeScriptLibrary.DescribeMotionMatching(instance).split('|')[0];
  return clip && clip !== 'none' && clip !== 'invalid' && clip !== 'no motion matching node' ? clip : undefined;
}

function clipNamesOf(database: UE.PoseSearchDatabase) {
  return Array.from({ length: database.GetNumAnimationAssets() }, (_, index) => database.GetAnimationAsset(index)?.GetName()).filter((name): name is string => !!name);
}

export function useDatabaseClipNames(refs: Readonly<Record<string, MotionMatchingRef | undefined>>): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  const keys = Object.values(refs).map((ref) => ref?.key ?? '').join('|');
  useEffect(() => {
    const found = new Map<string, string[]>();
    const stops = Object.values(refs).flatMap((ref) =>
      ref
        ? [
            onMotionMatching(ref, (built) => {
              const database = motionDatabaseOf(built.path);
              if (!database) return;
              found.set(ref.key, clipNamesOf(database));
              setNames([...new Set([...found.values()].flat())]);
            }),
          ]
        : [],
    );
    return () => stops.forEach((stop) => stop());
  }, [keys]);
  return names;
}
