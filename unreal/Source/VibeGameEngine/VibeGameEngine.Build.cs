using UnrealBuildTool;

public class VibeGameEngine : ModuleRules
{
	public VibeGameEngine(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PublicDependencyModuleNames.Add("JsEnv");
		PublicDependencyModuleNames.Add("PoseSearch");
		PublicDependencyModuleNames.Add("AnimationWarpingRuntime");
		PrivateDependencyModuleNames.Add("AnimationCore");
		PublicDependencyModuleNames.AddRange(new string[] { "InterchangeCore", "InterchangeEngine" });
		PublicDependencyModuleNames.AddRange(new string[] { "ComputeFramework", "RenderCore" });
		PrivateDependencyModuleNames.Add("RHI");
		PrivateDependencyModuleNames.Add("Water");
		PrivateDependencyModuleNames.AddRange(new string[] { "Projects", "RenderCore", "WebBrowser", "Slate", "SlateCore", "InputCore", "Json", "JsonUtilities", "AnimGraphRuntime", "ClothingSystemRuntimeInterface", "PoseSearch" });
	}
}
