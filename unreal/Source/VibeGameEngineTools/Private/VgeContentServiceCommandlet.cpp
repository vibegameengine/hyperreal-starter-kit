#include "VgeContentServiceCommandlet.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Async/TaskGraphInterfaces.h"
#include "Containers/Queue.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "HAL/Runnable.h"
#include "HAL/RunnableThread.h"
#include "Misc/CoreDelegates.h"
#include "VgeComputeBuilder.h"
#include "VgeFab.h"
#include "VgeImporter.h"
#include "VgeMaterialBuilder.h"
#include "VgeNiagara.h"
#include "VgeGroom.h"
#include "VgeObjects.h"
#include "VgeRetargeter.h"
#include "VgeMotionMatching.h"
#include "VgeTerrain.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UObjectGlobals.h"

#include <atomic>
#include <cstdio>
#include <iostream>
#include <string>

DEFINE_LOG_CATEGORY_STATIC(LogVgeService, Log, All);

namespace
{
	// Reads request lines from stdin on its own thread; the game thread executes them.
	class FStdinReader : public FRunnable
	{
	public:
		TQueue<FString, EQueueMode::Spsc> Lines;
		std::atomic<bool> bClosed{ false };

		virtual uint32 Run() override
		{
			std::string Line;
			while (std::getline(std::cin, Line))
			{
				Lines.Enqueue(UTF8_TO_TCHAR(Line.c_str()));
			}
			bClosed = true;
			return 0;
		}
	};

	void Emit(const TSharedRef<FJsonObject>& Message)
	{
		FString Json;
		FJsonSerializer::Serialize(Message, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));
		const FTCHARToUTF8 Utf8(*Json);
		std::printf("@@vge %s\n", Utf8.Get());
		std::fflush(stdout);
	}

	TSharedRef<FJsonObject> Handle(const TSharedPtr<FJsonObject>& Request)
	{
		const FString Command = Request->GetStringField(TEXT("cmd"));
		TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
		if (Command == TEXT("many"))
		{
			TArray<TSharedPtr<FJsonValue>> Results;
			for (const TSharedPtr<FJsonValue>& Item : Request->GetArrayField(TEXT("requests")))
			{
				Results.Add(MakeShared<FJsonValueObject>(Handle(Item->AsObject())));
			}
			Result->SetArrayField(TEXT("results"), Results);
		}
		else if (Command == TEXT("import"))
		{
			const TSharedPtr<FJsonObject>* Cloth = nullptr;
			Request->TryGetObjectField(TEXT("cloth"), Cloth);
			const TSharedPtr<FJsonObject>* MeshSettings = nullptr;
			Request->TryGetObjectField(TEXT("mesh"), MeshSettings);
			Result = VgeImporter::Import(Request->GetStringField(TEXT("source")), Request->GetStringField(TEXT("dest")), Cloth ? *Cloth : nullptr, MeshSettings ? *MeshSettings : nullptr);
			if (!Result->GetBoolField(TEXT("saved")))
			{
				Result->SetStringField(TEXT("error"), TEXT("nothing was imported; see the service log"));
			}
		}
		else if (Command == TEXT("import-many"))
		{
			TArray<VgeImporter::FImportRequest> Requests;
			for (const TSharedPtr<FJsonValue>& Value : Request->GetArrayField(TEXT("items")))
			{
				const TSharedPtr<FJsonObject> Item = Value->AsObject();
				VgeImporter::FImportRequest& Import = Requests.AddDefaulted_GetRef();
				Import.Source = Item->GetStringField(TEXT("source"));
				Import.Dest = Item->GetStringField(TEXT("dest"));
				const TSharedPtr<FJsonObject>* Cloth = nullptr;
				if (Item->TryGetObjectField(TEXT("cloth"), Cloth))
				{
					Import.Cloth = *Cloth;
				}
				const TSharedPtr<FJsonObject>* MeshSettings = nullptr;
				if (Item->TryGetObjectField(TEXT("mesh"), MeshSettings))
				{
					Import.MeshSettings = *MeshSettings;
				}
			}
			TArray<TSharedPtr<FJsonValue>> Reports;
			for (const TSharedRef<FJsonObject>& Report : VgeImporter::ImportMany(Requests))
			{
				if (!Report->GetBoolField(TEXT("saved")))
				{
					Report->SetStringField(TEXT("itemError"), TEXT("nothing was imported; see the service log"));
				}
				Reports.Add(MakeShared<FJsonValueObject>(Report));
			}
			Result->SetArrayField(TEXT("items"), Reports);
		}
		else if (Command == TEXT("import-animations"))
		{
			Result = VgeImporter::ImportAnimations(Request->GetStringField(TEXT("source")), Request->GetStringField(TEXT("dest")), Request->GetStringField(TEXT("skeleton")), Request);
			if (!Result->HasField(TEXT("error")) && !Result->GetBoolField(TEXT("saved")))
			{
				Result->SetStringField(TEXT("error"), TEXT("no animation was imported; see the service log"));
			}
		}
		else if (Command == TEXT("import-sound"))
		{
			Result = VgeImporter::ImportSound(Request->GetStringField(TEXT("source")), Request->GetStringField(TEXT("dest")));
			if (!Result->GetBoolField(TEXT("saved")))
			{
				Result->SetStringField(TEXT("error"), TEXT("no sound was imported; see the service log"));
			}
		}
		else if (Command == TEXT("retarget"))
		{
			Result = VgeRetargeter::Retarget(Request);
		}
		else if (Command == TEXT("material"))
		{
			Result = VgeMaterialBuilder::BuildMaterial(Request);
		}
		else if (Command == TEXT("material-instance"))
		{
			Result = VgeMaterialBuilder::BuildMaterialInstance(Request);
		}
		else if (Command == TEXT("compute"))
		{
			Result = VgeComputeBuilder::Build(Request);
		}
		else if (Command == TEXT("niagara-tools"))
		{
			Result = VgeNiagara::RunTools(Request);
		}
		else if (Command == TEXT("niagara-schemas"))
		{
			Result = VgeNiagara::Schemas();
		}
		else if (Command == TEXT("niagara-save"))
		{
			Result = VgeNiagara::Save(Request);
		}
		else if (Command == TEXT("niagara-constants"))
		{
			Result = VgeNiagara::SetConstants(Request);
		}
		else if (Command == TEXT("terrain"))
		{
			Result = VgeTerrain::Build(Request);
		}
		else if (Command == TEXT("motion-matching"))
		{
			Result = VgeMotionMatching::Build(Request);
		}
		else if (Command == TEXT("set-properties"))
		{
			Result = VgeObjects::SetProperties(Request);
		}
		else if (Command == TEXT("save"))
		{
			Result = VgeObjects::Save(Request);
		}
		else if (Command == TEXT("call"))
		{
			Result = VgeObjects::Call(Request);
		}
		else if (Command == TEXT("create-class"))
		{
			Result = VgeObjects::CreateClass(Request);
		}
		else if (Command == TEXT("groom-binding"))
		{
			Result = VgeGroom::Bind(Request);
		}
		else if (Command == TEXT("delete"))
		{
			TArray<FString> Paths;
			if (!Request->TryGetStringArrayField(TEXT("paths"), Paths))
			{
				Paths.Add(Request->GetStringField(TEXT("path")));
			}
			Result->SetNumberField(TEXT("deleted"), VgeImporter::DeleteContentPaths(Paths));
		}
		else if (Command != TEXT("ping"))
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("unknown command '%s'"), *Command));
		}
		return Result;
	}
}

