#include "VgeAnimNodes.h"

#include "AnimationRuntime.h"
#include "Animation/AnimInertializationSyncScope.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/AnimNode_RelevantAssetPlayerBase.h"
#include "Animation/AnimTrace.h"
#include "Animation/BlendProfile.h"
#include "Animation/SkeletonRemapping.h"
#include "Animation/SkeletonRemappingRegistry.h"
#include "VgeAnimInstance.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeAnimNodes, Log, All);

namespace
{
	// Blends the given poses by weight into Output, as FAnimNode_BlendListBase::Evaluate_AnyThread does.
	void EvaluateWeighted(FPoseContext& Output, TArrayView<FPoseLink*> Poses, TArrayView<const float> Weights, UBlendProfile* BlendProfile, TArrayView<FBlendSampleData> PerBoneSampleData)
	{
		TArray<int32, TInlineAllocator<8>> PosesToEvaluate;
		for (int32 Index = 0; Index < Poses.Num(); ++Index)
		{
			if (Weights[Index] > ZERO_ANIMWEIGHT_THRESH)
			{
				PosesToEvaluate.Add(Index);
			}
		}
		if (PosesToEvaluate.Num() == 0)
		{
			Output.ResetToRefPose();
			return;
		}
		if (PosesToEvaluate.Num() == 1 && FAnimWeight::IsFullWeight(Weights[PosesToEvaluate[0]]) && BlendProfile == nullptr)
		{
			Poses[PosesToEvaluate[0]]->Evaluate(Output);
			return;
		}
		if (PosesToEvaluate.Num() == 2 && BlendProfile == nullptr && FMath::IsNearlyEqual(Weights[PosesToEvaluate[0]] + Weights[PosesToEvaluate[1]], 1.f))
		{
			Poses[PosesToEvaluate[0]]->Evaluate(Output);
			FPoseContext Second(Output);
			Poses[PosesToEvaluate[1]]->Evaluate(Second);
			FAnimationPoseData InOutPoseData(Output);
			const FAnimationPoseData SecondData(Second);
			FAnimationRuntime::BlendTwoPosesTogetherInPlace(InOutPoseData, SecondData, Weights[PosesToEvaluate[0]]);
			return;
		}

		TArray<FCompactPose, TInlineAllocator<8>> FilteredPoses;
		TArray<FBlendedCurve, TInlineAllocator<8>> FilteredCurve;
		TArray<UE::Anim::FStackAttributeContainer, TInlineAllocator<8>> FilteredAttributes;
		FilteredPoses.SetNum(PosesToEvaluate.Num(), EAllowShrinking::No);
		FilteredCurve.SetNum(PosesToEvaluate.Num(), EAllowShrinking::No);
		FilteredAttributes.SetNum(PosesToEvaluate.Num(), EAllowShrinking::No);
		for (int32 Slot = 0; Slot < PosesToEvaluate.Num(); ++Slot)
		{
			FPoseContext EvaluateContext(Output);
			Poses[PosesToEvaluate[Slot]]->Evaluate(EvaluateContext);
			FilteredPoses[Slot].MoveBonesFrom(EvaluateContext.Pose);
			FilteredCurve[Slot].MoveFrom(EvaluateContext.Curve);
			FilteredAttributes[Slot].MoveFrom(EvaluateContext.CustomAttributes);
		}

		FAnimationPoseData OutAnimationPoseData(Output);
		if (BlendProfile)
		{
			const USkeleton* TargetSkeleton = Output.Pose.GetBoneContainer().GetSkeletonAsset();
			const FSkeletonRemapping& SkeletonRemapping = UE::Anim::FSkeletonRemappingRegistry::Get().GetRemapping(BlendProfile->OwningSkeleton, TargetSkeleton);
			if (SkeletonRemapping.IsValid())
			{
				FAnimationRuntime::BlendPosesTogetherPerBoneRemapped(FilteredPoses, FilteredCurve, FilteredAttributes, BlendProfile, PerBoneSampleData, PosesToEvaluate, SkeletonRemapping, OutAnimationPoseData);
			}
			else
			{
				FAnimationRuntime::BlendPosesTogetherPerBone(FilteredPoses, FilteredCurve, FilteredAttributes, BlendProfile, PerBoneSampleData, PosesToEvaluate, OutAnimationPoseData);
			}
		}
		else
		{
			FAnimationRuntime::BlendPosesTogether(FilteredPoses, FilteredCurve, FilteredAttributes, Weights, PosesToEvaluate, OutAnimationPoseData);
		}
	}
}

// FVgeAnimNode_LinkedAnimGraph

