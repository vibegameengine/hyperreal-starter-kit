#pragma once

#include "CoreMinimal.h"
#include "AlphaBlend.h"
#include "Animation/AnimNodeBase.h"
#include "Animation/AnimNode_Inertialization.h"
#include "Animation/AnimNode_LinkedAnimGraph.h"
#include "Animation/AnimNodeSpaceConversions.h"
#include "AnimNodes/AnimNode_LayeredBoneBlend.h"
#include "AnimNodes/AnimNode_BlendListBase.h"
#include "BoneControllers/AnimNode_AnimDynamics.h"
#include "BoneControllers/AnimNode_TwoBoneIK.h"
#include "StructUtils/InstancedStruct.h"
#include "VgeAnimNodes.generated.h"

class UBlendProfile;
class UCurveFloat;
struct FAnimNode_AssetPlayerRelevancyBase;

// Anim nodes of graphs built at runtime (UVgeAnimInstance) where the engine's own node cannot run without an
// Animation Blueprint class: those read settings the compiler folds into the class (FAnimNode_Base::GetData), or
// need the class's baked data (FAnimNode_StateMachine), or ask for their index in it (FAnimNode_Base::GetNodeIndex).
// Each keeps its settings in its own fields and otherwise works as the engine node it stands for.

// FAnimNode_LinkedAnimGraph that keeps the instance it runs when the graph around it is rebuilt.
USTRUCT()
struct FVgeAnimNode_LinkedAnimGraph : public FAnimNode_LinkedAnimGraph
{
	GENERATED_BODY()

	// Shuts down the instance this node runs (the node is leaving the graph).
	void Teardown(const UAnimInstance* InOwningAnimInstance) { TeardownInstance(InOwningAnimInstance); }

	// Links the running instance's input pose nodes to InputPoses again (InputPoses changed).
	void Relink(UAnimInstance* InOwningAnimInstance)
	{
		DynamicUnlink(InOwningAnimInstance);
		DynamicLink(InOwningAnimInstance);
	}

protected:
	virtual void OnInitializeAnimInstance(const FAnimInstanceProxy* InProxy, const UAnimInstance* InAnimInstance) override;
};

// A pose snapshot that may lack some bones (FInertializationSparsePose, whose members are private to the engine node).
struct FVgeInertializationSparsePose
{
	FTransform ComponentTransform;
	bool bHasRootMotion = false;
	FTransform RootMotionDelta;
	// Per skeleton bone index: the index into BoneTranslations, BoneRotations and BoneScales, or INDEX_NONE.
	TArray<int32> BoneIndices;
	TArray<FVector> BoneTranslations;
	TArray<FQuat> BoneRotations;
	TArray<FVector> BoneScales;
	FInertializationCurve Curves;
	FName AttachParentName = NAME_None;
	float DeltaTime = 0.0f;

	void InitFrom(const FCompactPose& Pose, const FBlendedCurve& InCurves, const UE::Anim::FStackAttributeContainer& Attributes, const FTransform& InComponentTransform, FName InAttachParentName, float InDeltaTime);
	bool IsEmpty() const { return BoneIndices.IsEmpty(); }
	void Empty();
};

// FAnimNode_Inertialization (Inertialization: High-Performance Animation Transitions in 'Gears of War', David Bollo,
// GDC 2018), the engine's implementation as it is, minus what needs an Animation Blueprint class: its Evaluate traces
// under the node's class index (GetNodeIndex), which a node outside a class does not have.
USTRUCT()
struct FVgeAnimNode_Inertialization : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FPoseLink Source;

	// Blend profile for requests that bring none.
	UPROPERTY()
	TObjectPtr<UBlendProfile> DefaultBlendProfile = nullptr;

	// Curves and bones that switch at once instead of blending.
	UPROPERTY()
	TArray<FName> FilteredCurves;

	UPROPERTY()
	TArray<FBoneReference> FilteredBones;

	// Clears blends in progress when the node becomes relevant again.
	UPROPERTY()
	bool bResetOnBecomingRelevant = false;

	// Requests carrying a tag go only to the node with that tag.
	UPROPERTY()
	FName Tag = NAME_None;

	PRAGMA_DISABLE_DEPRECATION_WARNINGS
	FVgeAnimNode_Inertialization() = default;
	FVgeAnimNode_Inertialization(const FVgeAnimNode_Inertialization&) = default;
	FVgeAnimNode_Inertialization& operator=(const FVgeAnimNode_Inertialization&) = default;
	PRAGMA_ENABLE_DEPRECATION_WARNINGS

	// If several requests reach the node in one update, the shortest duration wins (per bone with blend profiles).
	void RequestInertialization(const FInertializationRequest& Request);

	bool IsActive() const { return InertializationState != EInertializationState::Inactive; }
	float GetElapsedTime() const { return InertializationElapsedTime; }
	float GetDuration() const { return InertializationDuration; }

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;
	virtual bool NeedsDynamicReset() const override { return true; }

