import * as UE from 'ue';
import { useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { world } from '../../../../shared/engine/world';
import { Groom, useHudMessages, useHudState } from '../../../../shared/react';
import { longHair } from '../../assets/longHair';
import { Player } from '../../entities/Player';

const playerMesh = () => (UE.GameplayStatics.GetPlayerCharacter(world, 0) as UE.Character | null)?.Mesh;

export function Scene() {
  const [wind, setWind] = useState(300);
  const [simulate, setSimulate] = useState(true);
  useHudMessages((message) => {
    if (message.type === 'hair/wind') setWind(Number(message.value));
    if (message.type === 'hair/simulate') setSimulate(Boolean(message.value));
  });
  useHudState('hair/state', () => ({ wind, simulate }));

  return (
    <>
      <LabStage camera={null} />
      <Player at={[0, 0, 100]} variant="quinn" />
      <Groom groom={longHair} target={playerMesh} simulate={simulate} wind={[0, wind, 0]} airDrag={5} />
    </>
  );
}