void FVgeAnimNode_LinkedAnimGraph::OnInitializeAnimInstance(const FAnimInstanceProxy* InProxy, const UAnimInstance* InAnimInstance)
{
	// A graph rebuilt around this node keeps the instance it runs; a new node, or a full initialization of the
	// owner (FAnimNode_LinkedAnimGraph's own behaviour), creates one.
	const UAnimInstance* Running = GetTargetInstance<UAnimInstance>();
	if (Running && Running->GetClass() == *InstanceClass && static_cast<const FVgeAnimInstanceProxy*>(InProxy)->IsRebuildingGraph())
	{
		return;
	}
	FAnimNode_LinkedAnimGraph::OnInitializeAnimInstance(InProxy, InAnimInstance);
}

// FVgeAnimNode_BlendList: FAnimNode_BlendListBase (AnimGraphRuntime/Private/AnimNodes/AnimNode_BlendListBase.cpp)
// reading its own fields instead of folded class data.

void FVgeAnimNode_BlendList::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);

	PerBlendData.Reset(BlendPose.Num());
	if (BlendPose.Num() > 0)
	{
		// Full weight on the first pose until the first update picks the active one.
		PerBlendData.AddDefaulted(BlendPose.Num());
		PerBlendData[0].Weight = 1.0f;
		for (FPoseLink& Pose : BlendPose)
		{
			Pose.Initialize(Context);
		}
		Reset();
	}
}

void FVgeAnimNode_BlendList::Reset()
{
	SetCurrentBlendProfile(BlendProfile);
	LastActiveChildIndex = INDEX_NONE;
	for (FBlendData& Data : PerBlendData)
	{
		Data.Blend.SetBlendTime(0.0f);
		Data.Blend.SetBlendOption(BlendType);
		Data.Blend.SetCustomCurve(CustomBlendCurve);
		if (CurrentBlendProfile)
		{
			Data.StartAlpha = 0.0f;
		}
	}
	PerBlendData[0].Blend.SetAlpha(1.0f);
	PerBlendData[0].StartAlpha = 1.0f;
}

void FVgeAnimNode_BlendList::SetCurrentBlendProfile(UBlendProfile* NewBlendProfile)
{
	CurrentBlendProfile = NewBlendProfile;
	if (CurrentBlendProfile && PerBoneSampleData.Num() != BlendPose.Num())
	{
		PerBoneSampleData.Empty(BlendPose.Num());
		PerBoneSampleData.AddZeroed(BlendPose.Num());
		for (int32 Index = 0; Index < BlendPose.Num(); ++Index)
		{
			PerBoneSampleData[Index].SampleDataIndex = Index;
			PerBoneSampleData[Index].PerBoneBlendData.AddZeroed(CurrentBlendProfile->GetNumBlendEntries());
		}
	}
}

void FVgeAnimNode_BlendList::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	for (FPoseLink& Pose : BlendPose)
	{
		Pose.CacheBones(Context);
	}
}

