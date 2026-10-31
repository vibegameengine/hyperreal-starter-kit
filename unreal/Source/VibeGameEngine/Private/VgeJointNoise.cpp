#include "VgeJointNoise.h"

#include "Animation/AnimInstanceProxy.h"

namespace
{
	constexpr double SeedSpread = 1000.0;
	constexpr double AxisPhaseOffset = 37.0;
	constexpr double JointPhaseOffset = 13.0;

	double WithinLimits(double Animated, double Noise, double Min, double Max)
	{
		return FMath::Clamp(Animated + Noise, FMath::Min(Animated, Min), FMath::Max(Animated, Max));
	}

	double Wave(double Phase)
	{
		return FMath::PerlinNoise1D(static_cast<float>(Phase));
	}
}

void FVgeAnimNode_JointNoise::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_SkeletalControlBase::Initialize_AnyThread(Context);
	Time = 0.0;
	Seed = FMath::FRand() * SeedSpread;
}

void FVgeAnimNode_JointNoise::UpdateInternal(const FAnimationUpdateContext& Context)
{
	FAnimNode_SkeletalControlBase::UpdateInternal(Context);
	Time += Context.GetDeltaTime();
}

void FVgeAnimNode_JointNoise::InitializeBoneReferences(const FBoneContainer& RequiredBones)
{
	for (FVgeJointNoise& Joint : Joints)
	{
		Joint.Bone.Initialize(RequiredBones);
	}
}

bool FVgeAnimNode_JointNoise::IsValidToEvaluate(const USkeleton* Skeleton, const FBoneContainer& RequiredBones)
{
	return Joints.ContainsByPredicate([&RequiredBones](const FVgeJointNoise& Joint) { return Joint.Bone.IsValidToEvaluate(RequiredBones); });
}

void FVgeAnimNode_JointNoise::EvaluateSkeletalControl_AnyThread(FComponentSpacePoseContext& Output, TArray<FBoneTransform>& OutBoneTransforms)
{
	const FBoneContainer& Bones = Output.Pose.GetPose().GetBoneContainer();
	TArray<TPair<FCompactPoseBoneIndex, int32>> Ordered;
	for (int32 JointIndex = 0; JointIndex < Joints.Num(); ++JointIndex)
	{
		const FCompactPoseBoneIndex Bone = Joints[JointIndex].Bone.GetCompactPoseIndex(Bones);
		if (Bone.IsValid())
		{
			Ordered.Emplace(Bone, JointIndex);
		}
	}
	Ordered.Sort([](const TPair<FCompactPoseBoneIndex, int32>& A, const TPair<FCompactPoseBoneIndex, int32>& B) { return A.Key < B.Key; });

	FComponentSpacePoseContext Noisy(Output);
	Noisy = Output;
	for (const TPair<FCompactPoseBoneIndex, int32>& Entry : Ordered)
	{
		const FVgeJointNoise& Joint = Joints[Entry.Value];
		const FCompactPoseBoneIndex Bone = Entry.Key;
		const FCompactPoseBoneIndex Parent = Bones.GetParentBoneIndex(Bone);
		const FQuat Reference = Bones.GetRefPoseTransform(Bone).GetRotation();
		FTransform Local = Noisy.Pose.GetLocalSpaceTransform(Bone);
		const FRotator Animated = (Reference.Inverse() * Local.GetRotation()).Rotator();
		const double Phase = Time * Joint.Frequency + Seed + JointPhaseOffset * Entry.Value;
		const FRotator Turned(
			WithinLimits(Animated.Pitch, Joint.Amplitude.Pitch * Wave(Phase), Joint.MinAngles.Pitch, Joint.MaxAngles.Pitch),
			WithinLimits(Animated.Yaw, Joint.Amplitude.Yaw * Wave(Phase + AxisPhaseOffset), Joint.MinAngles.Yaw, Joint.MaxAngles.Yaw),
			WithinLimits(Animated.Roll, Joint.Amplitude.Roll * Wave(Phase + 2.0 * AxisPhaseOffset), Joint.MinAngles.Roll, Joint.MaxAngles.Roll));
		Local.SetRotation(Reference * FQuat(Turned));
		const FTransform ComponentSpace = Parent.IsValid() ? Local * Noisy.Pose.GetComponentSpaceTransform(Parent) : Local;
		TArray<FBoneTransform> Single;
		Single.Add(FBoneTransform(Bone, ComponentSpace));
		Noisy.Pose.SafeSetCSBoneTransforms(Single);
	}

	for (const TPair<FCompactPoseBoneIndex, int32>& Entry : Ordered)
	{
		OutBoneTransforms.Add(FBoneTransform(Entry.Key, Noisy.Pose.GetComponentSpaceTransform(Entry.Key)));
	}
}
