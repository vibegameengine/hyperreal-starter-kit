#include "VgeComputeBuilder.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "ComputeFramework/ComputeGraph.h"
#include "ComputeFramework/ComputeGraphBuilder.h"
#include "ComputeFramework/ComputeKernelSource.h"
#include "FileHelpers.h"
#include "VgeCompute.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeCompute, Log, All);

namespace
{
	TSharedRef<FJsonObject> Failure(const FString& Error)
	{
		TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
		Result->SetStringField(TEXT("error"), Error);
		return Result;
	}

	FIntVector ReadVector(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		FIntVector Result(1, 1, 1);
		if (Object->TryGetArrayField(Field, Values))
		{
			for (int32 Axis = 0; Axis < FMath::Min(3, Values->Num()); Axis++)
			{
				Result[Axis] = FMath::Max(1, (int32)(*Values)[Axis]->AsNumber());
			}
		}
		return Result;
	}

	TArray<FString> ReadStrings(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
	{
		TArray<FString> Result;
		Object->TryGetStringArrayField(Field, Result);
		return Result;
	}

	UComputeGraph* NewGraph(const FString& Path, FString& Error)
	{
		const FString Name = FPackageName::GetLongPackageAssetName(Path);
		if (!FPackageName::IsValidLongPackageName(Path) || Name.IsEmpty())
		{
			Error = FString::Printf(TEXT("'%s' is not a package path"), *Path);
			return nullptr;
		}
		UPackage* Package = CreatePackage(*Path);
		Package->FullyLoad();
		if (UObject* Existing = StaticFindObject(UObject::StaticClass(), Package, *Name))
		{
			Existing->Rename(nullptr, GetTransientPackage(), REN_DontCreateRedirectors | REN_NonTransactional);
			Existing->ClearFlags(RF_Public | RF_Standalone);
		}
		UComputeGraph* Graph = NewObject<UComputeGraph>(Package, *Name, RF_Public | RF_Standalone | RF_Transactional);
		FAssetRegistryModule::AssetCreated(Graph);
		return Graph;
	}

	struct FResource
	{
		FInterfaceHandle Handle;
		FString Kind;
		TArray<FString> Inputs;
		TArray<FString> Outputs;
	};

	FResource AddResource(FComputeGraphBuilder& Builder, UComputeGraph* Graph, const TSharedPtr<FJsonObject>& Description)
	{
		FResource Resource;
		const FString Name = Description->GetStringField(TEXT("name"));
		Resource.Kind = Description->GetStringField(TEXT("kind"));
		UComputeDataInterface* Interface = nullptr;
		if (Resource.Kind == TEXT("texture"))
		{
			UVgeComputeTexture* Texture = NewObject<UVgeComputeTexture>(Graph);
			Texture->ResourceName = Name;
			Interface = Texture;
			Resource.Inputs = { TEXT("Size"), TEXT("Load") };
			Resource.Outputs = { TEXT("Store") };
		}
		else if (Resource.Kind == TEXT("buffer"))
		{
			UVgeComputeBuffer* Buffer = NewObject<UVgeComputeBuffer>(Graph);
			Buffer->ResourceName = Name;
			Buffer->Elements = (int32)Description->GetNumberField(TEXT("elements"));
			Buffer->Components = (int32)Description->GetNumberField(TEXT("components"));
			Interface = Buffer;
			Resource.Inputs = { TEXT("Count"), TEXT("Load") };
			Resource.Outputs = { TEXT("Store") };
		}
		else
		{
			UVgeComputeParams* Params = NewObject<UVgeComputeParams>(Graph);
			Params->Names = ReadStrings(Description, TEXT("names"));
			Interface = Params;
			Resource.Inputs = Params->Names;
		}
		Resource.Handle = Builder.AddDataInterface(Interface, UVgeComputeComponent::StaticClass(), FName(*Name));
		return Resource;
	}

	void AddKernel(FComputeGraphBuilder& Builder, UComputeGraph* Graph, const TSharedPtr<FJsonObject>& Description, const TMap<FString, FResource>& Resources)
	{
		const FString Name = Description->GetStringField(TEXT("name"));
		UComputeKernelSourceWithText* Source = NewObject<UComputeKernelSourceWithText>(Graph);
		Source->EntryPoint = Name;
		Source->GroupSize = ReadVector(Description, TEXT("group"));
		Source->SourceText = Description->GetStringField(TEXT("source"));
		const FKernelHandle Kernel = Builder.AddKernel(Source, FName(*Name));

		UVgeComputeDispatch* Dispatch = NewObject<UVgeComputeDispatch>(Graph);
		Dispatch->ThreadCount = ReadVector(Description, TEXT("threads"));
		Builder.ConnectInput(Kernel, TEXT("NumThreads"), Builder.AddDataInterface(Dispatch, UVgeComputeComponent::StaticClass()), TEXT("ReadNumThreads"));

		const auto Prefix = [](const FString& Used, const FResource& Resource) { return Resource.Kind == TEXT("params") ? FString() : Used; };
		for (const FString& Used : ReadStrings(Description, TEXT("reads")))
		{
			if (const FResource* Resource = Resources.Find(Used))
			{
				for (const FString& Function : Resource->Inputs)
				{
					Builder.ConnectInput(Kernel, Prefix(Used, *Resource) + Function, Resource->Handle, Function);
				}
			}
		}
		for (const FString& Used : ReadStrings(Description, TEXT("writes")))
		{
			if (const FResource* Resource = Resources.Find(Used))
			{
				for (const FString& Function : Resource->Outputs)
				{
					Builder.ConnectOutput(Kernel, Prefix(Used, *Resource) + Function, Resource->Handle, Function);
				}
			}
		}
	}
}

TSharedRef<FJsonObject> VgeComputeBuilder::Build(const TSharedPtr<FJsonObject>& Request)
{
	FString Error;
	UComputeGraph* Graph = NewGraph(Request->GetStringField(TEXT("path")), Error);
	if (!Graph)
	{
		return Failure(Error);
	}
	FComputeGraphBuilder Builder;
	TMap<FString, FResource> Resources;
	for (const TSharedPtr<FJsonValue>& Value : Request->GetArrayField(TEXT("resources")))
	{
		const TSharedPtr<FJsonObject> Description = Value->AsObject();
		Resources.Add(Description->GetStringField(TEXT("name")), AddResource(Builder, Graph, Description));
	}
	for (const TSharedPtr<FJsonValue>& Value : Request->GetArrayField(TEXT("kernels")))
	{
		AddKernel(Builder, Graph, Value->AsObject(), Resources);
	}
	Builder.Build(*Graph, *Graph);
	FString Invalid;
	if (!Graph->ValidateGraph(&Invalid))
	{
		return Failure(FString::Printf(TEXT("%s is not a valid compute graph: %s"), *Graph->GetPathName(), *Invalid));
	}
	Graph->MarkPackageDirty();
	if (!UEditorLoadingAndSavingUtils::SavePackages({ Graph->GetPackage() }, false))
	{
		return Failure(FString::Printf(TEXT("%s could not be saved"), *Graph->GetPathName()));
	}
	UE_LOGF(LogVgeCompute, Display, "Saved %ls", *Graph->GetPathName());
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("path"), Graph->GetPathName());
	Result->SetBoolField(TEXT("saved"), true);
	return Result;
}
