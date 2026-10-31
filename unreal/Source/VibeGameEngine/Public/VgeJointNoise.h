#pragma once

#include "CoreMinimal.h"
#include "BoneContainer.h"
#include "BoneControllers/AnimNode_SkeletalControlBase.h"
#include "VgeJointNoise.generated.h"

USTRUCT()
struct VIBEGAMEENGINE_API FVgeJointNoise
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Noise")
	FBoneReference Bone;

	UPROPERTY(EditAnywhere, Category = "Noise")
	FRotator Amplitude = FRotator::ZeroRotator;

	UPROPERTY(EditAnywhere, Category = "Noise")
	float Frequency = 0.5f;

	UPROPERTY(EditAnywhere, Category = "Noise")
	FRotator MinAngles = FRotator(-180.0);

	UPROPERTY(EditAnywhere, Category = "Noise")
	FRotator MaxAngles = FRotator(180.0);
};

USTRUCT()
struct VIBEGAMEENGINE_API FVgeAnimNode_JointNoise : public FAnimNode_SkeletalControlBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Noise")
	TArray<FVgeJointNoise> Joints;

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void UpdateInternal(const FAnimationUpdateContext& Context) override;
	virtual void EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms) override;
	virtual bool IsValidToEvaluate(const USkeleton* Skeleton, const FBoneContainer& RequiredBones) override;

private:
	virtual void InitializeBoneReferences(const FBoneContainer& RequiredBones) override;

	double Time = 0.0;
	double Seed = 0.0;
};
