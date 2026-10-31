#include "VgeGameInstance.h"

#include "ContentStreaming.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "HAL/PlatformTime.h"
#include "GenericPlatform/GenericPlatformFile.h"
#include "Interfaces/IPluginManager.h"
#include "JsEnv.h"
#include "Misc/CommandLine.h"
#include "Misc/CoreDelegates.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "AI/NavigationSystemBase.h"
#include "VgeUI.h"
#include "ShaderCodeLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogVge, Log, All);

void UVgeGameInstance::StartGameInstance()
{
	const TCHAR* CommandLine = FCommandLine::Get();
	if (!FParse::Value(CommandLine, TEXT("-DevServer="), DevServerUrl))
	{
		DevServerUrl = TEXT("ws://127.0.0.1:5173/__unreal");
	}
	if (!FParse::Value(CommandLine, TEXT("-Entry="), EntryModule))
	{
		EntryModule = TEXT("/src/main.ts");
	}

	UI = NewObject<UVgeUI>(this, TEXT("UI"));
	EnterCodeBuiltWorld();
	UE_LOGF(LogVge, Display, "World ready without a map at %.3f s", SecondsSinceProcessStart());

	JsEnv = MakeShared<PUERTS_NAMESPACE::FJsEnv>(TEXT("JavaScript"));
	TArray<TPair<FString, UObject*>> Arguments;
	Arguments.Add(TPair<FString, UObject*>(TEXT("GameInstance"), this));
	// A Shipping game is the release build (`npm run build`): it runs the program bundled into
	// Content/JavaScript/vge/game.js. Every other configuration runs the dev bootstrap, which takes the
	// program from the dev server.
#if UE_BUILD_SHIPPING
	JsEnv->Start(TEXT("vge/game"), Arguments);
#else
	JsEnv->Start(TEXT("vge/bootstrap"), Arguments);
#endif
	UE_LOGF(LogVge, Display, "Script bootstrap started at %.3f s", SecondsSinceProcessStart());

	// Not the core ticker: it runs after GEngine->Tick (LaunchEngineLoop.cpp), when the world has ticked and the frame
	// has been drawn, so whatever script set there showed a frame late.
	TickHandle = FWorldDelegates::OnWorldTickStart.AddUObject(this, &UVgeGameInstance::OnWorldTickStart);

	BroadcastOnStart();
}

void UVgeGameInstance::OnWorldTickStart(UWorld* World, ELevelTick TickType, float DeltaSeconds)
{
	if (World == GetWorld())
	{
		OnTick.Broadcast(DeltaSeconds);
	}
}

// UGameInstance::InitializeStandalone already created a world with no package and bound the game
// viewport to it. This runs the gameplay half of UEngine::LoadMap on that world instead of browsing to a map.
void UVgeGameInstance::EnterCodeBuiltWorld()
{
	UWorld* World = GetWorld();
	check(World);

	// UWorld::CreateWorld gives that placeholder world ShouldSimulatePhysics(false) (World.cpp); a world
	// loaded from a map is initialized with the defaults, which simulate physics.
	World->bShouldSimulatePhysics = true;

	FURL URL;
	World->SetGameMode(URL);
	World->CreateAISystem();
	World->InitializeActorsForPlay(URL, true);
	FNavigationSystem::AddNavigationSystemToWorld(*World, FNavigationSystemRunMode::GameMode);
	World->FlushLevelStreaming(EFlushLevelStreamingType::Visibility);
	GetWorldContext()->LastURL = URL;

	for (auto It = GetLocalPlayerIterator(); It; ++It)
	{
		FString Error;
		if (!(*It)->SpawnPlayActor(URL.ToString(1), Error, World))
		{
			UE_LOGF(LogVge, Fatal, "Couldn't spawn player: %ls", *Error);
		}
	}

	IStreamingManager::Get().NotifyLevelChange();
	World->BeginPlay();
	World->bWorldWasLoadedThisTick = true;
}

void UVgeGameInstance::Shutdown()
{
	FWorldDelegates::OnWorldTickStart.Remove(TickHandle);
	OnTick.Clear();
	if (UI)
	{
		UI->Hide();
	}
	JsEnv.Reset();
	Super::Shutdown();
}

bool UVgeGameInstance::MountContent(const FString& PakPath, const FString& PluginName, const FString& ShaderLibrary)
{
	if (!FCoreDelegates::MountPak.IsBound())
	{
		UE_LOGF(LogVge, Error, "MountContent: no pak platform file is active, cannot mount %ls", *PakPath);
		return false;
	}

	// Containers mounted later get a higher order so a newer version of a package wins.
	static int32 NextPakOrder = 1000;
	IPakFile* Pak = FCoreDelegates::MountPak.Execute(PakPath, NextPakOrder++);
	if (!Pak)
	{
		UE_LOGF(LogVge, Error, "MountContent: failed to mount %ls", *PakPath);
		return false;
	}

	if (!ShaderLibrary.IsEmpty())
	{
		// A library in an IoStore container is found by its name (FIoStoreShaderCodeArchive::Create looks up the
		// chunk named after the library and the shader format); the directory only tells libraries apart by path.
		const bool bOpened = FShaderCodeLibrary::OpenLibrary(ShaderLibrary, FPaths::ProjectContentDir(), /*bMonolithicOnly*/ true);
		UE_LOGF(LogVge, Display, "MountContent: shader library %ls %ls", *ShaderLibrary, bOpened ? TEXT("opened") : TEXT("not found"));
	}
	else
	{
		// The plugin was mounted at startup before this container existed, so its shader library was not found then.
		TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(PluginName);
		if (Plugin.IsValid())
		{
			FShaderCodeLibrary::OpenLibrary(Plugin->GetName(), Plugin->GetContentDir(), /*bMonolithicOnly*/ true);
		}
	}
	UE_LOGF(LogVge, Display, "MountContent: mounted %ls at %ls (plugin %ls)", *PakPath, *Pak->PakGetMountPoint(), *PluginName);
	return true;
}


double UVgeGameInstance::SecondsSinceProcessStart() const
{
	return FPlatformTime::Seconds() - GStartTime;
}
