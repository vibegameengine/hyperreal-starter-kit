#include "VgeScriptLibrary.h"

#include "Components/ActorComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "ClothingSystemRuntimeTypes.h"
#include "Rendering/SkeletalMeshRenderData.h"
#include "SkeletalRenderPublic.h"
#include "Engine/Engine.h"
#include "Engine/Texture2D.h"
#include "Engine/LevelStreamingDynamic.h"
#include "Animation/AnimClassInterface.h"
#include "Animation/AnimInstance.h"
#include "PoseSearch/AnimNode_MotionMatching.h"
#include "PoseSearch/MotionMatchingAnimNodeLibrary.h"

FString UVgeScriptLibrary::DescribeMotionMatching(UAnimInstance* Instance)
{
	const IAnimClassInterface* AnimClass = Instance ? IAnimClassInterface::GetFromClass(Instance->GetClass()) : nullptr;
	if (!AnimClass)
	{
		return FString();
	}
	const TArray<FStructProperty*>& Nodes = AnimClass->GetAnimNodeProperties();
	for (int32 Index = 0; Index < Nodes.Num(); ++Index)
	{
		if (!Nodes[Index]->Struct->IsChildOf(FAnimNode_MotionMatching::StaticStruct()))
		{
			continue;
		}
		EAnimNodeReferenceConversionResult Converted;
		const FMotionMatchingAnimNodeReference Node = UMotionMatchingAnimNodeLibrary::ConvertToMotionMatchingNode(FAnimNodeReference(Instance, Index), Converted);
		FPoseSearchBlueprintResult Result;
		bool bValid = false;
		UMotionMatchingAnimNodeLibrary::GetMotionMatchingSearchResult(Node, Result, bValid);
		if (!bValid)
		{
			return TEXT("invalid");
		}
		return FString::Printf(TEXT("%s|%.3f|%.3f|%d|%.3f"), Result.SelectedAnim ? *Result.SelectedAnim->GetName() : TEXT("none"), Result.SelectedTime, Result.SearchCost, Result.bIsContinuingPoseSearch ? 1 : 0, Result.WantedPlayRate);
	}
	return TEXT("no motion matching node");
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

UTexture2D* UVgeScriptLibrary::CreateFloatTexture(int32 Width, int32 Height, FArrayBuffer Pixels)
{
	const int64 Bytes = int64(Width) * Height * 4 * sizeof(float);
	if (Width <= 0 || Height <= 0 || !Pixels.Data || int64(Pixels.Length) != Bytes)
	{
		UE_LOG(LogTemp, Error, TEXT("CreateFloatTexture: %dx%d needs %lld bytes of RGBA floats, got %lld"), Width, Height, Bytes, int64(Pixels.Length));
		return nullptr;
	}
	UTexture2D* Texture = UTexture2D::CreateTransient(Width, Height, PF_A32B32G32R32F);
	if (!Texture)
	{
		return nullptr;
	}
	Texture->SRGB = false;
	Texture->CompressionSettings = TC_HDR;
	Texture->Filter = TF_Bilinear;
	Texture->AddressX = TA_Clamp;
	Texture->AddressY = TA_Clamp;
	FTexture2DMipMap& Mip = Texture->GetPlatformData()->Mips[0];
	void* Target = Mip.BulkData.Lock(LOCK_READ_WRITE);
	FMemory::Memcpy(Target, Pixels.Data, Bytes);
	Mip.BulkData.Unlock();
	Texture->UpdateResource();
	return Texture;
}

void UVgeScriptLibrary::ReregisterComponent(UActorComponent* Component)
{
	if (Component && Component->IsRegistered())
	{
		Component->ReregisterComponent();
	}
}
