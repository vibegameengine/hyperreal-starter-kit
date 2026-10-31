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

void FVgeAnimNode_GroundedLegs::EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms)
{
	TArray<FBoneTransform> Placed;
	FComponentSpacePoseContext Leveled(Output);
	CopyLeveled(Output, Leveled);
	FAnimNode_FootPlacement::EvaluateSkeletalControl_AnyThread(Leveled, Placed);
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