void FVgeAnimNode_BlendList::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	GetEvaluateGraphExposedInputs().Execute(Context);

	const int32 NumPoses = BlendPose.Num();
	if (NumPoses == 0 || PerBlendData.Num() != NumPoses)
	{
		return;
	}

	bool bRequestedInertialization = false;
	const int32 ChildIndex = GetActiveChildIndex();
	if (ChildIndex != LastActiveChildIndex)
	{
		SetCurrentBlendProfile(BlendProfile);

		const bool bLastChildIndexIsInvalid = LastActiveChildIndex == INDEX_NONE;
		const float CurrentWeight = PerBlendData[ChildIndex].Weight;
		// Scaled by the weight still to gain: from half weight the blend takes half the time.
		const float WeightDifference = FMath::Clamp(FMath::Abs(1.0f - CurrentWeight), 0.0f, 1.0f);

		float RemainingBlendTime;
		if (bLastChildIndexIsInvalid)
		{
			RemainingBlendTime = 0.0f;
		}
		else if (TransitionType == EBlendListTransitionType::Inertialization)
		{
			if (UE::Anim::IInertializationRequester* Requester = Context.GetMessage<UE::Anim::IInertializationRequester>())
			{
				FInertializationRequest Request;
				Request.Duration = BlendTimeOf(ChildIndex);
				Request.BlendProfile = CurrentBlendProfile;
				Request.bUseBlendMode = true;
				Request.BlendMode = BlendType;
				Request.CustomBlendCurve = CustomBlendCurve;
				Requester->RequestInertialization(Request);
				Requester->AddDebugRecord(*Context.AnimInstanceProxy, Context.GetCurrentNodeId());
				bRequestedInertialization = true;
			}
			else
			{
				UE_LOG(LogVgeAnimNodes, Warning, TEXT("blendList: inertialization requested with no <inertialize> above it; switching at once"));
			}
			RemainingBlendTime = 0.0f;
		}
		else
		{
			RemainingBlendTime = BlendTimeOf(ChildIndex) * WeightDifference;
		}

		for (FBlendData& Data : PerBlendData)
		{
			Data.RemainingTime = RemainingBlendTime;
		}

		// An instant switch still updates the previous pose once, at zero weight.
		if (RemainingBlendTime == 0.0f && !bLastChildIndexIsInvalid)
		{
			BlendPose[LastActiveChildIndex].Update(Context.FractionalWeight(0.0f));
		}

		for (int32 Index = 0; Index < PerBlendData.Num(); ++Index)
		{
			FAlphaBlend& Blend = PerBlendData[Index].Blend;
			Blend.SetBlendTime(RemainingBlendTime);
			if (Index == ChildIndex)
			{
				Blend.SetValueRange(PerBlendData[Index].Weight, 1.0f);
				if (CurrentBlendProfile)
				{
					Blend.ResetAlpha();
				}
			}
			else
			{
				Blend.SetValueRange(PerBlendData[Index].Weight, 0.0f);
			}
			if (CurrentBlendProfile)
			{
				PerBlendData[Index].StartAlpha = Blend.GetAlpha();
			}
		}

		if (ChildUpdateMode == EBlendListChildUpdateMode::ResetChildOnActivate && CurrentWeight <= ZERO_ANIMWEIGHT_THRESH)
		{
			FAnimationInitializeContext ReinitializeContext(Context.AnimInstanceProxy, Context.SharedContext);
			BlendPose[ChildIndex].Initialize(ReinitializeContext);
		}

		LastActiveChildIndex = ChildIndex;
	}

	float SumWeight = 0.0f;
	for (FBlendData& Data : PerBlendData)
	{
		Data.Blend.Update(Context.GetDeltaTime());
		Data.Weight = Data.Blend.GetBlendedValue();
		SumWeight += Data.Weight;
	}
	if (SumWeight > ZERO_ANIMWEIGHT_THRESH && FMath::Abs(SumWeight - 1.0f) > ZERO_ANIMWEIGHT_THRESH)
	{
		for (FBlendData& Data : PerBlendData)
		{
			Data.Weight /= SumWeight;
		}
	}

	for (int32 Index = 0; Index < NumPoses; ++Index)
	{
		const float BlendWeight = PerBlendData[Index].Weight;
		if (BlendWeight > ZERO_ANIMWEIGHT_THRESH || ChildUpdateMode == EBlendListChildUpdateMode::AlwaysTickChildren)
		{
			FAnimationUpdateContext ChildContext = Context.FractionalWeight(BlendWeight > ZERO_ANIMWEIGHT_THRESH ? BlendWeight : FAnimWeight::GetSmallestRelevantWeight());
			UE::Anim::TOptionalScopedGraphMessage<UE::Anim::FAnimInertializationSyncScope> InertializationSync(bRequestedInertialization, ChildContext);
			BlendPose[Index].Update(Index == ChildIndex ? ChildContext : ChildContext.AsInactive());
		}
	}

	if (CurrentBlendProfile)
	{
		for (int32 Index = 0; Index < NumPoses; ++Index)
		{
			FBlendSampleData& PoseSampleData = PerBoneSampleData[Index];
			const FBlendData& Data = PerBlendData[Index];
			PoseSampleData.TotalWeight = Data.Weight;
			const bool bInverse = CurrentBlendProfile->Mode == EBlendProfileMode::WeightFactor ? ChildIndex != Index : false;
			CurrentBlendProfile->UpdateBoneWeights(PoseSampleData, Data.Blend, Data.StartAlpha, Data.Weight, bInverse);
		}
		FBlendSampleData::NormalizeDataWeight(PerBoneSampleData);
	}

	TRACE_ANIM_NODE_VALUE(Context, TEXT("Active Index"), ChildIndex);
	TRACE_ANIM_NODE_VALUE(Context, TEXT("Active Weight"), PerBlendData[ChildIndex].Weight);
}

void FVgeAnimNode_BlendList::Evaluate_AnyThread(FPoseContext& Output)
{
	if (BlendPose.Num() == 0 || PerBlendData.Num() != BlendPose.Num())
	{
		Output.ResetToRefPose();
		return;
	}
	TArray<FPoseLink*, TInlineAllocator<8>> Poses;
	TArray<float, TInlineAllocator<8>> Weights;
	for (int32 Index = 0; Index < BlendPose.Num(); ++Index)
	{
		Poses.Add(&BlendPose[Index]);
		Weights.Add(PerBlendData[Index].Weight);
	}
	EvaluateWeighted(Output, Poses, Weights, CurrentBlendProfile, PerBoneSampleData);
}

