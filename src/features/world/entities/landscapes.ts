import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { world } from '../../../shared/engine/world';

export function landscapes() {
  const found = $ref(UE.NewArray(UE.Actor));
  UE.GameplayStatics.GetAllActorsOfClass(world, UE.LandscapeProxy.StaticClass(), found);
  const list = $unref(found);
  return Array.from({ length: list.Num() }, (_, i) => list.Get(i) as UE.LandscapeProxy);
}
