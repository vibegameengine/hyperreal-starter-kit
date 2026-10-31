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

	UPROPERTY(EditAnywhere, Category = "Settings")
	float FeetSeparatingDistance = 5.0f;

	UPROPERTY(EditAnywhere, Category = "Settings")
	float FeetSeparationStiffness = 1000.0f;

	UPROPERTY(EditAnywhere, Category = "Settings")
	float FeetSeparationDamping = 1.0f;

	virtual void UpdateInternal(const FAnimationUpdateContext& Context) override;
	virtual bool HasPreUpdate() const override { return true; }
	virtual void PreUpdate(const UAnimInstance* InAnimInstance) override;
	virtual void EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms) override;

private:
	void SeparateFeet(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& Placed);

	FVector OwnerVelocity = FVector::ZeroVector;
	float StepSeconds = 0.0f;
	TArray<FVector2D> SeparationOffset;
	TArray<FVector2D> SeparationVelocity;
	TArray<FVector> LastAnimatedFeet;
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
