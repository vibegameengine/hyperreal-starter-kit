import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { world } from '../../../../shared/engine/world';
import { MetaHuman, useHudMessages, useHudState } from '../../../../shared/react';
import { ORBIT_CAMERA, Player } from '../../entities/Player';

const ADA = '/Game/MetaHumans/Ada/BP_Ada.BP_Ada_C';
const RETARGET = '/Game/MetaHumans/Common/Common/Animation/Retargeting/ABP_MetaHuman_f_med_nrw_Retargeting.ABP_MetaHuman_f_med_nrw_Retargeting_C';
const FACE = '/Game/MetaHumans/Common/Common/Mocap/mh_arkit_mapping_anim.mh_arkit_mapping_anim';

const playerMesh = () => (UE.GameplayStatics.GetPlayerCharacter(world, 0) as UE.Character | null)?.Mesh;

export function Scene() {
  const [closeUp, setCloseUp] = useState(false);
  const [parts, setParts] = useState<string[]>([]);
  useHudMessages((message) => {
    if (message.type === 'metahuman/close-up') setCloseUp(Boolean(message.value));
  });
  useHudState('metahuman/state', () => ({ closeUp, parts }));
  const faceCamera = useRef<UE.CameraActor>(null);
  useEffect(() => {
    const controller = UE.GameplayStatics.GetPlayerController(world, 0);
    const pawn = UE.GameplayStatics.GetPlayerCharacter(world, 0);
    const view = closeUp ? faceCamera.current : pawn;
    if (controller && view) controller.SetViewTargetWithBlend(view, 0.6, UE.EViewTargetBlendFunction.VTBlend_EaseInOut, 2, false);
  }, [closeUp]);

  return (
    <>
      <LabStage camera={null} />
      <Player at={[0, 0, 100]} variant="quinn" camera={ORBIT_CAMERA} />
      <cameraActor ref={faceCamera} location={[52, 0, 150]} rotation={[-2, 180, 0]} cameraComponent={{ fieldOfView: 35, constrainAspectRatio: false }} />
      <MetaHuman pack="MetaHumans" blueprint={ADA} retarget={RETARGET} target={playerMesh} faceAnimation={FACE} onReady={(found) => setParts(Object.keys(found))} />
    </>
  );
}
