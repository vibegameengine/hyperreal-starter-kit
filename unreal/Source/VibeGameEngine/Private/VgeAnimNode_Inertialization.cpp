// FVgeAnimNode_Inertialization: the engine's FAnimNode_Inertialization (Engine/Private/Animation/AnimNode_Inertialization.cpp)
// carried over unchanged in what it computes. What differs: no class index for traces (the engine node traces under
// GetNodeIndex(), which checks for Animation Blueprint class data), the console variables are read by name, and
// requests are not forwarded through skipped cached-pose updates (FCachedPoseSkippedUpdateHandler is not exported;
// these graphs have no cached poses).

#include "VgeAnimNodes.h"

#include "Algo/MaxElement.h"
#include "Animation/AnimCurveUtils.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/AnimRootMotionProvider.h"
#include "Animation/AnimTrace.h"
#include "Animation/BlendProfile.h"
#include "Components/SkeletalMeshComponent.h"
#include "HAL/IConsoleManager.h"

namespace
{
	// Inertialization requests reaching the node, as FInertializationRequester does for the engine node.
	class FVgeInertializationRequester : public UE::Anim::IInertializationRequester
	{
	public:
		FVgeInertializationRequester(const FAnimationBaseContext& InContext, FVgeAnimNode_Inertialization* InNode)
			: Node(*InNode)
			, NodeId(InContext.GetCurrentNodeId())
			, Proxy(*InContext.AnimInstanceProxy)
		{
		}

	private:
		virtual void RequestInertialization(float InRequestedDuration, const UBlendProfile* InBlendProfile) override
		{
			Node.RequestInertialization(FInertializationRequest(InRequestedDuration, InBlendProfile));
		}

		virtual void RequestInertialization(const FInertializationRequest& InInertializationRequest) override
		{
			Node.RequestInertialization(InInertializationRequest);
		}

		virtual void AddDebugRecord(const FAnimInstanceProxy& InSourceProxy, int32 InSourceNodeId) override
		{
			TRACE_ANIM_NODE_ATTRIBUTE(Proxy, InSourceProxy, NodeId, InSourceNodeId, IInertializationRequester::Attribute);
		}

		virtual FName GetTag() const override { return Node.Tag; }

		FVgeAnimNode_Inertialization& Node;
		int32 NodeId;
		FAnimInstanceProxy& Proxy;
	};

	// The engine's inertialization console variables (AnimNode_Inertialization.cpp), found once on first use: they
	// are registered when the engine module loads, and their values are read each time.
	enum class EConsoleFlag : uint8 { Enable, IgnoreDeficit, IgnoreVelocity };

	bool ConsoleFlag(EConsoleFlag Flag)
	{
		static const IConsoleVariable* const Variables[] = {
			IConsoleManager::Get().FindConsoleVariable(TEXT("a.AnimNode.Inertialization.Enable")),
			IConsoleManager::Get().FindConsoleVariable(TEXT("a.AnimNode.Inertialization.IgnoreDeficit")),
			IConsoleManager::Get().FindConsoleVariable(TEXT("a.AnimNode.Inertialization.IgnoreVelocity")),
		};
		static constexpr bool Defaults[] = { true, false, false };
		const IConsoleVariable* Variable = Variables[static_cast<uint8>(Flag)];
		return Variable ? Variable->GetInt() != 0 : Defaults[static_cast<uint8>(Flag)];
	}

	int32 NumSkeletonBones(const FBoneContainer& BoneContainer)
	{
		const USkeleton* SkeletonAsset = BoneContainer.GetSkeletonAsset();
		check(SkeletonAsset);
		return SkeletonAsset->GetReferenceSkeleton().GetNum();
	}

	constexpr float InertializationTimeEpsilon = 1.0e-7f;

	// The "inertialized" value of a float at time t: a quintic from (x0, v0) that reaches zero with zero velocity and
	// acceleration at t1, shortened if needed so that it never overshoots (UE::Anim::Inertialization::Private::CalcInertialFloat).
	float CalcInertialFloat(float x0, float v0, float t, float t1)
	{
		if (t < 0.0f)
		{
			t = 0.0f;
		}
		if (t >= t1 - InertializationTimeEpsilon)
		{
			return 0.0f;
		}

		float Sign = 1.0f;
		if (x0 < 0.0f)
		{
			x0 = -x0;
			v0 = -v0;
			Sign = -1.0f;
		}
		if (v0 > 0.0f)
		{
			v0 = 0.0f;
		}
		if (!ensureMsgf(x0 >= 0.0f && v0 <= 0.0f && t >= 0.0f && t1 >= 0.0f, TEXT("Invalid Value(s) in Inertialization - x0: %f, v0: %f, t: %f, t1: %f"), x0, v0, t, t1))
		{
			x0 = 0.0f;
			v0 = 0.0f;
			t = 0.0f;
			t1 = 0.0f;
		}
		if (v0 < -UE_KINDA_SMALL_NUMBER)
		{
			t1 = FMath::Min(t1, -5.0f * x0 / v0);
		}
		if (t >= t1 - InertializationTimeEpsilon)
		{
			return 0.0f;
		}

		const float t1_2 = t1 * t1;
		const float t1_3 = t1 * t1_2;
		const float t1_4 = t1 * t1_3;
		const float t1_5 = t1 * t1_4;
		const float a0 = FMath::Max(0.0f, (-8.0f * t1 * v0 - 20.0f * x0) / t1_2);
		const float A = -0.5f * (a0 * t1_2 + 6.0f * t1 * v0 + 12.0f * x0) / t1_5;
		const float B = 0.5f * (3.0f * a0 * t1_2 + 16.0f * t1 * v0 + 30.0f * x0) / t1_4;
		const float C = -0.5f * (3.0f * a0 * t1_2 + 12.0f * t1 * v0 + 20.0f * x0) / t1_3;
		const float D = 0.5f * a0;
		const float x = (((((A * t) + B) * t + C) * t + D) * t + v0) * t + x0;
		return x * Sign;
	}

