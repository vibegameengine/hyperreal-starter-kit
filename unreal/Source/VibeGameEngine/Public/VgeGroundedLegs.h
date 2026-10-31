#pragma once

#include "CoreMinimal.h"
#include "BoneControllers/AnimNode_FootPlacement.h"
#include "BoneControllers/AnimNode_StrideWarping.h"
#include "VgeGroundedLegs.generated.h"

USTRUCT()
struct VIBEGAMEENGINE_API FVgeAnimNode_GroundedLegs : public FAnimNode_FootPlacement
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Settings")
	FVector KneeForward = FVector(0.0, 1.0, 0.0);

	virtual void EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms) override;
};

USTRUCT()
struct VIBEGAMEENGINE_API FVgeAnimNode_StrideLegs : public FAnimNode_StrideWarping
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, Category = "Settings")
	FVector KneeForward = FVector(0.0, 1.0, 0.0);

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual bool HasPreUpdate() const override { return true; }
	virtual void PreUpdate(const UAnimInstance* InAnimInstance) override;
	virtual void EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms) override;
};