void FVgeAnimNode_BlendList::GatherDebugData(FNodeDebugData& DebugData)
{
	const int32 ChildIndex = GetActiveChildIndex();
	FString DebugLine = DebugData.GetNodeName(this);
	DebugLine += FString::Printf(TEXT("(Active: (%i/%i) Weight: %.1f%%)"), ChildIndex + 1, BlendPose.Num(), GetChildWeight(ChildIndex) * 100.f);
	DebugData.AddDebugItem(DebugLine);
	for (int32 Index = 0; Index < BlendPose.Num(); ++Index)
	{
		BlendPose[Index].GatherDebugData(DebugData.BranchFlow(GetChildWeight(Index)));
	}
}

// FVgeAnimCondition

namespace
{
	struct FConditionParser
	{
		const FString& Text;
		int32 Position = 0;
		TArray<FVgeAnimCondition::FToken>& Program;
		FString Error;

		FConditionParser(const FString& InText, TArray<FVgeAnimCondition::FToken>& OutProgram) : Text(InText), Program(OutProgram) {}

		void SkipSpace()
		{
			while (Position < Text.Len() && FChar::IsWhitespace(Text[Position]))
			{
				++Position;
			}
		}

		bool Accept(const TCHAR* Symbol)
		{
			SkipSpace();
			const int32 Length = FCString::Strlen(Symbol);
			if (Text.Mid(Position, Length) == Symbol)
			{
				Position += Length;
				return true;
			}
			return false;
		}

		void Emit(FVgeAnimCondition::EOp Op)
		{
			FVgeAnimCondition::FToken Token;
			Token.Op = Op;
			Program.Add(Token);
		}

		// Precedence climbs: || < && < == != < < <= > >= < + - < * / < unary ! -
		bool ParseOr()
		{
			if (!ParseAnd()) return false;
			while (Accept(TEXT("||")))
			{
				if (!ParseAnd()) return false;
				Emit(FVgeAnimCondition::EOp::Or);
			}
			return true;
		}

		bool ParseAnd()
		{
			if (!ParseEquality()) return false;
			while (Accept(TEXT("&&")))
			{
				if (!ParseEquality()) return false;
				Emit(FVgeAnimCondition::EOp::And);
			}
			return true;
		}

		bool ParseEquality()
		{
			if (!ParseComparison()) return false;
			for (;;)
			{
				FVgeAnimCondition::EOp Op;
				if (Accept(TEXT("=="))) Op = FVgeAnimCondition::EOp::Equal;
				else if (Accept(TEXT("!="))) Op = FVgeAnimCondition::EOp::NotEqual;
				else return true;
				if (!ParseComparison()) return false;
				Emit(Op);
			}
		}

		bool ParseComparison()
		{
			if (!ParseSum()) return false;
			for (;;)
			{
				FVgeAnimCondition::EOp Op;
				if (Accept(TEXT("<="))) Op = FVgeAnimCondition::EOp::LessEqual;
				else if (Accept(TEXT(">="))) Op = FVgeAnimCondition::EOp::GreaterEqual;
				else if (Accept(TEXT("<"))) Op = FVgeAnimCondition::EOp::Less;
				else if (Accept(TEXT(">"))) Op = FVgeAnimCondition::EOp::Greater;
				else return true;
				if (!ParseSum()) return false;
				Emit(Op);
			}
		}

		bool ParseSum()
		{
			if (!ParseProduct()) return false;
			for (;;)
			{
				FVgeAnimCondition::EOp Op;
				if (Accept(TEXT("+"))) Op = FVgeAnimCondition::EOp::Add;
				else if (Accept(TEXT("-"))) Op = FVgeAnimCondition::EOp::Subtract;
				else return true;
				if (!ParseProduct()) return false;
				Emit(Op);
			}
		}

		bool ParseProduct()
		{
			if (!ParseUnary()) return false;
			for (;;)
			{
				FVgeAnimCondition::EOp Op;
				if (Accept(TEXT("*"))) Op = FVgeAnimCondition::EOp::Multiply;
				else if (Accept(TEXT("/"))) Op = FVgeAnimCondition::EOp::Divide;
				else return true;
				if (!ParseUnary()) return false;
				Emit(Op);
			}
		}

		bool ParseUnary()
		{
			SkipSpace();
			if (Position < Text.Len() && Text[Position] == TEXT('!') && !(Position + 1 < Text.Len() && Text[Position + 1] == TEXT('=')))
			{
				++Position;
				if (!ParseUnary()) return false;
				Emit(FVgeAnimCondition::EOp::Not);
				return true;
			}
			if (Accept(TEXT("-")))
			{
				if (!ParseUnary()) return false;
				Emit(FVgeAnimCondition::EOp::Negate);
				return true;
			}
			return ParsePrimary();
		}