	constexpr float SpringSettleExponent = 6.0f;
	constexpr float SpringMinimumDamping = 0.05f;

	float SpringOffset(float x0, float v0, float t, float t1, float Damping)
	{
		if (t >= t1 - InertializationTimeEpsilon)
		{
			return 0.0f;
		}
		const float Zeta = FMath::Max(Damping, SpringMinimumDamping);
		const float Omega = SpringSettleExponent / (FMath::Min(Zeta, 1.0f) * t1);
		const float Decay = FMath::Exp(-Zeta * Omega * t);
		if (Zeta >= 1.0f)
		{
			return Decay * (x0 + (v0 + Omega * x0) * t);
		}
		const float DampedOmega = Omega * FMath::Sqrt(1.0f - Zeta * Zeta);
		return Decay * (x0 * FMath::Cos(DampedOmega * t) + (v0 + Zeta * Omega * x0) / DampedOmega * FMath::Sin(DampedOmega * t));
	}
}

float FVgeAnimNode_Inertialization::Offset(float x0, float v0, float t, float t1) const
{
	return SpringDamping > 0.0f ? SpringOffset(x0, v0, t, t1, SpringDamping) : CalcInertialFloat(x0, v0, t, t1);
}

void FVgeAnimNode_Inertialization::RequestInertialization(const FInertializationRequest& Request)
{
	if (Request.Duration >= 0.0f)
	{
		PRAGMA_DISABLE_DEPRECATION_WARNINGS
		RequestQueue.AddUnique(Request);
		PRAGMA_ENABLE_DEPRECATION_WARNINGS
	}
}

void FVgeAnimNode_Inertialization::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);
	Source.Initialize(Context);

	CurveFilter.Empty();
	CurveFilter.SetFilterMode(UE::Anim::ECurveFilterMode::DisallowFiltered);
	CurveFilter.AppendNames(FilteredCurves);

	BoneFilter.Init(FCompactPoseBoneIndex(INDEX_NONE), FilteredBones.Num());

	PrevPoseSnapshot.Empty();
	CurrPoseSnapshot.Empty();
	RequestQueue.Reserve(8);

	BoneIndices.Empty();
	BoneTranslationDiffDirection.Empty();
	BoneTranslationDiffMagnitude.Empty();
	BoneTranslationDiffSpeed.Empty();
	BoneRotationDiffAxis.Empty();
	BoneRotationDiffAngle.Empty();
	BoneRotationDiffSpeed.Empty();
	BoneScaleDiffAxis.Empty();
	BoneScaleDiffMagnitude.Empty();
	BoneScaleDiffSpeed.Empty();
	CurveDiffs.Empty();

	DeltaTime = 0.0f;
	InertializationState = EInertializationState::Inactive;
	InertializationElapsedTime = 0.0f;
	InertializationDuration = 0.0f;
	InertializationDurationPerBone.Empty();
	InertializationMaxDuration = 0.0f;
	InertializationDeficit = 0.0f;
}

void FVgeAnimNode_Inertialization::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	FAnimNode_Base::CacheBones_AnyThread(Context);
	Source.CacheBones(Context);

	const FBoneContainer& RequiredBones = Context.AnimInstanceProxy->GetRequiredBones();
	BoneFilter.Init(FCompactPoseBoneIndex(INDEX_NONE), FilteredBones.Num());
	for (int32 FilterBoneIdx = 0; FilterBoneIdx < FilteredBones.Num(); FilterBoneIdx++)
	{
		FilteredBones[FilterBoneIdx].Initialize(Context.AnimInstanceProxy->GetSkeleton());
		BoneFilter[FilterBoneIdx] = FilteredBones[FilterBoneIdx].GetCompactPoseIndex(RequiredBones);
	}
}

