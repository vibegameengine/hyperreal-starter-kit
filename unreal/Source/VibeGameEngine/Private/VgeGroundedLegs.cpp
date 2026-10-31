#include "VgeGroundedLegs.h"

#include "Animation/AnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/Skeleton.h"
#include "GameFramework/Actor.h"
#include "TwoBoneIK.h"

namespace
{
	const FTransform* PlacedTransformOf(const TArray<FBoneTransform>& Placed, FCompactPoseBoneIndex Index)
	{
		const FBoneTransform* Found = Placed.FindByPredicate([Index](const FBoneTransform& Bone) { return Bone.BoneIndex == Index; });
		return Found ? &Found->Transform : nullptr;
	}

	void LevelRoot(FCSPose<FCompactPose>& Pose)
	{
		const FCompactPoseBoneIndex Root(0);
		const FTransform RootCS = Pose.GetComponentSpaceTransform(Root);
		if (RootCS.GetRotation().Equals(FQuat::Identity))
		{
			return;
		}
		const FBoneContainer& Bones = Pose.GetPose().GetBoneContainer();
		TArray<FBoneTransform> Leveled;
		Leveled.Add(FBoneTransform(Root, FTransform(FQuat::Identity, RootCS.GetLocation(), RootCS.GetScale3D())));
		for (FCompactPoseBoneIndex Bone(1); Bone < Pose.GetPose().GetNumBones(); ++Bone)
		{
			if (Bones.GetParentBoneIndex(Bone) == Root)
			{
				Leveled.Add(FBoneTransform(Bone, Pose.GetComponentSpaceTransform(Bone)));
			}
		}
		Pose.SafeSetCSBoneTransforms(Leveled);
	}

	void CopyLeveled(const FComponentSpacePoseContext& Output, FComponentSpacePoseContext& Leveled)
	{
		Leveled = Output;
		LevelRoot(Leveled.Pose);
	}

	FVector KneeTargetOf(const FTransform& Hip, const FTransform& Knee, const FTransform& Foot, const FVector& Fallback)
	{
		const FVector Bend = Knee.GetLocation() - (Hip.GetLocation() + Foot.GetLocation()) * 0.5;
		const FVector Direction = Bend.SizeSquared() > 1.0 ? Bend.GetSafeNormal() : Fallback;
		return Knee.GetLocation() + Direction * 100.0;
	}

	void ReachFootTargets(FComponentSpacePoseContext& Output, const TArray<FBoneTransform>& Placed, const FBoneReference& PelvisBone, TConstArrayView<FBoneReference> Feet, const FVector& KneeForward, TArray<FBoneTransform>& OutBoneTransforms)
	{
		const FBoneContainer& Bones = Output.Pose.GetPose().GetBoneContainer();
		const FCompactPoseBoneIndex Pelvis = PelvisBone.GetCompactPoseIndex(Bones);
		const FTransform PelvisBefore = Output.Pose.GetComponentSpaceTransform(Pelvis);
		const FTransform* PelvisPlaced = PlacedTransformOf(Placed, Pelvis);
		const FTransform PelvisNow = PelvisPlaced ? *PelvisPlaced : PelvisBefore;
		if (PelvisPlaced)
		{
			OutBoneTransforms.Add(FBoneTransform(Pelvis, PelvisNow));
		}

		for (const FBoneReference& FootBone : Feet)
		{
			const FCompactPoseBoneIndex Foot = FootBone.GetCompactPoseIndex(Bones);
			const FTransform* FootTarget = Foot.IsValid() ? PlacedTransformOf(Placed, Foot) : nullptr;
			if (!FootTarget)
			{
				continue;
			}
			const FCompactPoseBoneIndex Knee = Bones.GetParentBoneIndex(Foot);
			const FCompactPoseBoneIndex Hip = Knee.IsValid() ? Bones.GetParentBoneIndex(Knee) : FCompactPoseBoneIndex(INDEX_NONE);
			if (!Hip.IsValid())
			{
				continue;
			}
			const FTransform HipBefore = Output.Pose.GetComponentSpaceTransform(Hip);
			const FTransform KneeBefore = Output.Pose.GetComponentSpaceTransform(Knee);
			const FTransform FootBefore = Output.Pose.GetComponentSpaceTransform(Foot);
			FTransform HipNow = HipBefore.GetRelativeTransform(PelvisBefore) * PelvisNow;
			FTransform KneeNow = KneeBefore.GetRelativeTransform(HipBefore) * HipNow;
			FTransform FootNow = FootBefore.GetRelativeTransform(KneeBefore) * KneeNow;
			AnimationCore::SolveTwoBoneIK(HipNow, KneeNow, FootNow, KneeTargetOf(HipNow, KneeNow, FootNow, KneeForward), FootTarget->GetLocation(), false, 1.0, 1.0);
			FootNow.SetRotation(FootTarget->GetRotation());
			OutBoneTransforms.Add(FBoneTransform(Hip, HipNow));
			OutBoneTransforms.Add(FBoneTransform(Knee, KneeNow));
			OutBoneTransforms.Add(FBoneTransform(Foot, FootNow));
		}

		OutBoneTransforms.Sort(FCompareBoneTransformIndex());
	}
}