private:
	void Deactivate();
	void InitFrom(const FCompactPose& InPose, const FBlendedCurve& InCurves, const UE::Anim::FStackAttributeContainer& InAttributes, const FTransform& ComponentTransform, FName AttachParentName, const FVgeInertializationSparsePose& Prev1, const FVgeInertializationSparsePose& Prev2);
	void ApplyTo(FCompactPose& InOutPose, FBlendedCurve& InOutCurves, UE::Anim::FStackAttributeContainer& InOutAttributes);

	FVgeInertializationSparsePose PrevPoseSnapshot;
	FVgeInertializationSparsePose CurrPoseSnapshot;
	float DeltaTime = 0.0f;

	UPROPERTY(Transient)
	TArray<FInertializationRequest> RequestQueue;

	FGraphTraversalCounter UpdateCounter;
	EInertializationState InertializationState = EInertializationState::Inactive;
	float InertializationElapsedTime = 0.0f;
	float InertializationDuration = 0.0f;
	TCustomBoneIndexArray<float, FSkeletonPoseBoneIndex> InertializationDurationPerBone;
	float InertializationMaxDuration = 0.0f;
	float InertializationDeficit = 0.0f;

	TArray<int32> BoneIndices;
	TArray<FVector3f> BoneTranslationDiffDirection;
	TArray<float> BoneTranslationDiffMagnitude;
	TArray<float> BoneTranslationDiffSpeed;
	TArray<FVector3f> BoneRotationDiffAxis;
	TArray<float> BoneRotationDiffAngle;
	TArray<float> BoneRotationDiffSpeed;
	TArray<FVector3f> BoneScaleDiffAxis;
	TArray<float> BoneScaleDiffMagnitude;
	TArray<float> BoneScaleDiffSpeed;
	FVector3f RootTranslationVelocityDiffDirection = FVector3f::ZeroVector;
	float RootTranslationVelocityDiffMagnitude = 0.0f;
	FVector3f RootRotationVelocityDiffDirection = FVector3f::ZeroVector;
	float RootRotationVelocityDiffMagnitude = 0.0f;
	FVector3f RootScaleVelocityDiffDirection = FVector3f::ZeroVector;
	float RootScaleVelocityDiffMagnitude = 0.0f;

	TBaseBlendedCurve<FDefaultAllocator, FInertializationCurveDiffElement> CurveDiffs;
	TBaseBlendedCurve<TInlineAllocator<8>, UE::Anim::FCurveElement> PoseCurveData;

	UE::Anim::FCurveFilter CurveFilter;
	TArray<FCompactPoseBoneIndex, TInlineAllocator<8>> BoneFilter;
};

// FAnimNode_BlendListBase (blend poses by bool / int / enum) with its settings in its own fields.
USTRUCT()
struct FVgeAnimNode_BlendList : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	TArray<FPoseLink> BlendPose;

	// Time to blend to each pose when it becomes active.
	UPROPERTY()
	TArray<float> BlendTime;

	UPROPERTY()
	int32 ActiveIndex = 0;

	UPROPERTY()
	EBlendListTransitionType TransitionType = EBlendListTransitionType::StandardBlend;

	UPROPERTY()
	EAlphaBlendOption BlendType = EAlphaBlendOption::Linear;

	UPROPERTY()
	TObjectPtr<UCurveFloat> CustomBlendCurve = nullptr;

	UPROPERTY()
	TObjectPtr<UBlendProfile> BlendProfile = nullptr;

	UPROPERTY()
	EBlendListChildUpdateMode ChildUpdateMode = EBlendListChildUpdateMode::Default;

	int32 GetActiveChildIndex() const { return BlendPose.Num() > 0 ? FMath::Clamp(ActiveIndex, 0, BlendPose.Num() - 1) : 0; }
	float GetChildWeight(int32 Index) const { return PerBlendData.IsValidIndex(Index) ? PerBlendData[Index].Weight : 0.0f; }

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;