void FVgeAnimNode_Inertialization::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	const bool bNeedsReset = bResetOnBecomingRelevant && UpdateCounter.HasEverBeenUpdated() && !UpdateCounter.WasSynchronizedCounter(Context.AnimInstanceProxy->GetUpdateCounter());
	if (bNeedsReset)
	{
		RequestQueue.Reset();
		Deactivate();
		PrevPoseSnapshot.Empty();
		CurrPoseSnapshot.Empty();
	}
	UpdateCounter.SynchronizeWith(Context.AnimInstanceProxy->GetUpdateCounter());

	// Requests from below arrive through this message while the source updates.
	UE::Anim::TScopedGraphMessage<FVgeInertializationRequester> InertializationMessage(Context, Context, this);
	Source.Update(Context);

	// Delta time accumulates between evaluations.
	DeltaTime += Context.GetDeltaTime();
}

void FVgeAnimNode_Inertialization::Evaluate_AnyThread(FPoseContext& Output)
{
	Source.Evaluate(Output);

	if (!ConsoleFlag(EConsoleFlag::Enable))
	{
		RequestQueue.Reset();
		Deactivate();
		PrevPoseSnapshot.Empty();
		CurrPoseSnapshot.Empty();
		DeltaTime = 0.0f;
		return;
	}

	for (int32 RequestIndex = RequestQueue.Num() - 1; RequestIndex >= 0; --RequestIndex)
	{
		const FInertializationRequest& Request = RequestQueue[RequestIndex];
		if (Request.Tag != NAME_None && Request.Tag != Tag)
		{
			RequestQueue.RemoveAtSwap(RequestIndex);
		}
	}

	// A new request: capture the pose difference this evaluation
	const int32 NumRequests = RequestQueue.Num();
	if (NumRequests > 0 && !CurrPoseSnapshot.IsEmpty())
	{
		float AppliedDeficit = 0.0f;
		if (InertializationState == EInertializationState::Active)
		{
			// An interrupted inertialization: track the lost time and shorten further ones while interruptions go on,
			// or the pose degenerates chasing an unstable target.
			const bool bApplyDeficit = InertializationDeficit > 0.0f && !ConsoleFlag(EConsoleFlag::IgnoreDeficit);
			InertializationDeficit = InertializationDuration - InertializationElapsedTime;
			AppliedDeficit = bApplyDeficit ? InertializationDeficit : 0.0f;
		}

		InertializationState = EInertializationState::Pending;
		InertializationElapsedTime = 0.0f;

		const int32 SkeletonBones = NumSkeletonBones(Output.AnimInstanceProxy->GetRequiredBones());
		const USkeleton* TargetSkeleton = Output.AnimInstanceProxy->GetRequiredBones().GetSkeletonAsset();
		auto FillSkeletonBoneDurationsArray = [this, SkeletonBones, TargetSkeleton](auto& DurationPerBone, float Duration, const UBlendProfile* RequestBlendProfile)
		{
			if (RequestBlendProfile == nullptr)
			{
				RequestBlendProfile = DefaultBlendProfile;
			}
			if (RequestBlendProfile != nullptr)
			{
				DurationPerBone.SetNum(SkeletonBones);
				RequestBlendProfile->FillSkeletonBoneDurationsArray(DurationPerBone, Duration, TargetSkeleton);
			}
			else
			{
				DurationPerBone.Init(Duration, SkeletonBones);
			}
		};

		InertializationDuration = FMath::Max(RequestQueue[0].Duration - AppliedDeficit, 0.0f);
		FillSkeletonBoneDurationsArray(InertializationDurationPerBone, InertializationDuration, RequestQueue[0].BlendProfile);

		// Further requests merge in with the shortest time per bone.
		if (NumRequests > 1)
		{
			UE::Anim::TTypedIndexArray<FSkeletonPoseBoneIndex, float, FAnimStackAllocator> RequestDurationPerBone;
			for (int32 RequestIndex = 1; RequestIndex < NumRequests; ++RequestIndex)
			{
				const FInertializationRequest& Request = RequestQueue[RequestIndex];
				const float RequestDuration = FMath::Max(Request.Duration - AppliedDeficit, 0.0f);
				InertializationDuration = FMath::Min(InertializationDuration, RequestDuration);

				if (Request.BlendProfile != nullptr)
				{
					FillSkeletonBoneDurationsArray(RequestDurationPerBone, RequestDuration, Request.BlendProfile);
					for (int32 SkeletonBoneIndex = 0; SkeletonBoneIndex < SkeletonBones; ++SkeletonBoneIndex)
					{
						InertializationDurationPerBone[SkeletonBoneIndex] = FMath::Min(InertializationDurationPerBone[SkeletonBoneIndex], RequestDurationPerBone[SkeletonBoneIndex]);
					}
				}
				else
				{
					for (int32 SkeletonBoneIndex = 0; SkeletonBoneIndex < SkeletonBones; ++SkeletonBoneIndex)
					{
						InertializationDurationPerBone[SkeletonBoneIndex] = FMath::Min(InertializationDurationPerBone[SkeletonBoneIndex], RequestDuration);
					}
				}
			}
		}

		InertializationMaxDuration = FMath::Max(InertializationDuration, *Algo::MaxElement(InertializationDurationPerBone));
	}
	RequestQueue.Reset();

	if (InertializationState != EInertializationState::Inactive)
	{
		InertializationElapsedTime += DeltaTime;
		if (InertializationElapsedTime >= InertializationDuration)
		{
			InertializationDeficit = 0.0f;
		}
		else
		{
			InertializationDeficit -= FMath::Min(InertializationDeficit, DeltaTime);
		}
		if (InertializationElapsedTime >= InertializationMaxDuration)
		{
			Deactivate();
		}
	}

	const FTransform ComponentTransform = Output.AnimInstanceProxy->GetComponentTransform();

	// Teleports, by the root bone's world location (a mesh moved while counter-moving its root still inertializes).
	bool bTeleported = false;
	const float TeleportDistanceThreshold = Output.AnimInstanceProxy->GetSkelMeshComponent()->GetTeleportDistanceThreshold();
	if (!CurrPoseSnapshot.IsEmpty() && TeleportDistanceThreshold > 0.0f)
	{
		const FVector RootWorldSpaceLocation = ComponentTransform.TransformPosition(Output.Pose[FCompactPoseBoneIndex(0)].GetTranslation());
		const int32 RootBoneIndex = CurrPoseSnapshot.BoneIndices[0];
		if (RootBoneIndex != INDEX_NONE)
		{
			const FVector PrevRootWorldSpaceLocation = CurrPoseSnapshot.ComponentTransform.TransformPosition(CurrPoseSnapshot.BoneTranslations[RootBoneIndex]);
			if (FVector::DistSquared(RootWorldSpaceLocation, PrevRootWorldSpaceLocation) > FMath::Square(TeleportDistanceThreshold))
			{
				bTeleported = true;
			}
		}
	}
	if (bTeleported)
	{
		if (InertializationState == EInertializationState::Pending)
		{
			Deactivate();
		}
		DeltaTime = 0.0f;
	}

	if (ConsoleFlag(EConsoleFlag::IgnoreVelocity))
	{
		DeltaTime = 0.0f;
	}

	FName AttachParentName = NAME_None;
	if (AActor* Owner = Output.AnimInstanceProxy->GetSkelMeshComponent()->GetOwner())
	{
		if (AActor* AttachParentActor = Owner->GetAttachParentActor())
		{
			AttachParentName = AttachParentActor->GetFName();
		}
	}

	if (InertializationState == EInertializationState::Pending)
	{
		// With two previous poses the offset and its velocity; with one, the offset at zero velocity.
		InitFrom(Output.Pose, Output.Curve, Output.CustomAttributes, ComponentTransform, AttachParentName, CurrPoseSnapshot, PrevPoseSnapshot.IsEmpty() ? CurrPoseSnapshot : PrevPoseSnapshot);
		InertializationState = EInertializationState::Active;
	}

	if (InertializationState == EInertializationState::Active)
	{
		ApplyTo(Output.Pose, Output.Curve, Output.CustomAttributes);
	}

	if (!CurrPoseSnapshot.IsEmpty())
	{
		Swap(PrevPoseSnapshot, CurrPoseSnapshot);
	}
	CurrPoseSnapshot.InitFrom(Output.Pose, Output.Curve, Output.CustomAttributes, ComponentTransform, AttachParentName, DeltaTime);
	DeltaTime = 0.0f;

	const float InertializationWeight = InertializationState == EInertializationState::Active && InertializationDuration > UE_KINDA_SMALL_NUMBER ? 1.0f - InertializationElapsedTime / InertializationDuration : 0.0f;
	TRACE_ANIM_NODE_VALUE(Output, TEXT("Elapsed Time"), InertializationElapsedTime);
	TRACE_ANIM_NODE_VALUE(Output, TEXT("Duration"), InertializationDuration);
	TRACE_ANIM_NODE_VALUE(Output, TEXT("Inertialization Weight"), InertializationWeight);
	TRACE_ANIM_INERTIALIZATION(*Output.AnimInstanceProxy, Output.GetCurrentNodeId(), InertializationWeight, FAnimTrace::EInertializationType::Inertialization);
}

