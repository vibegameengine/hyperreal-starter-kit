#include "VgeScriptLibrary.h"

#include "Components/ActorComponent.h"
#include "Components/PrimitiveComponent.h"
#include "EngineUtils.h"
#include "WaterZoneActor.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "ClothingSystemRuntimeTypes.h"
#include "Rendering/SkeletalMeshRenderData.h"
#include "SkeletalRenderPublic.h"
#include "Engine/Engine.h"
#include "Engine/LevelStreamingDynamic.h"
#include "Animation/AnimClassInterface.h"
#include "Animation/AnimInstance.h"
#include "PoseSearch/AnimNode_MotionMatching.h"
#include "PoseSearch/MotionMatchingAnimNodeLibrary.h"
#include "DynamicRHI.h"
#include "JsonObjectConverter.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "RenderTimer.h"

namespace
{
	bool FindMotionMatchingNode(UAnimInstance* Instance, FMotionMatchingAnimNodeReference& OutNode)
	{
		const IAnimClassInterface* AnimClass = Instance ? IAnimClassInterface::GetFromClass(Instance->GetClass()) : nullptr;
		const TArray<FStructProperty*> Nodes = AnimClass ? AnimClass->GetAnimNodeProperties() : TArray<FStructProperty*>();
		for (int32 Index = 0; Index < Nodes.Num(); ++Index)
		{
			if (Nodes[Index]->Struct->IsChildOf(FAnimNode_MotionMatching::StaticStruct()))
			{
				EAnimNodeReferenceConversionResult Converted;
				OutNode = UMotionMatchingAnimNodeLibrary::ConvertToMotionMatchingNode(FAnimNodeReference(Instance, Index), Converted);
				return Converted == EAnimNodeReferenceConversionResult::Succeeded;
			}
		}
		return false;
	}
}

FString UVgeScriptLibrary::DescribeMotionMatching(UAnimInstance* Instance)
{
	FMotionMatchingAnimNodeReference Node;
	if (!FindMotionMatchingNode(Instance, Node))
	{
		return TEXT("no motion matching node");
	}
	FPoseSearchBlueprintResult Result;
	bool bValid = false;
	UMotionMatchingAnimNodeLibrary::GetMotionMatchingSearchResult(Node, Result, bValid);
	if (!bValid)
	{
		return TEXT("invalid");
	}
	return FString::Printf(TEXT("%s|%.3f|%.3f|%d|%.3f"), Result.SelectedAnim ? *Result.SelectedAnim->GetName() : TEXT("none"), Result.SelectedTime, Result.SearchCost, Result.bIsContinuingPoseSearch ? 1 : 0, Result.WantedPlayRate);
}

bool UVgeScriptLibrary::SetMotionMatchingDatabase(UAnimInstance* Instance, UPoseSearchDatabase* Database, EPoseSearchInterruptMode InterruptMode)
{
	FMotionMatchingAnimNodeReference Node;
	if (!Database || !FindMotionMatchingNode(Instance, Node))
	{
		return false;
	}
	UMotionMatchingAnimNodeLibrary::SetDatabaseToSearch(Node, Database, InterruptMode);
	return true;
}

int32 UVgeScriptLibrary::SetAnimNodeFields(UAnimInstance* Instance, const FString& NodeStruct, const FString& FieldsJson)
{
	TSharedPtr<FJsonObject> Fields;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(FieldsJson);
	const IAnimClassInterface* AnimClass = Instance ? IAnimClassInterface::GetFromClass(Instance->GetClass()) : nullptr;
	if (!AnimClass || !FJsonSerializer::Deserialize(Reader, Fields) || !Fields.IsValid())
	{
		return 0;
	}
	int32 Written = 0;
	for (const FStructProperty* Node : AnimClass->GetAnimNodeProperties())
	{
		for (const UStruct* Struct = Node->Struct; Struct; Struct = Struct->GetSuperStruct())
		{
			if (Struct->GetName() == NodeStruct)
			{
				Written += FJsonObjectConverter::JsonObjectToUStruct(Fields.ToSharedRef(), Node->Struct, Node->ContainerPtrToValuePtr<void>(Instance), 0, 0) ? 1 : 0;
				break;
			}
		}
	}
	return Written;
}

ULevelStreamingDynamic* UVgeScriptLibrary::LoadLevelInstance(UObject* WorldContext, const FString& PackageName, FVector Location)
{
	UWorld* World = GEngine->GetWorldFromContextObject(WorldContext, EGetWorldErrorMode::LogAndReturnNull);
	if (!World)
	{
		return nullptr;
	}
	bool bSuccess = false;
	return ULevelStreamingDynamic::LoadLevelInstance(ULevelStreamingDynamic::FLoadLevelInstanceParams(World, PackageName, FTransform(Location)), bSuccess);
}

