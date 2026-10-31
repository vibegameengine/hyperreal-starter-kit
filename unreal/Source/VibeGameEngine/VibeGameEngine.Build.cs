using UnrealBuildTool;

public class VibeGameEngine : ModuleRules
{
	public VibeGameEngine(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PublicDependencyModuleNames.Add("JsEnv");
		PublicDependencyModuleNames.AddRange(new string[] { "ComputeFramework", "RenderCore" });
		PrivateDependencyModuleNames.Add("RHI");
		PrivateDependencyModuleNames.AddRange(new string[] { "Projects", "RenderCore", "WebBrowser", "Slate", "SlateCore", "InputCore", "Json", "JsonUtilities", "AnimGraphRuntime", "ClothingSystemRuntimeInterface", "PoseSearch" });
	}
}