void FVgeAnimNode_Inertialization::GatherDebugData(FNodeDebugData& DebugData)
{
	FString DebugLine = DebugData.GetNodeName(this);
	DebugLine += FString::Printf(TEXT("('%s' Time: %.3f / %.3f [%.3f])"), *UEnum::GetValueAsString(InertializationState), InertializationElapsedTime, InertializationDuration, InertializationDeficit);
	DebugData.AddDebugItem(DebugLine);
	Source.GatherDebugData(DebugData);
}

void FVgeAnimNode_Inertialization::InitFrom(const FCompactPose& InPose, const FBlendedCurve& InCurves, const UE::Anim::FStackAttributeContainer& InAttributes, const FTransform& ComponentTransform, FName AttachParentName, const FVgeInertializationSparsePose& Prev1, const FVgeInertializationSparsePose& Prev2)
{
	check(!Prev1.IsEmpty() && !Prev2.IsEmpty());

	const FQuat ComponentTransformGetRotationInverse = ComponentTransform.GetRotation().Inverse();

	// Local space by default; world space across a change of attach parent; world rotation across a jump in the
	// component's orientation (of an unattached mesh).
	EInertializationSpace InertializationSpace = EInertializationSpace::Default;
	if (AttachParentName != Prev1.AttachParentName || AttachParentName != Prev2.AttachParentName)
	{
		InertializationSpace = EInertializationSpace::WorldSpace;
	}
	else if (AttachParentName == NAME_None)
	{
		if ((FMath::Abs((Prev1.ComponentTransform.GetRotation() * ComponentTransformGetRotationInverse).W) < 0.999f) ||
			(FMath::Abs((Prev2.ComponentTransform.GetRotation() * ComponentTransformGetRotationInverse).W) < 0.999f))
		{
			InertializationSpace = EInertializationSpace::WorldRotation;
		}
	}

	const FBoneContainer& BoneContainer = InPose.GetBoneContainer();
	BoneIndices.Init(INDEX_NONE, NumSkeletonBones(BoneContainer));

	int32 NumInertializationBones = 0;
	for (FCompactPoseBoneIndex BoneIndex : InPose.ForEachBoneIndex())
	{
		const int32 SkeletonPoseBoneIndex = BoneContainer.GetSkeletonIndex(BoneIndex);
		if (SkeletonPoseBoneIndex == INDEX_NONE || Prev1.BoneIndices[SkeletonPoseBoneIndex] == INDEX_NONE || Prev2.BoneIndices[SkeletonPoseBoneIndex] == INDEX_NONE)
		{
			continue;
		}
		BoneIndices[SkeletonPoseBoneIndex] = NumInertializationBones++;
	}

	BoneTranslationDiffDirection.Init(FVector3f::ZeroVector, NumInertializationBones);
	BoneTranslationDiffMagnitude.Init(0.0f, NumInertializationBones);
	BoneTranslationDiffSpeed.Init(0.0f, NumInertializationBones);
	BoneRotationDiffAxis.Init(FVector3f::ZeroVector, NumInertializationBones);
	BoneRotationDiffAngle.Init(0.0f, NumInertializationBones);
	BoneRotationDiffSpeed.Init(0.0f, NumInertializationBones);
	BoneScaleDiffAxis.Init(FVector3f::ZeroVector, NumInertializationBones);
	BoneScaleDiffMagnitude.Init(0.0f, NumInertializationBones);
	BoneScaleDiffSpeed.Init(0.0f, NumInertializationBones);

	for (FCompactPoseBoneIndex BoneIndex : InPose.ForEachBoneIndex())
	{
		const int32 SkeletonPoseBoneIndex = BoneContainer.GetSkeletonIndex(BoneIndex);
		if (SkeletonPoseBoneIndex == INDEX_NONE || Prev1.BoneIndices[SkeletonPoseBoneIndex] == INDEX_NONE || Prev2.BoneIndices[SkeletonPoseBoneIndex] == INDEX_NONE)
		{
			continue;
		}

		const int32 InertializationBoneIndex = BoneIndices[SkeletonPoseBoneIndex];
		const int32 Prev1PoseBoneIndex = Prev1.BoneIndices[SkeletonPoseBoneIndex];
		const int32 Prev2PoseBoneIndex = Prev2.BoneIndices[SkeletonPoseBoneIndex];

		const FTransform PoseTransform = InPose[BoneIndex];
		FTransform Prev1Transform = FTransform(Prev1.BoneRotations[Prev1PoseBoneIndex], Prev1.BoneTranslations[Prev1PoseBoneIndex], Prev1.BoneScales[Prev1PoseBoneIndex]);
		FTransform Prev2Transform = FTransform(Prev2.BoneRotations[Prev2PoseBoneIndex], Prev2.BoneTranslations[Prev2PoseBoneIndex], Prev2.BoneScales[Prev2PoseBoneIndex]);

		if (BoneIndex.IsRootBone())
		{
			// World-space inertialization puts the historical roots in one reference frame.
			if (InertializationSpace == EInertializationSpace::WorldSpace)
			{
				Prev1Transform *= Prev1.ComponentTransform.GetRelativeTransform(ComponentTransform);
				Prev2Transform *= Prev2.ComponentTransform.GetRelativeTransform(ComponentTransform);
			}
			else if (InertializationSpace == EInertializationSpace::WorldRotation)
			{
				Prev1Transform.SetRotation(ComponentTransformGetRotationInverse * Prev1.ComponentTransform.GetRotation() * Prev1Transform.GetRotation());
				Prev2Transform.SetRotation(ComponentTransformGetRotationInverse * Prev2.ComponentTransform.GetRotation() * Prev2Transform.GetRotation());
			}
		}

		{
			FVector TranslationDirection = FVector::ZeroVector;
			float TranslationSpeed = 0.0f;
			const FVector T = Prev1Transform.GetTranslation() - PoseTransform.GetTranslation();
			const float TranslationMagnitude = T.Size();
			if (TranslationMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				TranslationDirection = T / TranslationMagnitude;
			}
			if (Prev1.DeltaTime > UE_KINDA_SMALL_NUMBER && TranslationMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				const FVector PrevT = Prev2Transform.GetTranslation() - PoseTransform.GetTranslation();
				const float PrevMagnitude = FVector::DotProduct(PrevT, TranslationDirection);
				TranslationSpeed = (TranslationMagnitude - PrevMagnitude) / Prev1.DeltaTime;
			}
			BoneTranslationDiffDirection[InertializationBoneIndex] = (FVector3f)TranslationDirection;
			BoneTranslationDiffMagnitude[InertializationBoneIndex] = TranslationMagnitude;
			BoneTranslationDiffSpeed[InertializationBoneIndex] = TranslationSpeed;
		}

		{
			FVector RotationAxis = FVector::ZeroVector;
			float RotationAngle = 0.0f;
			float RotationSpeed = 0.0f;
			const FQuat Q = Prev1Transform.GetRotation() * PoseTransform.GetRotation().Inverse();
			Q.ToAxisAndAngle(RotationAxis, RotationAngle);
			RotationAngle = FMath::UnwindRadians(RotationAngle);
			if (RotationAngle < 0.0f)
			{
				RotationAxis = -RotationAxis;
				RotationAngle = -RotationAngle;
			}
			if (Prev1.DeltaTime > UE_KINDA_SMALL_NUMBER && RotationAngle > UE_KINDA_SMALL_NUMBER)
			{
				const FQuat PrevQ = Prev2Transform.GetRotation() * PoseTransform.GetRotation().Inverse();
				const float PrevAngle = PrevQ.GetTwistAngle(RotationAxis);
				RotationSpeed = FMath::UnwindRadians(RotationAngle - PrevAngle) / Prev1.DeltaTime;
			}
			BoneRotationDiffAxis[InertializationBoneIndex] = (FVector3f)RotationAxis;
			BoneRotationDiffAngle[InertializationBoneIndex] = RotationAngle;
			BoneRotationDiffSpeed[InertializationBoneIndex] = RotationSpeed;
		}

		{
			FVector ScaleAxis = FVector::ZeroVector;
			float ScaleSpeed = 0.0f;
			const FVector S = Prev1Transform.GetScale3D() - PoseTransform.GetScale3D();
			const float ScaleMagnitude = S.Size();
			if (ScaleMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				ScaleAxis = S / ScaleMagnitude;
			}
			if (Prev1.DeltaTime > UE_KINDA_SMALL_NUMBER && ScaleMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				const FVector PrevS = Prev2Transform.GetScale3D() - PoseTransform.GetScale3D();
				const float PrevMagnitude = FVector::DotProduct(PrevS, ScaleAxis);
				ScaleSpeed = (ScaleMagnitude - PrevMagnitude) / Prev1.DeltaTime;
			}
			BoneScaleDiffAxis[InertializationBoneIndex] = (FVector3f)ScaleAxis;
			BoneScaleDiffMagnitude[InertializationBoneIndex] = ScaleMagnitude;
			BoneScaleDiffSpeed[InertializationBoneIndex] = ScaleSpeed;
		}
	}

	// Curve differences and their derivatives.
	CurveDiffs.CopyFrom(InCurves);
	UE::Anim::FNamedValueArrayUtils::Union(CurveDiffs, Prev1.Curves.BlendedCurve,
		[](FInertializationCurveDiffElement& OutResultElement, const UE::Anim::FCurveElement& InElement1, UE::Anim::ENamedValueUnionFlags InFlags)
		{
			OutResultElement.Delta = InElement1.Value - OutResultElement.Value;
		});
	if (Prev1.DeltaTime > UE_KINDA_SMALL_NUMBER)
	{
		UE::Anim::FNamedValueArrayUtils::Union(CurveDiffs, Prev2.Curves.BlendedCurve,
			[PrevDeltaTime = Prev1.DeltaTime](FInertializationCurveDiffElement& OutResultElement, const UE::Anim::FCurveElement& InElement1, UE::Anim::ENamedValueUnionFlags InFlags)
			{
				const float Prev1Weight = OutResultElement.Delta - OutResultElement.Value;
				const float Prev2Weight = InElement1.Value;
				OutResultElement.Derivative = (Prev1Weight - Prev2Weight) / PrevDeltaTime;
			});
	}
	if (CurveFilter.Num() > 0)
	{
		UE::Anim::FCurveUtils::Filter(CurveDiffs, CurveFilter);
	}

	// Root motion velocity difference (no acceleration: too noisy to blend out).
	RootTranslationVelocityDiffDirection = FVector3f::ZeroVector;
	RootTranslationVelocityDiffMagnitude = 0.0f;
	RootRotationVelocityDiffDirection = FVector3f::ZeroVector;
	RootRotationVelocityDiffMagnitude = 0.0f;
	RootScaleVelocityDiffDirection = FVector3f::ZeroVector;
	RootScaleVelocityDiffMagnitude = 0.0f;

	if (const UE::Anim::IAnimRootMotionProvider* RootMotionProvider = UE::Anim::IAnimRootMotionProvider::Get())
	{
		FTransform CurrRootMotionDelta = FTransform::Identity;
		if (RootMotionProvider->ExtractRootMotion(InAttributes, CurrRootMotionDelta) && Prev1.bHasRootMotion && Prev1.DeltaTime > UE_KINDA_SMALL_NUMBER && DeltaTime > UE_KINDA_SMALL_NUMBER)
		{
			const FVector RootTranslationVelocityDiff = (Prev1.RootMotionDelta.GetTranslation() / Prev1.DeltaTime) - (CurrRootMotionDelta.GetTranslation() / DeltaTime);
			RootTranslationVelocityDiffMagnitude = RootTranslationVelocityDiff.Size();
			if (RootTranslationVelocityDiffMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				RootTranslationVelocityDiffDirection = (FVector3f)RootTranslationVelocityDiff / RootTranslationVelocityDiffMagnitude;
			}

			const FVector RootRotationVelocityDiff = (Prev1.RootMotionDelta.GetRotation().ToRotationVector() / Prev1.DeltaTime) - (CurrRootMotionDelta.GetRotation().ToRotationVector() / DeltaTime);
			RootRotationVelocityDiffMagnitude = RootRotationVelocityDiff.Size();
			if (RootRotationVelocityDiffMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				RootRotationVelocityDiffDirection = (FVector3f)RootRotationVelocityDiff / RootRotationVelocityDiffMagnitude;
			}

			const FVector RootScaleVelocityDiff = (Prev1.RootMotionDelta.GetScale3D() / Prev1.DeltaTime) - (CurrRootMotionDelta.GetScale3D() / DeltaTime);
			RootScaleVelocityDiffMagnitude = RootScaleVelocityDiff.Size();
			if (RootScaleVelocityDiffMagnitude > UE_KINDA_SMALL_NUMBER)
			{
				RootScaleVelocityDiffDirection = (FVector3f)RootScaleVelocityDiff / RootScaleVelocityDiffMagnitude;
			}
		}
	}
}