		bool ParsePrimary()
		{
			SkipSpace();
			if (Accept(TEXT("(")))
			{
				if (!ParseOr()) return false;
				if (!Accept(TEXT(")")))
				{
					Error = FString::Printf(TEXT("')' expected at %d"), Position);
					return false;
				}
				return true;
			}
			const int32 Start = Position;
			if (Position < Text.Len() && (FChar::IsDigit(Text[Position]) || Text[Position] == TEXT('.')))
			{
				while (Position < Text.Len() && (FChar::IsDigit(Text[Position]) || Text[Position] == TEXT('.')))
				{
					++Position;
				}
				FVgeAnimCondition::FToken Token;
				Token.Op = FVgeAnimCondition::EOp::Number;
				Token.Number = FCString::Atod(*Text.Mid(Start, Position - Start));
				Program.Add(Token);
				return true;
			}
			if (Position < Text.Len() && (FChar::IsAlpha(Text[Position]) || Text[Position] == TEXT('_')))
			{
				while (Position < Text.Len() && (FChar::IsAlnum(Text[Position]) || Text[Position] == TEXT('_') || Text[Position] == TEXT('.')))
				{
					++Position;
				}
				const FString Name = Text.Mid(Start, Position - Start);
				FVgeAnimCondition::FToken Token;
				if (Name == TEXT("true") || Name == TEXT("false"))
				{
					Token.Op = FVgeAnimCondition::EOp::Number;
					Token.Number = Name == TEXT("true") ? 1.0 : 0.0;
				}
				else if (Name == TEXT("timeRemaining"))
				{
					Token.Op = FVgeAnimCondition::EOp::TimeRemaining;
				}
				else if (Name == TEXT("timeElapsed"))
				{
					Token.Op = FVgeAnimCondition::EOp::TimeElapsed;
				}
				else
				{
					Token.Op = FVgeAnimCondition::EOp::Variable;
					Token.Variable = FName(*Name);
				}
				Program.Add(Token);
				return true;
			}
			Error = Position < Text.Len() ? FString::Printf(TEXT("unexpected '%c' at %d"), Text[Position], Position) : TEXT("unexpected end");
			return false;
		}
	};
}

bool FVgeAnimCondition::Compile(const FString& Text, FString& OutError)
{
	Program.Reset();
	if (Text.TrimStartAndEnd().IsEmpty())
	{
		return true;
	}
	FConditionParser Parser(Text, Program);
	if (!Parser.ParseOr())
	{
		OutError = Parser.Error;
		Program.Reset();
		return false;
	}
	Parser.SkipSpace();
	if (Parser.Position != Text.Len())
	{
		OutError = FString::Printf(TEXT("unexpected '%s' at %d"), *Text.Mid(Parser.Position), Parser.Position);
		Program.Reset();
		return false;
	}
	return true;
}

bool FVgeAnimCondition::Evaluate(const TMap<FName, double>& Variables, double TimeRemaining, double TimeElapsed) const
{
	if (Program.Num() == 0)
	{
		return true;
	}
	TArray<double, TInlineAllocator<16>> Stack;
	for (const FToken& Token : Program)
	{
		switch (Token.Op)
		{
		case EOp::Number: Stack.Push(Token.Number); break;
		case EOp::Variable: Stack.Push(Variables.FindRef(Token.Variable)); break;
		case EOp::TimeRemaining: Stack.Push(TimeRemaining); break;
		case EOp::TimeElapsed: Stack.Push(TimeElapsed); break;
		case EOp::Not: Stack.Last() = Stack.Last() == 0.0 ? 1.0 : 0.0; break;
		case EOp::Negate: Stack.Last() = -Stack.Last(); break;
		default:
		{
			const double B = Stack.Pop(EAllowShrinking::No);
			const double A = Stack.Pop(EAllowShrinking::No);
			double Result = 0.0;
			switch (Token.Op)
			{
			case EOp::Multiply: Result = A * B; break;
			case EOp::Divide: Result = B != 0.0 ? A / B : 0.0; break;
			case EOp::Add: Result = A + B; break;
			case EOp::Subtract: Result = A - B; break;
			case EOp::Less: Result = A < B; break;
			case EOp::LessEqual: Result = A <= B; break;
			case EOp::Greater: Result = A > B; break;
			case EOp::GreaterEqual: Result = A >= B; break;
			case EOp::Equal: Result = A == B; break;
			case EOp::NotEqual: Result = A != B; break;
			case EOp::And: Result = A != 0.0 && B != 0.0; break;
			case EOp::Or: Result = A != 0.0 || B != 0.0; break;
			default: break;
			}
			Stack.Push(Result);
			break;
		}
		}
	}
	return Stack.Num() == 1 && Stack[0] != 0.0;
}