void FVgeAnimNode_GroundedLegs::UpdateInternal(const FAnimationUpdateContext& Context)
{
	FAnimNode_FootPlacement::UpdateInternal(Context);
	StepSeconds += Context.GetDeltaTime();
}

void FVgeAnimNode_GroundedLegs::PreUpdate(const UAnimInstance* InAnimInstance)
{
	const AActor* Owner = InAnimInstance ? InAnimInstance->GetOwningActor() : nullptr;
	OwnerVelocity = Owner ? Owner->GetVelocity() : FVector::ZeroVector;
}

void FVgeAnimNode_GroundedLegs::SeparateFeet(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& Placed)
{
	const float DeltaSeconds = StepSeconds;
	StepSeconds = 0.0f;
	const FBoneContainer& Bones = Output.Pose.GetPose().GetBoneContainer();
	if (LegDefinitions.Num() != 2 || FeetSeparatingDistance <= 0.0f)
	{
		return;
	}
	FCompactPoseBoneIndex Feet[2] = { LegDefinitions[0].FKFootBone.GetCompactPoseIndex(Bones), LegDefinitions[1].FKFootBone.GetCompactPoseIndex(Bones) };
	FBoneTransform* Solved[2] = { nullptr, nullptr };
	FVector Animated[2];
	FVector Thigh[2];
	for (int32 Leg = 0; Leg < 2; ++Leg)
	{
		if (!Feet[Leg].IsValid())
		{
			return;
		}
		const FCompactPoseBoneIndex Knee = Bones.GetParentBoneIndex(Feet[Leg]);
		const FCompactPoseBoneIndex Hip = Knee.IsValid() ? Bones.GetParentBoneIndex(Knee) : FCompactPoseBoneIndex(INDEX_NONE);
		Solved[Leg] = Placed.FindByPredicate([&Feet, Leg](const FBoneTransform& Bone) { return Bone.BoneIndex == Feet[Leg]; });
		if (!Hip.IsValid() || !Solved[Leg])
		{
			return;
		}
		Animated[Leg] = Output.Pose.GetComponentSpaceTransform(Feet[Leg]).GetLocation();
		Thigh[Leg] = Output.Pose.GetComponentSpaceTransform(Hip).GetLocation();
	}

	const FVector2D Side = FVector2D(Thigh[0] - Thigh[1]).GetSafeNormal();
	if (Side.IsNearlyZero())
	{
		return;
	}
	const auto GapAlongSide = [&Side](const FVector& Left, const FVector& Right) { return FVector2D::DotProduct(FVector2D(Left - Right), Side); };
	const float Required = FMath::Min(GapAlongSide(Animated[0], Animated[1]), 2.0f * FeetSeparatingDistance);
	const float Deficit = Required - GapAlongSide(Solved[0]->Transform.GetLocation(), Solved[1]->Transform.GetLocation());

	const FVector VelocityCS = Output.AnimInstanceProxy->GetComponentTransform().InverseTransformVector(OwnerVelocity);
	float Free[2];
	for (int32 Leg = 0; Leg < 2; ++Leg)
	{
		const bool bHasLast = LastAnimatedFeet.Num() == 2 && DeltaSeconds > UE_KINDA_SMALL_NUMBER;
		const FVector FootVelocity = bHasLast ? (Animated[Leg] - LastAnimatedFeet[Leg]) / DeltaSeconds + VelocityCS : FVector::ZeroVector;
		const float Speed = FVector2D(FootVelocity).Size();
		Free[Leg] = FMath::SmoothStep(PlantSettings.SpeedThreshold, 2.0f * PlantSettings.SpeedThreshold, Speed);
	}
	LastAnimatedFeet = { Animated[0], Animated[1] };

	FVector2D Wanted[2] = { FVector2D::ZeroVector, FVector2D::ZeroVector };
	const float TotalFree = Free[0] + Free[1];
	if (Deficit > 0.0f && TotalFree > 1.0e-3f)
	{
		Wanted[0] = Side * (Deficit * Free[0] / TotalFree);
		Wanted[1] = -Side * (Deficit * Free[1] / TotalFree);
	}

	SeparationOffset.SetNumZeroed(2);
	SeparationVelocity.SetNumZeroed(2);
	const float Frequency = FMath::Sqrt(FMath::Max(0.0f, FeetSeparationStiffness));
	for (int32 Leg = 0; Leg < 2; ++Leg)
	{
		if (DeltaSeconds > 0.0f)
		{
			const float Damped = 1.0f + 2.0f * DeltaSeconds * FeetSeparationDamping * Frequency;
			const float Determinant = Damped + DeltaSeconds * DeltaSeconds * Frequency * Frequency;
			SeparationVelocity[Leg] = (SeparationVelocity[Leg] + DeltaSeconds * Frequency * Frequency * (Wanted[Leg] - SeparationOffset[Leg])) / Determinant;
			SeparationOffset[Leg] += DeltaSeconds * SeparationVelocity[Leg];
		}
		Solved[Leg]->Transform.AddToTranslation(FVector(SeparationOffset[Leg], 0.0));
	}
}

