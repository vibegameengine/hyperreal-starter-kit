import { useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { Player } from '../../../character/entities/Player';
import { Clouds, Pcg, Terrain, useHudMessages, useHudState, type PcgGenerated } from '../../../../shared/react';
import { forest } from '../../assets/forest';
import { pcgLab } from '../../assets/pcgLab';
import { HILL_HEIGHT, PATH } from '../../assets/pcgLabShape';
import { eveningClouds } from '../../assets/sky';
import { GroundTextures } from '../../entities/GroundTextures';

const REGION: [number, number, number] = [9000, 9000, 2500];
const PATH_LINE = PATH.map(([x, y, z]) => [x, y, z + 20] as const);

export function Scene() {
  const [treeDensity, setTreeDensity] = useState(0.012);
  const [rockDensity, setRockDensity] = useState(0.01);
  const [flatness, setFlatness] = useState(0.82);
  const [seed, setSeed] = useState(1);
  const [generated, setGenerated] = useState<PcgGenerated | null>(null);

  useHudMessages((message) => {
    const value = Number(message.value);
    if (message.type === 'pcg/trees') setTreeDensity(value);
    if (message.type === 'pcg/rocks') setRockDensity(value);
    if (message.type === 'pcg/flatness') setFlatness(value);
    if (message.type === 'pcg/seed') setSeed(Math.round(value));
  });
  useHudState('pcg/state', () => ({ treeDensity, rockDensity, flatness, seed, ms: generated?.ms ?? 0, instances: generated?.instances ?? {} }));

  return (
    <>
      <LabStage ground={false} camera={null} sunPitch={-30} sunYaw={200} fogDensity={0.004} />
      <Clouds material={eveningClouds} />
      <Terrain terrain={pcgLab}>
        <GroundTextures />
        <Pcg
          graph={forest}
          at={[0, 0, HILL_HEIGHT / 2]}
          extent={REGION}
          seed={seed}
          params={{ treeDensity, rockDensity, flatness }}
          splines={[PATH_LINE]}
          onGenerated={(result) => {
            console.log(`[pcg-lab] generated in ${result.ms} ms: ${JSON.stringify(result.instances)}`);
            setGenerated(result);
          }}
        />
        <Player at={[PATH[0][0], PATH[0][1], PATH[0][2] + 150]} />
      </Terrain>
    </>
  );
}
