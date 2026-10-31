#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "ArrayBuffer.h"
#include "PoseSearch/PoseSearchLibrary.h"
#include "VgeScriptLibrary.generated.h"

class UActorComponent;
class UAnimInstance;
class UAnimSequenceBase;
class USkeletalMesh;
class UInstancedStaticMeshComponent;
class UPoseSearchDatabase;
class ULevelStreamingDynamic;
class USkeletalMeshComponent;
class UTexture2D;

USTRUCT(BlueprintType)
struct FVgeFrameTimes
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Vge")
	float GameMs = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Vge")
	float GpuMs = 0;
};

// Engine calls the scene renderer needs and Unreal does not expose as UFunctions.
UCLASS()
class VIBEGAMEENGINE_API UVgeScriptLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	// After properties of a registered component were written directly (no setter), recreates its render and
	// physics state from them, as an edit in the editor does. An actor's native components are registered as
	// soon as it is spawned, deferred or not (AActor::PostSpawnInitialize), so this is how they see such writes.
	UFUNCTION(BlueprintCallable, Category = "Vge")
	static void ReregisterComponent(UActorComponent* Component);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static TArray<FVector> ClothParticles(USkeletalMeshComponent* Component);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static TArray<FVector> ClothNormals(USkeletalMeshComponent* Component);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static TArray<FVector> RenderedVertices(USkeletalMeshComponent* Component, int32 Section);

	UFUNCTION(BlueprintCallable, Category = "Vge", meta = (WorldContext = "WorldContext"))
	static ULevelStreamingDynamic* LoadLevelInstance(UObject* WorldContext, const FString& PackageName, FVector Location);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static FString DescribeMotionMatching(UAnimInstance* Instance);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static bool SetMotionMatchingDatabase(UAnimInstance* Instance, UPoseSearchDatabase* Database, EPoseSearchInterruptMode InterruptMode);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static int32 SetAnimNodeFields(UAnimInstance* Instance, const FString& NodeStruct, const FString& FieldsJson);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static FString GetAnimNodeFields(UAnimInstance* Instance, const FString& NodeStruct);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static TArray<FVector> SampleClipRootMotion(UAnimSequenceBase* Clip, float StepSeconds);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static TArray<FVector> SampleClipBones(UAnimSequenceBase* Clip, USkeletalMesh* Mesh, const TArray<FName>& Bones, float StepSeconds);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static void SetInstances(UInstancedStaticMeshComponent* Component, const TArray<FTransform>& Transforms, const TArray<float>& CustomData);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static UTexture2D* CreateFloatTexture(int32 Width, int32 Height, FArrayBuffer Pixels);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	static FVgeFrameTimes FrameTimes();

	UFUNCTION(BlueprintCallable, Category = "Vge", meta = (WorldContext = "WorldContext"))
	static void RefreshWaterZones(UObject* WorldContext);
};
