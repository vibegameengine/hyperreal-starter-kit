import * as UE from 'ue';
import { useEffect, useState } from 'react';
import { useFrame, useHudMessages, useHudState } from '../../../shared/react';
import { landscapes } from '../entities/landscapes';

const PARAMETER = 'OceanLayersOff';

export function useOceanLayers(surface: UE.MaterialInstanceDynamic | undefined) {
  const [off, setOff] = useState(0);
  useHudMessages((message) => {
    if (message.type === 'ocean-layers/toggle') setOff((mask) => mask ^ Number(message.bit));
  });
  useHudState('ocean-layers/state', () => ({ off }));
  useEffect(() => {
    surface?.SetScalarParameterValue(PARAMETER, off);
  }, [surface, off]);
  useFrame(() => {
    for (const landscape of landscapes()) landscape.SetLandscapeMaterialScalarParameterValue(PARAMETER, off);
  });
}