// FVgeAnimNode_State

void FVgeAnimNode_State::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);
	Source.Initialize(Context);
}

void FVgeAnimNode_State::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	Source.CacheBones(Context);
}

void FVgeAnimNode_State::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	Source.Update(Context);
}

void FVgeAnimNode_State::Evaluate_AnyThread(FPoseContext& Output)
{
	Source.Evaluate(Output);
}

void FVgeAnimNode_State::GatherDebugData(FNodeDebugData& DebugData)
{
	DebugData.AddDebugItem(FString::Printf(TEXT("%s(%s)"), *DebugData.GetNodeName(this), *Name.ToString()));
	Source.GatherDebugData(DebugData);
}

// FVgeAnimNode_StateMachine

int32 FVgeAnimNode_StateMachine::FindState(FName Name) const
{
	return States.IndexOfByPredicate([Name](const FVgeAnimNode_State* State) { return State->Name == Name; });
}

float FVgeAnimNode_StateMachine::TimeRemainingIn(int32 State) const
{
	// The most relevant animation of the state: its highest weighted asset player (as GetRelevantAnimTimeRemaining).
	const FAnimNode_AssetPlayerRelevancyBase* Relevant = nullptr;
	if (StateAssetPlayers.IsValidIndex(State))
	{
		for (const FAnimNode_AssetPlayerRelevancyBase* Player : StateAssetPlayers[State])
		{
			if (!Relevant || Player->GetCachedBlendWeight() > Relevant->GetCachedBlendWeight())
			{
				Relevant = Player;
			}
		}
	}
	return Relevant ? Relevant->GetCurrentAssetLength() - Relevant->GetCurrentAssetTimePlayRateAdjusted() : MAX_flt;
}

void FVgeAnimNode_StateMachine::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);

	Weights.Init(0.0f, States.Num());
	StartWeights.Init(0.0f, States.Num());
	BlendElapsed = BlendDuration = 0.0f;
	ElapsedTime = 0.0f;
	TransitionCount = 0;
	CurrentState = States.Num() > 0 ? FMath::Max(0, FindState(EntryState)) : INDEX_NONE;
	if (CurrentState != INDEX_NONE)
	{
		Weights[CurrentState] = 1.0f;
		StartWeights[CurrentState] = 1.0f;
		States[CurrentState]->Initialize_AnyThread(Context);
	}
}

void FVgeAnimNode_StateMachine::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	for (FVgeAnimNode_State* State : States)
	{
		State->CacheBones_AnyThread(Context);
	}
}

bool FVgeAnimNode_StateMachine::EnterState(const FAnimationUpdateContext& Context, int32 NewState, const FVgeAnimNode_Transition& Transition)
{
	const bool bAlreadyActive = Weights[NewState] > 0.0f;
	CurrentState = NewState;
	ElapsedTime = 0.0f;
	++TransitionCount;

	// Stale cached weights of the state's players would hold zero-length blends on old values.
	for (FAnimNode_AssetPlayerRelevancyBase* Player : StateAssetPlayers[NewState])
	{
		Player->ClearCachedBlendWeight();
	}

	// A state not still blending out starts from the beginning.
	if (!bAlreadyActive || States[NewState]->bAlwaysResetOnEntry)
	{
		FAnimationInitializeContext InitContext(Context.AnimInstanceProxy, Context.SharedContext);
		States[NewState]->Initialize_AnyThread(InitContext);
		if (Context.AnimInstanceProxy->GetCachedBonesCounter().HasEverBeenUpdated())
		{
			FAnimationCacheBonesContext CacheBonesContext(Context.AnimInstanceProxy);
			States[NewState]->CacheBones_AnyThread(CacheBonesContext);
		}
	}

	bool bInertialization = false;
	if (Transition.Blend == EVgeTransitionBlend::Inertialization)
	{
		if (UE::Anim::IInertializationRequester* Requester = Context.GetMessage<UE::Anim::IInertializationRequester>())
		{
			FInertializationRequest Request;
			Request.Duration = Transition.Duration;
			Request.BlendProfile = Transition.BlendProfile;
			Request.bUseBlendMode = true;
			Request.BlendMode = Transition.BlendType;
			Requester->RequestInertialization(Request);
			Requester->AddDebugRecord(*Context.AnimInstanceProxy, Context.GetCurrentNodeId());
			bInertialization = true;
		}
		else if (!bLoggedMissingInertialization)
		{
			UE_LOG(LogVgeAnimNodes, Warning, TEXT("stateMachine: transition %s -> %s asks for inertialization with no <inertialize> above it; switching at once"), *Transition.From.ToString(), *Transition.To.ToString());
			bLoggedMissingInertialization = true;
		}
	}

	if (Transition.Blend == EVgeTransitionBlend::Inertialization || Transition.Duration <= 0.0f)
	{
		for (int32 Index = 0; Index < Weights.Num(); ++Index)
		{
			Weights[Index] = StartWeights[Index] = Index == NewState ? 1.0f : 0.0f;
		}
		BlendElapsed = BlendDuration = 0.0f;
	}
	else
	{
		// The new state rises from its weight to one, every other falls to zero, from where they are now: an
		// interrupted crossfade goes on smoothly from its current mix.
		StartWeights = Weights;
		BlendElapsed = 0.0f;
		BlendDuration = Transition.Duration;
		BlendType = Transition.BlendType;
	}
	return bInertialization;
}

