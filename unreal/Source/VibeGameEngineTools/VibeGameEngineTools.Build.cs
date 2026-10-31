using System.IO;
using UnrealBuildTool;

// Headless tools that run inside UnrealEditor-Cmd: typings generation and the content service.
public class VibeGameEngineTools : ModuleRules
{
	public VibeGameEngineTools(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[] { "UnrealEd", "DeclarationGenerator", "AssetTools", "Json", "InterchangeCore", "InterchangeEngine", "InterchangePipelines" });
		// Materials described in TypeScript (VgeMaterialBuilder.cpp): the material editor's scripting library.
		PrivateDependencyModuleNames.Add("MaterialEditor");
		// Retargeting (VgeRetargeter.cpp): IK Rigs and retargeters generated and run the way the editor's Retarget
		// Animations window does.
		// Its editor headers declare Slate widgets, hence Slate and SlateCore.
		PrivateDependencyModuleNames.AddRange(new string[] { "IKRig", "IKRigEditor", "Slate", "SlateCore" });
		// Fab in the content service (VgeFab.cpp): EOS sign-in, HTTP, and BuildPatchServices' interfaces for the
		// engine Fab plugin's BuildPatchInstallerLib, loaded through that plugin's own header-only helper.
		PrivateDependencyModuleNames.AddRange(new string[] { "EOSSDK", "EOSShared", "HTTP", "BuildPatchServices", "Projects" });
		PrivateIncludePaths.Add(Path.Combine(EngineDirectory, "Plugins", "Fab", "Source", "Fab", "Private"));
		// Niagara systems described in TypeScript (VgeNiagara.cpp): the NiagaraToolsets plugin's tool calls, run through
		// the ToolsetRegistry, and the system's own compile.
		PrivateDependencyModuleNames.AddRange(new string[] { "ToolsetRegistry", "Niagara", "NiagaraEditor" });
		PrivateDependencyModuleNames.Add("Landscape");
		PrivateDependencyModuleNames.AddRange(new string[] { "PoseSearch", "AnimGraph", "AnimGraphRuntime", "AnimationWarpingRuntime", "BlueprintGraph", "Kismet" });
		// Ragdolls for imported skeletal meshes (VgeRagdoll.cpp): the editor's physics asset creation.
		PrivateDependencyModuleNames.AddRange(new string[] { "PhysicsUtilities", "PhysicsCore" });
		PrivateDependencyModuleNames.AddRange(new string[] { "ClothingSystemEditor", "ClothingSystemEditorInterface", "ClothingSystemRuntimeCommon", "ClothingSystemRuntimeInterface", "SkeletalMeshEditor", "ChaosCloth", "JsonUtilities" });
		// The game module's asset manager, which the cook of one build's content folders sets (VgeCookCommandlet.cpp).
		PrivateDependencyModuleNames.Add("VibeGameEngine");
		PrivateDependencyModuleNames.Add("ComputeFramework");
	}
}