int32 UVgeContentServiceCommandlet::Main(const FString& Params)
{
	// The asset registry must know everything on disk before imports replace or delete assets.
	FAssetRegistryModule::GetRegistry().SearchAllAssets(/*bSynchronousSearch*/ true);

	FStdinReader Reader;
	TUniquePtr<FRunnableThread> ReaderThread(FRunnableThread::Create(&Reader, TEXT("VgeServiceStdin")));

	TSharedRef<FJsonObject> Ready = MakeShared<FJsonObject>();
	Ready->SetStringField(TEXT("event"), TEXT("ready"));
	Emit(Ready);
	UE_LOGF(LogVgeService, Display, "Content service ready");

	double LastTick = FPlatformTime::Seconds();
	while (!IsEngineExitRequested())
	{
		FString Line;
		while (Reader.Lines.Dequeue(Line))
		{
			TSharedPtr<FJsonObject> Request;
			if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Line), Request) || !Request.IsValid())
			{
				UE_LOGF(LogVgeService, Error, "Ignoring malformed request: %ls", *Line);
				continue;
			}
			const double Started = FPlatformTime::Seconds();
			const double Id = Request->GetNumberField(TEXT("id"));
			auto Answer = [Id, Started](TSharedRef<FJsonObject> Result)
			{
				TSharedRef<FJsonObject> Reply = MakeShared<FJsonObject>();
				Reply->SetNumberField(TEXT("id"), Id);
				Reply->SetBoolField(TEXT("ok"), !Result->HasField(TEXT("error")));
				Reply->SetObjectField(TEXT("result"), Result);
				Reply->SetNumberField(TEXT("seconds"), FPlatformTime::Seconds() - Started);
				Emit(Reply);
			};
			// Fab's commands answer later (a sign-in, a download), with progress events before: the loop goes on
			// serving other requests meanwhile.
			auto Progress = [Id](TSharedRef<FJsonObject> Event)
			{
				Event->SetStringField(TEXT("event"), TEXT("progress"));
				Event->SetNumberField(TEXT("id"), Id);
				Emit(Event);
			};
			if (VgeFab::Handle(Request->GetStringField(TEXT("cmd")), Request, Answer, Progress))
			{
				continue;
			}
			const TSharedRef<FJsonObject> Result = Handle(Request);
			CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
			Answer(Result);
		}

		if (Reader.bClosed && Reader.Lines.IsEmpty())
		{
			UE_LOGF(LogVgeService, Display, "stdin closed, content service exits");
			break;
		}

		// Keep the engine's game-thread work moving between requests (async compilation, tickers).
		const double Now = FPlatformTime::Seconds();
		FTaskGraphInterface::Get().ProcessThreadUntilIdle(ENamedThreads::GameThread);
		FTSTicker::GetCoreTicker().Tick(static_cast<float>(Now - LastTick));
		LastTick = Now;
		FPlatformProcess::Sleep(0.01f);
	}

	// The reader thread is blocked in getline on a closed pipe only when the owner is gone.
	ReaderThread->Kill(/*bShouldWait*/ false);
	return 0;
}