void FVgeAnimNode_StateMachine::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	GetEvaluateGraphExposedInputs().Execute(Context);
	if (CurrentState == INDEX_NONE || !Variables)
	{
		return;
	}

	ElapsedTime += Context.GetDeltaTime();

	// Transitions out of the current state, in order; a taken transition may lead on to another in the same update.
	static const FName AnyState(TEXT("*"));
	bool bRequestedInertialization = false;
	for (int32 Step = 0; Step < MaxTransitionsPerFrame; ++Step)
	{
		const FVgeAnimNode_Transition* Taken = nullptr;
		int32 Target = INDEX_NONE;
		const FName Current = States[CurrentState]->Name;
		for (const FVgeAnimNode_Transition* Transition : Transitions)
		{
			if (Transition->From != Current && Transition->From != AnyState)
			{
				continue;
			}
			const int32 To = FindState(Transition->To);
			if (To == INDEX_NONE || To == CurrentState)
			{
				continue;
			}
			const double TimeRemaining = Transition->Condition.ReadsTimeRemaining() ? TimeRemainingIn(CurrentState) : 0.0;
			if (Transition->Condition.Evaluate(*Variables, TimeRemaining, ElapsedTime))
			{
				Taken = Transition;
				Target = To;
				break;
			}
		}
		if (!Taken)
		{
			break;
		}
		bRequestedInertialization |= EnterState(Context, Target, *Taken);
	}

	if (BlendDuration > 0.0f)
	{
		BlendElapsed += Context.GetDeltaTime();
		const float Alpha = FAlphaBlend::AlphaToBlendOption(FMath::Clamp(BlendElapsed / BlendDuration, 0.0f, 1.0f), BlendType);
		for (int32 Index = 0; Index < Weights.Num(); ++Index)
		{
			Weights[Index] = Index == CurrentState ? StartWeights[Index] + (1.0f - StartWeights[Index]) * Alpha : StartWeights[Index] * (1.0f - Alpha);
		}
		if (BlendElapsed >= BlendDuration)
		{
			BlendElapsed = BlendDuration = 0.0f;
		}
	}

	for (int32 Index = 0; Index < States.Num(); ++Index)
	{
		if (Weights[Index] > ZERO_ANIMWEIGHT_THRESH)
		{
			FAnimationUpdateContext StateContext = Context.FractionalWeight(Weights[Index]);
			UE::Anim::TOptionalScopedGraphMessage<UE::Anim::FAnimInertializationSyncScope> InertializationSync(bRequestedInertialization && Index == CurrentState, StateContext);
			States[Index]->Update_AnyThread(Index == CurrentState ? StateContext : StateContext.AsInactive());
		}
		else
		{
			Weights[Index] = 0.0f;
		}
	}

	TRACE_ANIM_NODE_VALUE(Context, TEXT("Current State"), GetCurrentStateName());
	TRACE_ANIM_NODE_VALUE(Context, TEXT("Elapsed Time"), ElapsedTime);
}

void FVgeAnimNode_StateMachine::Evaluate_AnyThread(FPoseContext& Output)
{
	if (CurrentState == INDEX_NONE || Weights.Num() != States.Num())
	{
		Output.ResetToRefPose();
		return;
	}
	TArray<FPoseLink*, TInlineAllocator<8>> Poses;
	for (FVgeAnimNode_State* State : States)
	{
		Poses.Add(&State->Source);
	}
	EvaluateWeighted(Output, Poses, Weights, nullptr, {});
}

void FVgeAnimNode_StateMachine::GatherDebugData(FNodeDebugData& DebugData)
{
	DebugData.AddDebugItem(FString::Printf(TEXT("%s(Current: %s for %.2fs)"), *DebugData.GetNodeName(this), *GetCurrentStateName().ToString(), ElapsedTime));
	for (int32 Index = 0; Index < States.Num(); ++Index)
	{
		if (GetStateWeight(Index) > 0.0f)
		{
			States[Index]->GatherDebugData(DebugData.BranchFlow(GetStateWeight(Index)));
		}
	}
}