private:
	void Reset();
	void SetCurrentBlendProfile(UBlendProfile* NewBlendProfile);
	float BlendTimeOf(int32 Index) const { return BlendTime.IsValidIndex(Index) ? BlendTime[Index] : (BlendTime.Num() > 0 ? BlendTime.Last() : 0.0f); }

	struct FBlendData
	{
		FAlphaBlend Blend;
		float Weight = 0.0f;
		float RemainingTime = 0.0f;
		float StartAlpha = 0.0f;
	};
	TArray<FBlendData> PerBlendData;
	TArray<FBlendSampleData> PerBoneSampleData;

	UPROPERTY(Transient)
	TObjectPtr<UBlendProfile> CurrentBlendProfile = nullptr;

	int32 LastActiveChildIndex = INDEX_NONE;
};

// A condition on graph variables, compiled from text such as "speed > 10 && !falling" into postfix form. Besides
// graph variables it reads timeRemaining (seconds left in the most relevant animation of the state it leaves) and
// timeElapsed (seconds spent in that state). Operators: ! - * / + - < <= > >= == != && || and parentheses.
struct FVgeAnimCondition
{
	enum class EOp : uint8 { Number, Variable, TimeRemaining, TimeElapsed, Not, Negate, Multiply, Divide, Add, Subtract, Less, LessEqual, Greater, GreaterEqual, Equal, NotEqual, And, Or };

	struct FToken
	{
		EOp Op = EOp::Number;
		double Number = 0.0;
		FName Variable;
	};

	TArray<FToken> Program;

	// False with the reason when the text is not a condition; an empty text is a condition that always holds.
	bool Compile(const FString& Text, FString& OutError);
	bool Evaluate(const TMap<FName, double>& Variables, double TimeRemaining, double TimeElapsed) const;
	bool ReadsTimeRemaining() const { return Program.ContainsByPredicate([](const FToken& Token) { return Token.Op == EOp::TimeRemaining; }); }
};

UENUM()
enum class EVgeTransitionBlend : uint8
{
	// Both states play and their poses blend over the duration.
	Crossfade,
	// The new state takes over at once and the nearest inertialization node above smooths the change.
	Inertialization,
};

// A state of a state machine: a name and the pose that plays in it.
USTRUCT()
struct FVgeAnimNode_State : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FPoseLink Source;

	UPROPERTY()
	FName Name;

	// Starts the state's pose from the beginning even when it is entered while still blending out.
	UPROPERTY()
	bool bAlwaysResetOnEntry = false;

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;
};

// A transition of a state machine: from a state (or any, "*") to a state when its condition holds. It is data the
// machine reads, never a pose node itself.
USTRUCT()
struct FVgeAnimNode_Transition : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FName From;

	UPROPERTY()
	FName To;

	UPROPERTY()
	float Duration = 0.2f;

	UPROPERTY()
	EVgeTransitionBlend Blend = EVgeTransitionBlend::Crossfade;

	UPROPERTY()
	EAlphaBlendOption BlendType = EAlphaBlendOption::Linear;

	UPROPERTY()
	TObjectPtr<UBlendProfile> BlendProfile = nullptr;

	FVgeAnimCondition Condition;
	FString ConditionText;
};

// The engine's state machine (FAnimNode_StateMachine) without the class data it is baked into: states, transitions
// tried in order from the current state (up to MaxTransitionsPerFrame chained in one update), crossfades that blend
// every state still weighted, and transitions that hand the change to an inertialization node.
USTRUCT()
struct FVgeAnimNode_StateMachine : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FName EntryState;

	UPROPERTY()
	int32 MaxTransitionsPerFrame = 3;

	// Set by the graph that owns the machine (FVgeAnimInstanceProxy).
	TArray<FVgeAnimNode_State*> States;
	TArray<const FVgeAnimNode_Transition*> Transitions;
	TArray<TArray<FAnimNode_AssetPlayerRelevancyBase*>> StateAssetPlayers;
	const TMap<FName, double>* Variables = nullptr;

	FName GetCurrentStateName() const { return States.IsValidIndex(CurrentState) ? States[CurrentState]->Name : NAME_None; }
	float GetStateWeight(int32 Index) const { return Weights.IsValidIndex(Index) ? Weights[Index] : 0.0f; }
	float GetElapsedTime() const { return ElapsedTime; }
	int32 GetTransitionCount() const { return TransitionCount; }

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;