void FVgeAnimNode_Inertialization::ApplyTo(FCompactPose& InOutPose, FBlendedCurve& InOutCurves, UE::Anim::FStackAttributeContainer& InOutAttributes)
{
	const FBoneContainer& BoneContainer = InOutPose.GetBoneContainer();

	for (FCompactPoseBoneIndex BoneIndex : InOutPose.ForEachBoneIndex())
	{
		const int32 SkeletonPoseBoneIndex = BoneContainer.GetSkeletonIndex(BoneIndex);
		if (SkeletonPoseBoneIndex == INDEX_NONE || BoneIndices[SkeletonPoseBoneIndex] == INDEX_NONE || BoneFilter.Contains(BoneIndex))
		{
			continue;
		}

		const int32 InertializationBoneIndex = BoneIndices[SkeletonPoseBoneIndex];
		const float Duration = InertializationDurationPerBone[SkeletonPoseBoneIndex];

		const FVector T = (FVector)BoneTranslationDiffDirection[InertializationBoneIndex] *
			Offset(BoneTranslationDiffMagnitude[InertializationBoneIndex], BoneTranslationDiffSpeed[InertializationBoneIndex], InertializationElapsedTime, Duration);
		InOutPose[BoneIndex].AddToTranslation(T);

		const FQuat Q = FQuat((FVector)BoneRotationDiffAxis[InertializationBoneIndex],
			Offset(BoneRotationDiffAngle[InertializationBoneIndex], BoneRotationDiffSpeed[InertializationBoneIndex], InertializationElapsedTime, Duration));
		InOutPose[BoneIndex].SetRotation(Q * InOutPose[BoneIndex].GetRotation());

		const FVector S = (FVector)BoneScaleDiffAxis[InertializationBoneIndex] *
			Offset(BoneScaleDiffMagnitude[InertializationBoneIndex], BoneScaleDiffSpeed[InertializationBoneIndex], InertializationElapsedTime, Duration);
		InOutPose[BoneIndex].SetScale3D(S + InOutPose[BoneIndex].GetScale3D());
	}

	InOutPose.NormalizeRotations();

	PoseCurveData.CopyFrom(InOutCurves);
	UE::Anim::FNamedValueArrayUtils::Union(InOutCurves, PoseCurveData, CurveDiffs, [this](UE::Anim::FCurveElement& OutResultElement, const UE::Anim::FCurveElement& InElement0, const FInertializationCurveDiffElement& InElement1, UE::Anim::ENamedValueUnionFlags InFlags)
		{
			// Filtered curves take the destination value.
			if (FilteredCurves.Contains(OutResultElement.Name))
			{
				OutResultElement.Value = InElement0.Value;
				OutResultElement.Flags = InElement0.Flags;
				return;
			}
			OutResultElement.Value = InElement0.Value + Offset(InElement1.Delta, InElement1.Derivative, InertializationElapsedTime, InertializationDuration);
			OutResultElement.Flags = InElement0.Flags | InElement1.Flags;
		});

	if (const UE::Anim::IAnimRootMotionProvider* RootMotionProvider = UE::Anim::IAnimRootMotionProvider::Get())
	{
		FTransform CurrRootMotionDelta = FTransform::Identity;
		if (RootMotionProvider->ExtractRootMotion(InOutAttributes, CurrRootMotionDelta))
		{
			// The root bone's duration.
			const float Duration = InertializationDurationPerBone[0];

			const FVector T = DeltaTime * (FVector)RootTranslationVelocityDiffDirection * CalcInertialFloat(RootTranslationVelocityDiffMagnitude, 0.0f, InertializationElapsedTime, Duration);
			CurrRootMotionDelta.AddToTranslation(T);

			const FQuat Q = FQuat::MakeFromRotationVector(DeltaTime * (FVector)RootRotationVelocityDiffDirection * CalcInertialFloat(RootRotationVelocityDiffMagnitude, 0.0f, InertializationElapsedTime, Duration));
			CurrRootMotionDelta.SetRotation(Q * CurrRootMotionDelta.GetRotation());

			const FVector S = DeltaTime * (FVector)RootScaleVelocityDiffDirection * CalcInertialFloat(RootScaleVelocityDiffMagnitude, 0.0f, InertializationElapsedTime, Duration);
			CurrRootMotionDelta.SetScale3D(S + CurrRootMotionDelta.GetScale3D());

			RootMotionProvider->OverrideRootMotion(CurrRootMotionDelta, InOutAttributes);
		}
	}
}