// FVgeAnimNode_TwoBoneIK

FVgeAnimNode_TwoBoneIK::FVgeAnimNode_TwoBoneIK()
{
	ToLocal.ComponentPose.SetLinkNode(&IK);
	IK.ComponentPose.SetLinkNode(&ToComponent);
}

void FVgeAnimNode_TwoBoneIK::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);
	ToLocal.Initialize_AnyThread(Context);
}

void FVgeAnimNode_TwoBoneIK::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	ToLocal.CacheBones_AnyThread(Context);
}

void FVgeAnimNode_TwoBoneIK::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	ToLocal.Update_AnyThread(Context);
}

void FVgeAnimNode_TwoBoneIK::Evaluate_AnyThread(FPoseContext& Output)
{
	ToLocal.Evaluate_AnyThread(Output);
}

void FVgeAnimNode_TwoBoneIK::GatherDebugData(FNodeDebugData& DebugData)
{
	ToLocal.GatherDebugData(DebugData);
}

bool FVgeAnimNode_SkeletalControl::SetControlStruct(const UScriptStruct* Struct)
{
	if (!Struct || !Struct->IsChildOf(FAnimNode_SkeletalControlBase::StaticStruct()))
	{
		return false;
	}
	if (Control.GetScriptStruct() != Struct)
	{
		Control.InitializeAs(Struct);
	}
	ToLocal.ComponentPose.SetLinkNode(Get());
	Get()->ComponentPose.SetLinkNode(&ToComponent);
	return true;
}

void FVgeAnimNode_SkeletalControl::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);
	if (Get())
	{
		ToLocal.Initialize_AnyThread(Context);
	}
	else
	{
		ToComponent.LocalPose.Initialize(Context);
	}
}

void FVgeAnimNode_SkeletalControl::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	if (Get())
	{
		ToLocal.CacheBones_AnyThread(Context);
	}
	else
	{
		ToComponent.LocalPose.CacheBones(Context);
	}
}

void FVgeAnimNode_SkeletalControl::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	if (Get())
	{
		ToLocal.Update_AnyThread(Context);
	}
	else
	{
		ToComponent.LocalPose.Update(Context);
	}
}

void FVgeAnimNode_SkeletalControl::Evaluate_AnyThread(FPoseContext& Output)
{
	if (Get())
	{
		ToLocal.Evaluate_AnyThread(Output);
	}
	else
	{
		ToComponent.LocalPose.Evaluate(Output);
	}
}

void FVgeAnimNode_SkeletalControl::GatherDebugData(FNodeDebugData& DebugData)
{
	if (Get())
	{
		ToLocal.GatherDebugData(DebugData);
	}
	else
	{
		ToComponent.LocalPose.GatherDebugData(DebugData);
	}
}

bool FVgeAnimNode_SkeletalControl::HasPreUpdate() const
{
	const FAnimNode_SkeletalControlBase* Node = Control.GetPtr<FAnimNode_SkeletalControlBase>();
	return Node && Node->HasPreUpdate();
}

void FVgeAnimNode_SkeletalControl::PreUpdate(const UAnimInstance* InAnimInstance)
{
	if (FAnimNode_SkeletalControlBase* Node = Get())
	{
		Node->PreUpdate(InAnimInstance);
	}
}

void FVgeAnimNode_SkeletalControl::ResetDynamics(ETeleportType InTeleportType)
{
	if (FAnimNode_SkeletalControlBase* Node = Get())
	{
		Node->ResetDynamics(InTeleportType);
	}
}

FVgeAnimNode_AnimDynamics::FVgeAnimNode_AnimDynamics()
{
	ToLocal.ComponentPose.SetLinkNode(&Dynamics);
	Dynamics.ComponentPose.SetLinkNode(&ToComponent);
}

void FVgeAnimNode_AnimDynamics::Initialize_AnyThread(const FAnimationInitializeContext& Context)
{
	FAnimNode_Base::Initialize_AnyThread(Context);
	ToLocal.Initialize_AnyThread(Context);
}

void FVgeAnimNode_AnimDynamics::CacheBones_AnyThread(const FAnimationCacheBonesContext& Context)
{
	ToLocal.CacheBones_AnyThread(Context);
}

void FVgeAnimNode_AnimDynamics::Update_AnyThread(const FAnimationUpdateContext& Context)
{
	ToLocal.Update_AnyThread(Context);
}

void FVgeAnimNode_AnimDynamics::Evaluate_AnyThread(FPoseContext& Output)
{
	ToLocal.Evaluate_AnyThread(Output);
}

void FVgeAnimNode_AnimDynamics::GatherDebugData(FNodeDebugData& DebugData)
{
	ToLocal.GatherDebugData(DebugData);
}
