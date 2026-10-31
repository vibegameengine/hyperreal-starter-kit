import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimGraphLabHud } from './hud/AnimGraphLabHud';
import { ClothLabHud } from './hud/ClothLabHud';
import { CustomPlayerLabHud } from './hud/CustomPlayerLabHud';
import { EditPropCard } from './hud/EditPropCard';
import { MixamoCharacterLabHud } from './hud/MixamoCharacterLabHud';
import { MixamoToMannyLabHud } from './hud/MixamoToMannyLabHud';
import { MotionMatchingLabHud } from './hud/MotionMatchingLabHud';
import { FixedStepLabHud } from './hud/FixedStepLabHud';
import { GirlPlayerLabHud } from './hud/GirlPlayerLabHud';
import { FlightCaseLabHud } from './hud/FlightCaseLabHud';
import { InstancingLabHud } from './hud/InstancingLabHud';
import { LumenLabHud } from './hud/LumenLabHud';
import { MainSceneHud } from './hud/MainSceneHud';
import { WorldSceneHud } from './hud/WorldSceneHud';
import { MannequinLabHud } from './hud/MannequinLabHud';
import { MaterialsLabHud } from './hud/MaterialsLabHud';
import { NaniteLabHud } from './hud/NaniteLabHud';
import { ParticlesLabHud } from './hud/ParticlesLabHud';
import { PhysicsLabHud } from './hud/PhysicsLabHud';
import { RagdollLabHud } from './hud/RagdollLabHud';
import { PlaygroundLabHud } from './hud/PlaygroundLabHud';
import { SandstormLabHud } from './hud/SandstormLabHud';
import { SoftTissueLabHud } from './hud/SoftTissueLabHud';
import { SoundLabHud } from './hud/SoundLabHud';
import { SpinningCubesLabHud } from './hud/SpinningCubesLabHud';
import { TripoGirlLabHud } from './hud/TripoGirlLabHud';
import { OutfitLabHud } from './hud/OutfitLabHud';
import { VolumetricsLabHud } from './hud/VolumetricsLabHud';
import { PcgLabHud } from './hud/PcgLabHud';
import { DestructionLabHud } from './hud/DestructionLabHud';
import { VehicleLabHud } from './hud/VehicleLabHud';
import { HairLabHud } from './hud/HairLabHud';
import { MetaHumanLabHud } from './hud/MetaHumanLabHud';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MainSceneHud />
    <WorldSceneHud />
    <AnimGraphLabHud />
    <MannequinLabHud />
    <PlaygroundLabHud />
    <FlightCaseLabHud />
    <NaniteLabHud />
    <SpinningCubesLabHud />
    <InstancingLabHud />
    <LumenLabHud />
    <PhysicsLabHud />
    <ClothLabHud />
    <FixedStepLabHud />
    <ParticlesLabHud />
    <SoundLabHud />
    <SandstormLabHud />
    <RagdollLabHud />
    <MaterialsLabHud />
    <MixamoCharacterLabHud />
    <MixamoToMannyLabHud />
    <MotionMatchingLabHud />
    <CustomPlayerLabHud />
    <TripoGirlLabHud />
    <OutfitLabHud />
    <SoftTissueLabHud />
    <GirlPlayerLabHud />
    <VolumetricsLabHud />
    <PcgLabHud />
    <DestructionLabHud />
    <VehicleLabHud />
    <HairLabHud />
    <MetaHumanLabHud />
    <EditPropCard />
  </StrictMode>,
);