void FVgeAnimNode_Inertialization::Deactivate()
{
	InertializationState = EInertializationState::Inactive;

	BoneIndices.Empty();
	BoneTranslationDiffDirection.Empty();
	BoneTranslationDiffMagnitude.Empty();
	BoneTranslationDiffSpeed.Empty();
	BoneRotationDiffAxis.Empty();
	BoneRotationDiffAngle.Empty();
	BoneRotationDiffSpeed.Empty();
	BoneScaleDiffAxis.Empty();
	BoneScaleDiffMagnitude.Empty();
	BoneScaleDiffSpeed.Empty();
	CurveDiffs.Empty();
	InertializationDurationPerBone.Empty();

	InertializationElapsedTime = 0.0f;
	InertializationDuration = 0.0f;
	InertializationMaxDuration = 0.0f;
	InertializationDeficit = 0.0f;
}

void FVgeInertializationSparsePose::InitFrom(const FCompactPose& Pose, const FBlendedCurve& InCurves, const UE::Anim::FStackAttributeContainer& Attributes, const FTransform& InComponentTransform, FName InAttachParentName, float InDeltaTime)
{
	const FBoneContainer& BoneContainer = Pose.GetBoneContainer();
	BoneIndices.Init(INDEX_NONE, NumSkeletonBones(BoneContainer));

	int32 NumInertializationBones = 0;
	for (const FCompactPoseBoneIndex BoneIndex : Pose.ForEachBoneIndex())
	{
		const int32 SkeletonPoseBoneIndex = BoneContainer.GetSkeletonIndex(BoneIndex);
		if (SkeletonPoseBoneIndex != INDEX_NONE)
		{
			BoneIndices[SkeletonPoseBoneIndex] = NumInertializationBones++;
		}
	}

	BoneTranslations.Init(FVector::ZeroVector, NumInertializationBones);
	BoneRotations.Init(FQuat::Identity, NumInertializationBones);
	BoneScales.Init(FVector::OneVector, NumInertializationBones);
	for (const FCompactPoseBoneIndex BoneIndex : Pose.ForEachBoneIndex())
	{
		const int32 SkeletonPoseBoneIndex = BoneContainer.GetSkeletonIndex(BoneIndex);
		if (SkeletonPoseBoneIndex == INDEX_NONE)
		{
			continue;
		}
		const int32 InertializationBoneIndex = BoneIndices[SkeletonPoseBoneIndex];
		const FTransform BoneTransform = Pose[BoneIndex];
		BoneTranslations[InertializationBoneIndex] = BoneTransform.GetTranslation();
		BoneRotations[InertializationBoneIndex] = BoneTransform.GetRotation();
		BoneScales[InertializationBoneIndex] = BoneTransform.GetScale3D();
	}

	bHasRootMotion = false;
	RootMotionDelta = FTransform::Identity;
	if (const UE::Anim::IAnimRootMotionProvider* RootMotionProvider = UE::Anim::IAnimRootMotionProvider::Get())
	{
		bHasRootMotion = RootMotionProvider->ExtractRootMotion(Attributes, RootMotionDelta);
	}

	Curves.InitFrom(InCurves);
	ComponentTransform = InComponentTransform;
	AttachParentName = InAttachParentName;
	DeltaTime = InDeltaTime;
}

void FVgeInertializationSparsePose::Empty()
{
	BoneIndices.Empty();
	BoneTranslations.Empty();
	BoneRotations.Empty();
	BoneScales.Empty();
	Curves.BlendedCurve.Empty();
}