void FVgeAnimNode_GroundedLegs::EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms)
{
	TArray<FBoneTransform> Placed;
	FComponentSpacePoseContext Leveled(Output);
	CopyLeveled(Output, Leveled);
	FAnimNode_FootPlacement::EvaluateSkeletalControl_AnyThread(Leveled, Placed);
	SeparateFeet(Output, Placed);
	TArray<FBoneReference> Feet;
	for (const FFootPlacemenLegDefinition& Leg : LegDefinitions)
	{
		Feet.Add(Leg.FKFootBone);
	}
	ReachFootTargets(Output, Placed, PelvisBone, Feet, KneeForward, OutBoneTransforms);
}

void FVgeAnimNode_StrideLegs::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	const USkeleton* Skeleton = Context.AnimInstanceProxy ? Context.AnimInstanceProxy->GetSkeleton() : nullptr;
	if (Skeleton)
	{
		const FReferenceSkeleton& Reference = Skeleton->GetReferenceSkeleton();
		for (FStrideWarpingFootDefinition& Foot : FootDefinitions)
		{
			const int32 FootIndex = Reference.FindBoneIndex(Foot.FKFootBone.BoneName);
			const int32 KneeIndex = FootIndex == INDEX_NONE ? INDEX_NONE : Reference.GetParentIndex(FootIndex);
			const int32 ThighIndex = KneeIndex == INDEX_NONE ? INDEX_NONE : Reference.GetParentIndex(KneeIndex);
			if (Foot.ThighBone.BoneName.IsNone() && ThighIndex != INDEX_NONE)
			{
				Foot.ThighBone.BoneName = Reference.GetBoneName(ThighIndex);
			}
		}
	}
	FAnimNode_StrideWarping::Initialize_AnyThread(Context);
}

void FVgeAnimNode_StrideLegs::PreUpdate(const UAnimInstance* InAnimInstance)
{
	const AActor* Owner = InAnimInstance ? InAnimInstance->GetOwningActor() : nullptr;
	LocomotionSpeed = Owner ? Owner->GetVelocity().Size2D() : 0.f;
}

void FVgeAnimNode_StrideLegs::EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms)
{
	TArray<FBoneTransform> Placed;
	FComponentSpacePoseContext Leveled(Output);
	CopyLeveled(Output, Leveled);
	FAnimNode_StrideWarping::EvaluateSkeletalControl_AnyThread(Leveled, Placed);
	TArray<FBoneReference> Feet;
	for (const FStrideWarpingFootDefinition& Foot : FootDefinitions)
	{
		Feet.Add(Foot.FKFootBone);
	}
	ReachFootTargets(Output, Placed, PelvisBone, Feet, KneeForward, OutBoneTransforms);
}