TArray<FVector> UVgeScriptLibrary::ClothParticles(USkeletalMeshComponent* Component)
{
	TArray<FVector> World;
	if (!Component)
	{
		return World;
	}
	for (const TPair<int32, FClothSimulData>& Entry : Component->GetCurrentClothingData_GameThread())
	{
		for (const FVector3f& Position : Entry.Value.Positions)
		{
			World.Add(Entry.Value.Transform.TransformPosition(FVector(Position)));
		}
	}
	return World;
}

TArray<FVector> UVgeScriptLibrary::ClothNormals(USkeletalMeshComponent* Component)
{
	TArray<FVector> World;
	if (!Component)
	{
		return World;
	}
	for (const TPair<int32, FClothSimulData>& Entry : Component->GetCurrentClothingData_GameThread())
	{
		for (const FVector3f& Normal : Entry.Value.Normals)
		{
			World.Add(Entry.Value.Transform.TransformVectorNoScale(FVector(Normal)));
		}
	}
	return World;
}

TArray<FVector> UVgeScriptLibrary::RenderedVertices(USkeletalMeshComponent* Component, int32 Section)
{
	TArray<FVector> World;
	const FSkeletalMeshRenderData* RenderData = Component ? Component->GetSkeletalMeshRenderData() : nullptr;
	if (!RenderData || RenderData->LODRenderData.Num() == 0 || !RenderData->LODRenderData[0].RenderSections.IsValidIndex(Section))
	{
		return World;
	}
	TArray<FFinalSkinVertex> Vertices;
	Component->GetCPUSkinnedVertices(Vertices, 0);
	const FSkelMeshRenderSection& Rendered = RenderData->LODRenderData[0].RenderSections[Section];
	const FTransform ComponentToWorld = Component->GetComponentTransform();
	for (uint32 Index = Rendered.BaseVertexIndex; Index < Rendered.BaseVertexIndex + Rendered.NumVertices && Index < static_cast<uint32>(Vertices.Num()); ++Index)
	{
		World.Add(ComponentToWorld.TransformPosition(FVector(Vertices[Index].Position)));
	}
	return World;
}

void UVgeScriptLibrary::SetInstances(UInstancedStaticMeshComponent* Component, const TArray<FTransform>& Transforms, const TArray<float>& CustomData)
{
	if (!Component)
	{
		return;
	}
	const int32 Count = Transforms.Num();
	if (Component->GetInstanceCount() != Count)
	{
		Component->ClearInstances();
		Component->AddInstances(Transforms, false, true, false);
	}
	else if (Count > 0)
	{
		Component->BatchUpdateInstancesTransforms(0, Transforms, true, false, true);
	}
	const int32 Floats = Component->NumCustomDataFloats;
	if (Count > 0 && Floats > 0 && CustomData.Num() == Count * Floats)
	{
		Component->SetCustomData(0, Count - 1, CustomData, false);
	}
	Component->MarkRenderStateDirty();
}

void UVgeScriptLibrary::ReregisterComponent(UActorComponent* Component)
{
	if (Component && Component->IsRegistered())
	{
		Component->ReregisterComponent();
	}
}

FVgeFrameTimes UVgeScriptLibrary::FrameTimes()
{
	FVgeFrameTimes Times;
	Times.GameMs = FPlatformTime::ToMilliseconds(GGameThreadTime);
	Times.GpuMs = FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles());
	return Times;
}

void UVgeScriptLibrary::RefreshWaterZones(UObject* WorldContext)
{
	UWorld* World = GEngine->GetWorldFromContextObject(WorldContext, EGetWorldErrorMode::LogAndReturnNull);
	if (!World)
	{
		return;
	}
	TArray<AWaterZone*> Zones;
	for (TActorIterator<AWaterZone> It(World); It; ++It)
	{
		Zones.Add(*It);
	}
	for (AWaterZone* Zone : Zones)
	{
		if (Zone->GetWaterZoneIndex() >= Zones.Num())
		{
			Zone->UnregisterAllComponents();
			TInlineComponentArray<UPrimitiveComponent*> Primitives(Zone);
			for (UPrimitiveComponent* Primitive : Primitives)
			{
				Primitive->PrecachePSOs();
			}
			Zone->RegisterAllComponents();
		}
		Zone->MarkForRebuild(EWaterZoneRebuildFlags::All);
	}
}