private:
	int32 FindState(FName Name) const;
	float TimeRemainingIn(int32 State) const;
	// Returns true when the state was entered with an inertialization request.
	bool EnterState(const FAnimationUpdateContext& Context, int32 NewState, const FVgeAnimNode_Transition& Transition);

	int32 CurrentState = INDEX_NONE;
	TArray<float> Weights;
	TArray<float> StartWeights;
	float BlendElapsed = 0.0f;
	float BlendDuration = 0.0f;
	EAlphaBlendOption BlendType = EAlphaBlendOption::Linear;
	float ElapsedTime = 0.0f;
	int32 TransitionCount = 0;
	bool bLoggedMissingInertialization = false;
};

// FAnimNode_LayeredBoneBlend whose layer setup can change while it runs.
USTRUCT()
struct FVgeAnimNode_LayeredBoneBlend : public FAnimNode_LayeredBoneBlend
{
	GENERATED_BODY()

	// The per-bone weights are built again from LayerSetup on the next bone caching.
	void InvalidatePerBoneWeights()
	{
		SkeletonGuid.Invalidate();
		RequiredBonesSerialNumber = 0;
	}
};

// FAnimNode_TwoBoneIK as a local-space node: the Animation Blueprint compiler puts the component-space conversions
// around skeletal controls itself, so here they are part of the node.
USTRUCT()
struct FVgeAnimNode_TwoBoneIK : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FAnimNode_ConvertComponentToLocalSpace ToLocal;

	UPROPERTY()
	FAnimNode_TwoBoneIK IK;

	UPROPERTY()
	FAnimNode_ConvertLocalToComponentSpace ToComponent;

	// The local-space input pose.
	FPoseLink& Source() { return ToComponent.LocalPose; }

	FVgeAnimNode_TwoBoneIK();

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;
};

USTRUCT()
struct FVgeAnimNode_SkeletalControl : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FAnimNode_ConvertComponentToLocalSpace ToLocal;

	UPROPERTY()
	FInstancedStruct Control;

	UPROPERTY()
	FAnimNode_ConvertLocalToComponentSpace ToComponent;

	FPoseLink& Source() { return ToComponent.LocalPose; }
	FAnimNode_SkeletalControlBase* Get() { return Control.GetMutablePtr<FAnimNode_SkeletalControlBase>(); }

	bool SetControlStruct(const UScriptStruct* Struct);

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;
	virtual bool HasPreUpdate() const override;
	virtual void PreUpdate(const UAnimInstance* InAnimInstance) override;
	virtual bool NeedsDynamicReset() const override { return true; }
	virtual void ResetDynamics(ETeleportType InTeleportType) override;
};

USTRUCT()
struct FVgeAnimNode_AnimDynamics : public FAnimNode_Base
{
	GENERATED_BODY()

	UPROPERTY()
	FAnimNode_ConvertComponentToLocalSpace ToLocal;

	UPROPERTY()
	FAnimNode_AnimDynamics Dynamics;

	UPROPERTY()
	FAnimNode_ConvertLocalToComponentSpace ToComponent;

	FPoseLink& Source() { return ToComponent.LocalPose; }

	FVgeAnimNode_AnimDynamics();

	virtual void Initialize_AnyThread(const FAnimationInitializeContext& Context) override;
	virtual void CacheBones_AnyThread(const FAnimationCacheBonesContext& Context) override;
	virtual void Update_AnyThread(const FAnimationUpdateContext& Context) override;
	virtual void Evaluate_AnyThread(FPoseContext& Output) override;
	virtual void GatherDebugData(FNodeDebugData& DebugData) override;
	virtual bool HasPreUpdate() const override { return true; }
	virtual void PreUpdate(const UAnimInstance* InAnimInstance) override { Dynamics.PreUpdate(InAnimInstance); }
	virtual bool NeedsDynamicReset() const override { return true; }
	virtual void ResetDynamics(ETeleportType InTeleportType) override { Dynamics.ResetDynamics(InTeleportType); }
	virtual int32 GetLODThreshold() const override { return Dynamics.GetLODThreshold(); }
};
