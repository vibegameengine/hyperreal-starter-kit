#include "VgeAnimInstance.h"

#include "AnimNodes/AnimNode_BlendSpacePlayer.h"
#include "AnimNodes/AnimNode_Slot.h"
#include "AnimNodes/AnimNode_TwoWayBlend.h"
#include "Animation/AnimClassInterface.h"
#include "Animation/AnimNode_SequencePlayer.h"
#include "Animation/AnimSequenceBase.h"
#include "Animation/BlendProfile.h"
#include "Animation/BlendSpace.h"
#include "Components/SkeletalMeshComponent.h"
#include "Curves/CurveFloat.h"
#include "Dom/JsonObject.h"
#include "JsonObjectConverter.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "VgeAnimNodes.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeAnim, Log, All);

namespace
{
	enum class EPropKind : uint8
	{
		None,
		// A number (bools as 0/1), or bound to a variable.
		Number,
		// Numbers, element by element (an array, or a vector of three), each a value or bound to a variable.
		Numbers,
		// An asset or class, by path.
		Object,
		// A name or a keyword.
		Text,
		// Structured data, read by the node type itself.
		Json,
	};

	// One prop write: Number for Number and Numbers (Element is the index for Numbers, INDEX_NONE for a scalar
	// given to a Numbers prop, and Count the length of the array written), Object, Text or Json for the others.
	struct FPropValue
	{
		double Number = 0.0;
		int32 Element = INDEX_NONE;
		int32 Count = 0;
		UObject* Object = nullptr;
		FString Text;
		TSharedPtr<FJsonValue> Json;
	};

	struct FNodeType
	{
		FName Name;
		UScriptStruct* Struct;
		EPropKind (*Kind)(const FString& Prop);
		// Returns true when the write changed which bones the node reads.
		bool (*Write)(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance* LiveOwner);
	};

	template <typename T>
	T* As(FVgeAnimGraphNode& Node)
	{
		return reinterpret_cast<T*>(Node.Node.GetMutableMemory());
	}

	bool IsTrue(const FPropValue& Value) { return Value.Number != 0.0; }
	float AsFloat(const FPropValue& Value) { return static_cast<float>(Value.Number); }

	template <typename T>
	T* CastAsset(const FVgeAnimGraphNode& Node, const FString& Prop, UObject* Object)
	{
		T* Asset = Cast<T>(Object);
		if (Object && !Asset)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: %s is not a %s"), *Node.Type.ToString(), *Node.Id, *Prop, *Object->GetPathName(), *T::StaticClass()->GetName());
		}
		return Asset;
	}

	template <typename TEnum>
	bool ParseEnum(const FVgeAnimGraphNode& Node, const FString& Prop, const FString& Text, TEnum& OutValue)
	{
		const int64 Value = StaticEnum<TEnum>()->GetValueByNameString(Text);
		if (Value == INDEX_NONE)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: '%s' is not one of %s"), *Node.Type.ToString(), *Node.Id, *Prop, *Text, *StaticEnum<TEnum>()->GetName());
			return false;
		}
		OutValue = static_cast<TEnum>(Value);
		return true;
	}

	bool ParseBoneControlSpace(const FVgeAnimGraphNode& Node, const FString& Prop, const FString& Text, TEnumAsByte<EBoneControlSpace>& OutSpace)
	{
		static const TMap<FString, EBoneControlSpace> Spaces = {
			{ TEXT("world"), BCS_WorldSpace }, { TEXT("component"), BCS_ComponentSpace }, { TEXT("parentBone"), BCS_ParentBoneSpace }, { TEXT("bone"), BCS_BoneSpace },
		};
		if (const EBoneControlSpace* Space = Spaces.Find(Text))
		{
			OutSpace = *Space;
			return true;
		}
		UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: '%s' is not world, component, parentBone or bone"), *Node.Type.ToString(), *Node.Id, *Prop, *Text);
		return false;
	}

	// Writes a Numbers prop's element (or every element, for a scalar) into an array sized to the written length.
	void WriteElement(TArray<float>& Array, const FPropValue& Value, float Default)
	{
		if (Value.Element == INDEX_NONE)
		{
			for (float& Each : Array)
			{
				Each = AsFloat(Value);
			}
			if (Array.Num() == 0)
			{
				Array.Add(AsFloat(Value));
			}
			return;
		}
		if (Value.Count > 0 && Array.Num() != Value.Count)
		{
			Array.Init(Default, Value.Count);
		}
		if (Array.IsValidIndex(Value.Element))
		{
			Array[Value.Element] = AsFloat(Value);
		}
	}

	void WriteVectorElement(FVector& Vector, const FPropValue& Value)
	{
		if (Value.Element == INDEX_NONE)
		{
			Vector = FVector(Value.Number);
		}
		else if (Value.Element >= 0 && Value.Element < 3)
		{
			Vector[Value.Element] = Value.Number;
		}
	}

	TArray<FName> NamesOf(const TSharedPtr<FJsonValue>& Json)
	{
		TArray<FName> Names;
		const TArray<TSharedPtr<FJsonValue>>* Array;
		if (Json.IsValid() && Json->Type == EJson::Array && Json->TryGetArray(Array))
		{
			for (const TSharedPtr<FJsonValue>& Each : *Array)
			{
				if (Each->Type == EJson::String)
				{
					Names.Add(FName(*Each->AsString()));
				}
			}
		}
		return Names;
	}

	// clip
	EPropKind ClipKind(const FString& Prop)
	{
		if (Prop == TEXT("sequence")) return EPropKind::Object;
		if (Prop == TEXT("playRate") || Prop == TEXT("loop") || Prop == TEXT("startPosition")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool ClipWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		// Its setters are public here, protected on FAnimNode_SequencePlayerBase.
		FAnimNode_SequencePlayer_Standalone* Clip = As<FAnimNode_SequencePlayer_Standalone>(Node);
		if (Prop == TEXT("sequence")) Clip->SetSequence(CastAsset<UAnimSequenceBase>(Node, Prop, Value.Object));
		else if (Prop == TEXT("playRate")) Clip->SetPlayRate(AsFloat(Value));
		else if (Prop == TEXT("loop")) Clip->SetLoopAnimation(IsTrue(Value));
		else if (Prop == TEXT("startPosition")) Clip->SetStartPosition(AsFloat(Value));
		return false;
	}

	// blendSpace
	EPropKind BlendSpaceKind(const FString& Prop)
	{
		if (Prop == TEXT("blendSpace")) return EPropKind::Object;
		if (Prop == TEXT("x") || Prop == TEXT("y") || Prop == TEXT("playRate") || Prop == TEXT("loop")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool BlendSpaceWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FAnimNode_BlendSpacePlayerBase* Player = As<FAnimNode_BlendSpacePlayer_Standalone>(Node);
		if (Prop == TEXT("blendSpace")) Player->SetBlendSpace(CastAsset<UBlendSpace>(Node, Prop, Value.Object));
		else if (Prop == TEXT("x") || Prop == TEXT("y"))
		{
			FVector Position = Player->GetPosition();
			Position[Prop == TEXT("x") ? 0 : 1] = Value.Number;
			Player->SetPosition(Position);
		}
		else if (Prop == TEXT("playRate")) Player->SetPlayRate(AsFloat(Value));
		else if (Prop == TEXT("loop")) Player->SetLoop(IsTrue(Value));
		return false;
	}

	// blend
	EPropKind BlendKind(const FString& Prop)
	{
		return Prop == TEXT("alpha") ? EPropKind::Number : EPropKind::None;
	}
	bool BlendWrite(FVgeAnimGraphNode& Node, const FString&, const FPropValue& Value, UAnimInstance*)
	{
		As<FAnimNode_TwoWayBlend>(Node)->Alpha = AsFloat(Value);
		return false;
	}

	// blendList
	EPropKind BlendListKind(const FString& Prop)
	{
		if (Prop == TEXT("index") || Prop == TEXT("active")) return EPropKind::Number;
		if (Prop == TEXT("blendTime")) return EPropKind::Numbers;
		if (Prop == TEXT("transition") || Prop == TEXT("blendType") || Prop == TEXT("childUpdate")) return EPropKind::Text;
		if (Prop == TEXT("blendProfile") || Prop == TEXT("customCurve")) return EPropKind::Object;
		return EPropKind::None;
	}
	bool BlendListWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_BlendList* List = As<FVgeAnimNode_BlendList>(Node);
		if (Prop == TEXT("index")) List->ActiveIndex = FMath::RoundToInt(Value.Number);
		// By bool: true plays the first pose, false the second (FAnimNode_BlendListByBool).
		else if (Prop == TEXT("active")) List->ActiveIndex = IsTrue(Value) ? 0 : 1;
		else if (Prop == TEXT("blendTime")) WriteElement(List->BlendTime, Value, 0.1f);
		else if (Prop == TEXT("transition"))
		{
			if (Value.Text == TEXT("inertialization")) List->TransitionType = EBlendListTransitionType::Inertialization;
			else if (Value.Text == TEXT("blend")) List->TransitionType = EBlendListTransitionType::StandardBlend;
			else UE_LOG(LogVgeAnim, Error, TEXT("blendList#%s.transition: '%s' is not blend or inertialization"), *Node.Id, *Value.Text);
		}
		else if (Prop == TEXT("blendType")) ParseEnum(Node, Prop, Value.Text, List->BlendType);
		else if (Prop == TEXT("childUpdate"))
		{
			if (Value.Text == TEXT("default")) List->ChildUpdateMode = EBlendListChildUpdateMode::Default;
			else if (Value.Text == TEXT("reset")) List->ChildUpdateMode = EBlendListChildUpdateMode::ResetChildOnActivate;
			else if (Value.Text == TEXT("always")) List->ChildUpdateMode = EBlendListChildUpdateMode::AlwaysTickChildren;
			else UE_LOG(LogVgeAnim, Error, TEXT("blendList#%s.childUpdate: '%s' is not default, reset or always"), *Node.Id, *Value.Text);
		}
		else if (Prop == TEXT("blendProfile")) List->BlendProfile = CastAsset<UBlendProfile>(Node, Prop, Value.Object);
		else if (Prop == TEXT("customCurve")) List->CustomBlendCurve = CastAsset<UCurveFloat>(Node, Prop, Value.Object);
		return false;
	}

	// linkedGraph
	EPropKind LinkedGraphKind(const FString& Prop)
	{
		return Prop == TEXT("instanceClass") ? EPropKind::Object : EPropKind::None;
	}
	bool LinkedGraphWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance* LiveOwner)
	{
		FVgeAnimNode_LinkedAnimGraph* Linked = As<FVgeAnimNode_LinkedAnimGraph>(Node);
		UClass* Class = CastAsset<UClass>(Node, Prop, Value.Object);
		// FAnimNode_LinkedAnimGraph::SetAnimClass takes Animation Blueprint classes only.
		if (Class && (!Class->IsChildOf(UAnimInstance::StaticClass()) || !IAnimClassInterface::GetFromClass(Class)))
		{
			UE_LOG(LogVgeAnim, Error, TEXT("linkedGraph#%s: %s is not an Animation Blueprint class"), *Node.Id, *Class->GetPathName());
			Class = nullptr;
		}
		if (LiveOwner)
		{
			Linked->SetAnimClass(Class, LiveOwner);
		}
		else
		{
			Linked->InstanceClass = Class;
		}
		return false;
	}

	// inertialize
	EPropKind InertializeKind(const FString& Prop)
	{
		if (Prop == TEXT("defaultBlendProfile")) return EPropKind::Object;
		if (Prop == TEXT("filteredCurves") || Prop == TEXT("filteredBones")) return EPropKind::Json;
		if (Prop == TEXT("resetOnBecomingRelevant") || Prop == TEXT("springDamping")) return EPropKind::Number;
		if (Prop == TEXT("tag")) return EPropKind::Text;
		return EPropKind::None;
	}
	bool InertializeWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_Inertialization* Inertialization = As<FVgeAnimNode_Inertialization>(Node);
		if (Prop == TEXT("defaultBlendProfile")) Inertialization->DefaultBlendProfile = CastAsset<UBlendProfile>(Node, Prop, Value.Object);
		else if (Prop == TEXT("filteredCurves")) Inertialization->FilteredCurves = NamesOf(Value.Json);
		else if (Prop == TEXT("filteredBones"))
		{
			Inertialization->FilteredBones.Reset();
			for (FName Bone : NamesOf(Value.Json))
			{
				Inertialization->FilteredBones.Add(FBoneReference(Bone));
			}
			return true;
		}
		else if (Prop == TEXT("resetOnBecomingRelevant")) Inertialization->bResetOnBecomingRelevant = IsTrue(Value);
		else if (Prop == TEXT("tag")) Inertialization->Tag = FName(*Value.Text);
		else if (Prop == TEXT("springDamping")) Inertialization->SpringDamping = AsFloat(Value);
		return false;
	}

	// stateMachine
	EPropKind StateMachineKind(const FString& Prop)
	{
		if (Prop == TEXT("entry")) return EPropKind::Text;
		if (Prop == TEXT("maxTransitionsPerFrame")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool StateMachineWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_StateMachine* Machine = As<FVgeAnimNode_StateMachine>(Node);
		if (Prop == TEXT("entry")) Machine->EntryState = FName(*Value.Text);
		else if (Prop == TEXT("maxTransitionsPerFrame")) Machine->MaxTransitionsPerFrame = FMath::Max(1, FMath::RoundToInt(Value.Number));
		return false;
	}

	// state
	EPropKind StateKind(const FString& Prop)
	{
		if (Prop == TEXT("name")) return EPropKind::Text;
		if (Prop == TEXT("alwaysResetOnEntry")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool StateWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_State* State = As<FVgeAnimNode_State>(Node);
		if (Prop == TEXT("name")) State->Name = FName(*Value.Text);
		else if (Prop == TEXT("alwaysResetOnEntry")) State->bAlwaysResetOnEntry = IsTrue(Value);
		return false;
	}

	// transition
	EPropKind TransitionKind(const FString& Prop)
	{
		if (Prop == TEXT("from") || Prop == TEXT("to") || Prop == TEXT("when") || Prop == TEXT("blend") || Prop == TEXT("blendType")) return EPropKind::Text;
		if (Prop == TEXT("duration")) return EPropKind::Number;
		if (Prop == TEXT("blendProfile")) return EPropKind::Object;
		return EPropKind::None;
	}
	bool TransitionWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_Transition* Transition = As<FVgeAnimNode_Transition>(Node);
		if (Prop == TEXT("from")) Transition->From = FName(*Value.Text);
		else if (Prop == TEXT("to")) Transition->To = FName(*Value.Text);
		else if (Prop == TEXT("when"))
		{
			FString Error;
			if (Transition->Condition.Compile(Value.Text, Error))
			{
				Transition->ConditionText = Value.Text;
			}
			else
			{
				UE_LOG(LogVgeAnim, Error, TEXT("transition#%s.when: \"%s\": %s"), *Node.Id, *Value.Text, *Error);
			}
		}
		else if (Prop == TEXT("blend"))
		{
			if (Value.Text == TEXT("inertialization")) Transition->Blend = EVgeTransitionBlend::Inertialization;
			else if (Value.Text == TEXT("crossfade")) Transition->Blend = EVgeTransitionBlend::Crossfade;
			else UE_LOG(LogVgeAnim, Error, TEXT("transition#%s.blend: '%s' is not crossfade or inertialization"), *Node.Id, *Value.Text);
		}
		else if (Prop == TEXT("blendType")) ParseEnum(Node, Prop, Value.Text, Transition->BlendType);
		else if (Prop == TEXT("duration")) Transition->Duration = FMath::Max(0.0f, AsFloat(Value));
		else if (Prop == TEXT("blendProfile")) Transition->BlendProfile = CastAsset<UBlendProfile>(Node, Prop, Value.Object);
		return false;
	}

	// layered
	EPropKind LayeredKind(const FString& Prop)
	{
		if (Prop == TEXT("layers")) return EPropKind::Json;
		if (Prop == TEXT("weights")) return EPropKind::Numbers;
		if (Prop == TEXT("meshSpaceRotationBlend") || Prop == TEXT("rootSpaceRotationBlend") || Prop == TEXT("meshSpaceScaleBlend")) return EPropKind::Number;
		if (Prop == TEXT("curveBlend")) return EPropKind::Text;
		return EPropKind::None;
	}
	bool LayeredWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_LayeredBoneBlend* Layered = As<FVgeAnimNode_LayeredBoneBlend>(Node);
		if (Prop == TEXT("layers"))
		{
			// Per layer, a branch {bone, depth} or a list of them (FInputBlendPose::BranchFilters).
			const TArray<TSharedPtr<FJsonValue>>* Layers;
			if (!Value.Json.IsValid() || Value.Json->Type != EJson::Array || !Value.Json->TryGetArray(Layers))
			{
				UE_LOG(LogVgeAnim, Error, TEXT("layered#%s.layers: expects an array"), *Node.Id);
				return false;
			}
			Layered->LayerSetup.SetNum(Layers->Num());
			for (int32 Layer = 0; Layer < Layers->Num(); ++Layer)
			{
				TArray<TSharedPtr<FJsonValue>> Branches;
				const TArray<TSharedPtr<FJsonValue>>* List;
				if ((*Layers)[Layer]->Type == EJson::Array && (*Layers)[Layer]->TryGetArray(List))
				{
					Branches = *List;
				}
				else
				{
					Branches.Add((*Layers)[Layer]);
				}
				TArray<FBranchFilter>& Filters = Layered->LayerSetup[Layer].BranchFilters;
				Filters.Reset();
				for (const TSharedPtr<FJsonValue>& Branch : Branches)
				{
					const TSharedPtr<FJsonObject>* Object;
					if (Branch->Type == EJson::Object && Branch->TryGetObject(Object))
					{
						FBranchFilter& Filter = Filters.AddDefaulted_GetRef();
						FString Bone;
						(*Object)->TryGetStringField(TEXT("bone"), Bone);
						Filter.BoneName = FName(*Bone);
						int32 Depth = 0;
						(*Object)->TryGetNumberField(TEXT("depth"), Depth);
						Filter.BlendDepth = Depth;
					}
				}
			}
			Layered->InvalidatePerBoneWeights();
			return true;
		}
		if (Prop == TEXT("weights")) WriteElement(Layered->BlendWeights, Value, 1.0f);
		else if (Prop == TEXT("meshSpaceRotationBlend")) Layered->bMeshSpaceRotationBlend = IsTrue(Value);
		else if (Prop == TEXT("rootSpaceRotationBlend")) Layered->bRootSpaceRotationBlend = IsTrue(Value);
		else if (Prop == TEXT("meshSpaceScaleBlend")) Layered->bMeshSpaceScaleBlend = IsTrue(Value);
		else if (Prop == TEXT("curveBlend"))
		{
			const int64 Option = StaticEnum<ECurveBlendOption::Type>()->GetValueByNameString(Value.Text);
			if (Option != INDEX_NONE)
			{
				Layered->CurveBlendOption = static_cast<ECurveBlendOption::Type>(Option);
			}
			else
			{
				UE_LOG(LogVgeAnim, Error, TEXT("layered#%s.curveBlend: '%s' is not a curve blend option"), *Node.Id, *Value.Text);
			}
		}
		return false;
	}

	// slot
	EPropKind SlotKind(const FString& Prop)
	{
		if (Prop == TEXT("name")) return EPropKind::Text;
		if (Prop == TEXT("alwaysUpdateSource")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool SlotWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FAnimNode_Slot* Slot = As<FAnimNode_Slot>(Node);
		if (Prop == TEXT("name"))
		{
			Slot->SlotName = FName(*Value.Text);
			// The slot registers its name with the instance when it initializes.
			return true;
		}
		if (Prop == TEXT("alwaysUpdateSource")) Slot->bAlwaysUpdateSourcePose = IsTrue(Value);
		return false;
	}

	// twoBoneIK
	EPropKind TwoBoneIKKind(const FString& Prop)
	{
		if (Prop == TEXT("ikBone") || Prop == TEXT("effectorSpace") || Prop == TEXT("effectorBone") || Prop == TEXT("jointTargetSpace") || Prop == TEXT("jointTargetBone")) return EPropKind::Text;
		if (Prop == TEXT("effectorLocation") || Prop == TEXT("jointTargetLocation")) return EPropKind::Numbers;
		if (Prop == TEXT("alpha") || Prop == TEXT("allowStretching") || Prop == TEXT("startStretchRatio") || Prop == TEXT("maxStretchScale") ||
			Prop == TEXT("takeRotationFromEffectorSpace") || Prop == TEXT("maintainEffectorRelRot") || Prop == TEXT("allowTwist")) return EPropKind::Number;
		return EPropKind::None;
	}
	bool TwoBoneIKWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FAnimNode_TwoBoneIK& IK = As<FVgeAnimNode_TwoBoneIK>(Node)->IK;
		if (Prop == TEXT("ikBone")) { IK.IKBone = FBoneReference(FName(*Value.Text)); return true; }
		if (Prop == TEXT("effectorBone")) { IK.EffectorTarget = FBoneSocketTarget(FName(*Value.Text)); return true; }
		if (Prop == TEXT("jointTargetBone")) { IK.JointTarget = FBoneSocketTarget(FName(*Value.Text)); return true; }
		if (Prop == TEXT("effectorSpace")) ParseBoneControlSpace(Node, Prop, Value.Text, IK.EffectorLocationSpace);
		else if (Prop == TEXT("jointTargetSpace")) ParseBoneControlSpace(Node, Prop, Value.Text, IK.JointTargetLocationSpace);
		else if (Prop == TEXT("effectorLocation")) WriteVectorElement(IK.EffectorLocation, Value);
		else if (Prop == TEXT("jointTargetLocation")) WriteVectorElement(IK.JointTargetLocation, Value);
		else if (Prop == TEXT("alpha")) IK.Alpha = AsFloat(Value);
		else if (Prop == TEXT("allowStretching")) IK.bAllowStretching = IsTrue(Value);
		else if (Prop == TEXT("startStretchRatio")) IK.StartStretchRatio = Value.Number;
		else if (Prop == TEXT("maxStretchScale")) IK.MaxStretchScale = Value.Number;
		else if (Prop == TEXT("takeRotationFromEffectorSpace")) IK.bTakeRotationFromEffectorSpace = IsTrue(Value);
		else if (Prop == TEXT("maintainEffectorRelRot")) IK.bMaintainEffectorRelRot = IsTrue(Value);
		else if (Prop == TEXT("allowTwist")) IK.bAllowTwist = IsTrue(Value);
		return false;
	}

	// control
	EPropKind ControlKind(const FString& Prop)
	{
		return Prop == TEXT("node") ? EPropKind::Text : EPropKind::Json;
	}
	bool ControlWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FVgeAnimNode_SkeletalControl* Control = As<FVgeAnimNode_SkeletalControl>(Node);
		if (Prop == TEXT("node"))
		{
			const UScriptStruct* Struct = LoadObject<UScriptStruct>(nullptr, *Value.Text);
			if (!Control->SetControlStruct(Struct))
			{
				UE_LOG(LogVgeAnim, Error, TEXT("control#%s.node: '%s' is not a skeletal control node struct"), *Node.Id, *Value.Text);
			}
			return true;
		}
		FAnimNode_SkeletalControlBase* Target = Control->Get();
		const UScriptStruct* Struct = Control->Control.GetScriptStruct();
		const FProperty* Property = Struct ? Struct->FindPropertyByName(FName(*Prop)) : nullptr;
		if (!Target || !Property)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("control#%s: %s has no field '%s'"), *Node.Id, Struct ? *Struct->GetName() : TEXT("no node"), *Prop);
			return false;
		}
		void* Address = Property->ContainerPtrToValuePtr<void>(Target);
		if (Value.Json.IsValid())
		{
			if (!FJsonObjectConverter::JsonValueToUProperty(Value.Json, const_cast<FProperty*>(Property), Address, 0, 0))
			{
				UE_LOG(LogVgeAnim, Error, TEXT("control#%s.%s: the value does not fit %s"), *Node.Id, *Prop, *Property->GetCPPType());
			}
			return true;
		}
		if (const FNumericProperty* Numeric = CastField<FNumericProperty>(Property))
		{
			if (Numeric->IsFloatingPoint())
			{
				Numeric->SetFloatingPointPropertyValue(Address, Value.Number);
			}
			else
			{
				Numeric->SetIntPropertyValue(Address, static_cast<int64>(Value.Number));
			}
		}
		else if (const FBoolProperty* Bool = CastField<FBoolProperty>(Property))
		{
			Bool->SetPropertyValue(Address, Value.Number != 0.0);
		}
		return false;
	}

	void ReadVector(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, FVector& OutVector)
	{
		const TArray<TSharedPtr<FJsonValue>>* Elements;
		if (Object->TryGetArrayField(Field, Elements) && Elements->Num() == 3)
		{
			for (int32 Axis = 0; Axis < 3; ++Axis)
			{
				OutVector[Axis] = (*Elements)[Axis]->AsNumber();
			}
		}
	}

	template <typename TEnum>
	void ReadEnum(const FVgeAnimGraphNode& Node, const FString& Prop, const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, TEnum& OutValue)
	{
		FString Text;
		if (Object->TryGetStringField(Field, Text))
		{
			ParseEnum(Node, Prop + TEXT(".") + Field, Text, OutValue);
		}
	}

	template <typename TNumber>
	void ReadNumber(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, TNumber& OutValue)
	{
		double Number;
		if (Object->TryGetNumberField(Field, Number))
		{
			OutValue = static_cast<TNumber>(Number);
		}
	}

	TArray<TSharedPtr<FJsonObject>> ObjectsOf(const FVgeAnimGraphNode& Node, const FString& Prop, const TSharedPtr<FJsonValue>& Json)
	{
		TArray<TSharedPtr<FJsonObject>> Objects;
		const TArray<TSharedPtr<FJsonValue>>* Array;
		if (!Json.IsValid() || Json->Type != EJson::Array || !Json->TryGetArray(Array))
		{
			UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: expects an array of objects"), *Node.Type.ToString(), *Node.Id, *Prop);
			return Objects;
		}
		for (const TSharedPtr<FJsonValue>& Each : *Array)
		{
			const TSharedPtr<FJsonObject>* Object;
			if (Each->Type == EJson::Object && Each->TryGetObject(Object))
			{
				Objects.Add(*Object);
			}
		}
		return Objects;
	}

	FAnimPhysConstraintSetup ConstraintSetupOf(const FVgeAnimGraphNode& Node, const FString& Prop, const TSharedPtr<FJsonObject>& Object)
	{
		FAnimPhysConstraintSetup Setup;
		ReadEnum(Node, Prop, Object, TEXT("linearXLimitType"), Setup.LinearXLimitType);
		ReadEnum(Node, Prop, Object, TEXT("linearYLimitType"), Setup.LinearYLimitType);
		ReadEnum(Node, Prop, Object, TEXT("linearZLimitType"), Setup.LinearZLimitType);
		ReadVector(Object, TEXT("linearAxesMin"), Setup.LinearAxesMin);
		ReadVector(Object, TEXT("linearAxesMax"), Setup.LinearAxesMax);
		ReadEnum(Node, Prop, Object, TEXT("angularConstraintType"), Setup.AngularConstraintType);
		ReadEnum(Node, Prop, Object, TEXT("twistAxis"), Setup.TwistAxis);
		ReadEnum(Node, Prop, Object, TEXT("angularTargetAxis"), Setup.AngularTargetAxis);
		ReadNumber(Object, TEXT("coneAngle"), Setup.ConeAngle);
		ReadVector(Object, TEXT("angularLimitsMin"), Setup.AngularLimitsMin);
		ReadVector(Object, TEXT("angularLimitsMax"), Setup.AngularLimitsMax);
		ReadVector(Object, TEXT("angularTarget"), Setup.AngularTarget);
		return Setup;
	}

	FAnimPhysBodyDefinition BodyDefinitionOf(const FVgeAnimGraphNode& Node, const FString& Prop, const TSharedPtr<FJsonObject>& Object)
	{
		FAnimPhysBodyDefinition Body;
		FString Bone;
		if (Object->TryGetStringField(TEXT("boundBone"), Bone))
		{
			Body.BoundBone = FBoneReference(FName(*Bone));
		}
		ReadVector(Object, TEXT("boxExtents"), Body.BoxExtents);
		ReadVector(Object, TEXT("localJointOffset"), Body.LocalJointOffset);
		ReadEnum(Node, Prop, Object, TEXT("collisionType"), Body.CollisionType);
		ReadNumber(Object, TEXT("sphereCollisionRadius"), Body.SphereCollisionRadius);
		const TSharedPtr<FJsonObject>* Setup;
		if (Object->TryGetObjectField(TEXT("constraintSetup"), Setup))
		{
			Body.ConstraintSetup = ConstraintSetupOf(Node, Prop, *Setup);
		}
		return Body;
	}

	FAnimPhysSphericalLimit SphericalLimitOf(const FVgeAnimGraphNode& Node, const FString& Prop, const TSharedPtr<FJsonObject>& Object)
	{
		FAnimPhysSphericalLimit Limit;
		FString Bone;
		if (Object->TryGetStringField(TEXT("drivingBone"), Bone))
		{
			Limit.DrivingBone = FBoneReference(FName(*Bone));
		}
		ReadVector(Object, TEXT("sphereLocalOffset"), Limit.SphereLocalOffset);
		ReadNumber(Object, TEXT("limitRadius"), Limit.LimitRadius);
		ReadEnum(Node, Prop, Object, TEXT("limitType"), Limit.LimitType);
		return Limit;
	}

	FAnimPhysPlanarLimit PlanarLimitOf(const TSharedPtr<FJsonObject>& Object)
	{
		FAnimPhysPlanarLimit Limit;
		FString Bone;
		if (Object->TryGetStringField(TEXT("drivingBone"), Bone))
		{
			Limit.DrivingBone = FBoneReference(FName(*Bone));
		}
		const TSharedPtr<FJsonObject>* Plane;
		if (Object->TryGetObjectField(TEXT("planeTransform"), Plane))
		{
			FVector Translation = FVector::ZeroVector;
			FVector PitchYawRoll = FVector::ZeroVector;
			ReadVector(*Plane, TEXT("translation"), Translation);
			ReadVector(*Plane, TEXT("rotation"), PitchYawRoll);
			Limit.PlaneTransform = FTransform(FRotator(PitchYawRoll.X, PitchYawRoll.Y, PitchYawRoll.Z), Translation);
		}
		return Limit;
	}

	// animDynamics
	EPropKind AnimDynamicsKind(const FString& Prop)
	{
		static const TSet<FString> Texts = { TEXT("boundBone"), TEXT("chainEnd"), TEXT("relativeSpaceBone"), TEXT("simulationSpace") };
		static const TSet<FString> Vectors = { TEXT("gravityOverride"), TEXT("componentLinearAccScale"), TEXT("componentLinearVelScale"), TEXT("componentAppliedLinearAccClamp"), TEXT("externalForce") };
		static const TSet<FString> Structures = { TEXT("physicsBodyDefinitions"), TEXT("simSpaceSettings"), TEXT("sphericalLimits"), TEXT("planarLimits") };
		static const TSet<FString> Numbers = {
			TEXT("alpha"), TEXT("chain"), TEXT("gravityScale"), TEXT("useGravityOverride"), TEXT("gravityOverrideInSimSpace"), TEXT("linearSpring"),
			TEXT("linearSpringConstant"), TEXT("angularSpring"), TEXT("angularSpringConstant"), TEXT("overrideLinearDamping"), TEXT("linearDampingOverride"),
			TEXT("overrideAngularDamping"), TEXT("angularDampingOverride"), TEXT("overrideAngularBias"), TEXT("angularBiasOverride"),
			TEXT("worldSpaceMinimumScale"), TEXT("windScale"), TEXT("enableWind"), TEXT("numSolverIterationsPreUpdate"), TEXT("numSolverIterationsPostUpdate"),
			TEXT("useSphericalLimits"), TEXT("usePlanarLimit"), TEXT("doUpdate"), TEXT("doEval"),
		};
		if (Texts.Contains(Prop)) return EPropKind::Text;
		if (Vectors.Contains(Prop)) return EPropKind::Numbers;
		if (Structures.Contains(Prop)) return EPropKind::Json;
		if (Numbers.Contains(Prop)) return EPropKind::Number;
		return EPropKind::None;
	}
	bool AnimDynamicsWriteSetup(FVgeAnimGraphNode& Node, FAnimNode_AnimDynamics& Dynamics, const FString& Prop, const FPropValue& Value)
	{
		if (Prop == TEXT("boundBone")) Dynamics.BoundBone = FBoneReference(FName(*Value.Text));
		else if (Prop == TEXT("chainEnd")) Dynamics.ChainEnd = FBoneReference(FName(*Value.Text));
		else if (Prop == TEXT("relativeSpaceBone")) Dynamics.RelativeSpaceBone = FBoneReference(FName(*Value.Text));
		else if (Prop == TEXT("chain")) Dynamics.bChain = IsTrue(Value);
		else if (Prop == TEXT("physicsBodyDefinitions"))
		{
			TArray<FAnimPhysBodyDefinition> Bodies;
			for (const TSharedPtr<FJsonObject>& Object : ObjectsOf(Node, Prop, Value.Json))
			{
				Bodies.Add(BodyDefinitionOf(Node, Prop, Object));
			}
			if (Bodies.IsEmpty())
			{
				Bodies.AddDefaulted();
			}
			Dynamics.PhysicsBodyDefinitions = MoveTemp(Bodies);
		}
		else if (Prop == TEXT("sphericalLimits"))
		{
			Dynamics.SphericalLimits.Reset();
			for (const TSharedPtr<FJsonObject>& Object : ObjectsOf(Node, Prop, Value.Json))
			{
				Dynamics.SphericalLimits.Add(SphericalLimitOf(Node, Prop, Object));
			}
		}
		else if (Prop == TEXT("planarLimits"))
		{
			Dynamics.PlanarLimits.Reset();
			for (const TSharedPtr<FJsonObject>& Object : ObjectsOf(Node, Prop, Value.Json))
			{
				Dynamics.PlanarLimits.Add(PlanarLimitOf(Object));
			}
		}
		else return false;
		Dynamics.RequestInitialise(ETeleportType::ResetPhysics);
		return true;
	}
	bool AnimDynamicsWriteInitialState(FAnimNode_AnimDynamics& Dynamics, const FString& Prop, const FPropValue& Value)
	{
		if (Prop == TEXT("overrideLinearDamping")) Dynamics.bOverrideLinearDamping = IsTrue(Value);
		else if (Prop == TEXT("linearDampingOverride")) Dynamics.LinearDampingOverride = AsFloat(Value);
		else if (Prop == TEXT("overrideAngularDamping")) Dynamics.bOverrideAngularDamping = IsTrue(Value);
		else if (Prop == TEXT("angularDampingOverride")) Dynamics.AngularDampingOverride = AsFloat(Value);
		else if (Prop == TEXT("useGravityOverride")) Dynamics.bUseGravityOverride = IsTrue(Value);
		else if (Prop == TEXT("gravityOverrideInSimSpace")) Dynamics.bGravityOverrideInSimSpace = IsTrue(Value);
		else return false;
		Dynamics.RequestInitialise(ETeleportType::ResetPhysics);
		return true;
	}
	bool AnimDynamicsWrite(FVgeAnimGraphNode& Node, const FString& Prop, const FPropValue& Value, UAnimInstance*)
	{
		FAnimNode_AnimDynamics& Dynamics = As<FVgeAnimNode_AnimDynamics>(Node)->Dynamics;
		if (AnimDynamicsWriteSetup(Node, Dynamics, Prop, Value)) return true;
		if (AnimDynamicsWriteInitialState(Dynamics, Prop, Value)) return false;
		if (Prop == TEXT("simulationSpace"))
		{
			ParseEnum(Node, Prop, Value.Text, Dynamics.SimulationSpace);
			return true;
		}
		if (Prop == TEXT("simSpaceSettings"))
		{
			const TSharedPtr<FJsonObject>* Object;
			if (Value.Json.IsValid() && Value.Json->TryGetObject(Object))
			{
				ReadNumber(*Object, TEXT("simSpaceAngularAlpha"), Dynamics.SimSpaceSettings.SimSpaceAngularAlpha);
				ReadNumber(*Object, TEXT("maxAngularVelocity"), Dynamics.SimSpaceSettings.MaxAngularVelocity);
				ReadNumber(*Object, TEXT("maxAngularAcceleration"), Dynamics.SimSpaceSettings.MaxAngularAcceleration);
				ReadVector(*Object, TEXT("externalAngularVelocity"), Dynamics.SimSpaceSettings.ExternalAngularVelocity);
			}
		}
		else if (Prop == TEXT("gravityOverride")) WriteVectorElement(Dynamics.GravityOverride, Value);
		else if (Prop == TEXT("componentLinearAccScale")) WriteVectorElement(Dynamics.ComponentLinearAccScale, Value);
		else if (Prop == TEXT("componentLinearVelScale")) WriteVectorElement(Dynamics.ComponentLinearVelScale, Value);
		else if (Prop == TEXT("componentAppliedLinearAccClamp")) WriteVectorElement(Dynamics.ComponentAppliedLinearAccClamp, Value);
		else if (Prop == TEXT("externalForce")) WriteVectorElement(Dynamics.ExternalForce, Value);
		else if (Prop == TEXT("alpha")) Dynamics.Alpha = AsFloat(Value);
		else if (Prop == TEXT("gravityScale")) Dynamics.GravityScale = AsFloat(Value);
		else if (Prop == TEXT("linearSpring")) Dynamics.bLinearSpring = IsTrue(Value);
		else if (Prop == TEXT("linearSpringConstant")) Dynamics.LinearSpringConstant = AsFloat(Value);
		else if (Prop == TEXT("angularSpring")) Dynamics.bAngularSpring = IsTrue(Value);
		else if (Prop == TEXT("angularSpringConstant")) Dynamics.AngularSpringConstant = AsFloat(Value);
		else if (Prop == TEXT("overrideAngularBias")) Dynamics.bOverrideAngularBias = IsTrue(Value);
		else if (Prop == TEXT("angularBiasOverride")) Dynamics.AngularBiasOverride = AsFloat(Value);
		else if (Prop == TEXT("worldSpaceMinimumScale")) Dynamics.WorldSpaceMinimumScale = AsFloat(Value);
		else if (Prop == TEXT("windScale")) Dynamics.WindScale = AsFloat(Value);
		else if (Prop == TEXT("enableWind")) Dynamics.bEnableWind = IsTrue(Value);
		else if (Prop == TEXT("numSolverIterationsPreUpdate")) Dynamics.NumSolverIterationsPreUpdate = FMath::Max(1, FMath::RoundToInt(Value.Number));
		else if (Prop == TEXT("numSolverIterationsPostUpdate")) Dynamics.NumSolverIterationsPostUpdate = FMath::Max(1, FMath::RoundToInt(Value.Number));
		else if (Prop == TEXT("useSphericalLimits")) Dynamics.bUseSphericalLimits = IsTrue(Value);
		else if (Prop == TEXT("usePlanarLimit")) Dynamics.bUsePlanarLimit = IsTrue(Value);
		else if (Prop == TEXT("doUpdate")) Dynamics.bDoUpdate = IsTrue(Value);
		else if (Prop == TEXT("doEval")) Dynamics.bDoEval = IsTrue(Value);
		return false;
	}

	const FName NodeType_Clip(TEXT("clip"));
	const FName NodeType_BlendSpace(TEXT("blendSpace"));
	const FName NodeType_Blend(TEXT("blend"));
	const FName NodeType_BlendList(TEXT("blendList"));
	const FName NodeType_LinkedGraph(TEXT("linkedGraph"));
	const FName NodeType_Inertialize(TEXT("inertialize"));
	const FName NodeType_StateMachine(TEXT("stateMachine"));
	const FName NodeType_State(TEXT("state"));
	const FName NodeType_Transition(TEXT("transition"));
	const FName NodeType_Layered(TEXT("layered"));
	const FName NodeType_Slot(TEXT("slot"));
	const FName NodeType_TwoBoneIK(TEXT("twoBoneIK"));
	const FName NodeType_AnimDynamics(TEXT("animDynamics"));
	const FName NodeType_Control(TEXT("control"));

	const TArray<FNodeType>& NodeTypes()
	{
		static const TArray<FNodeType> Types = {
			{ NodeType_Clip, FAnimNode_SequencePlayer_Standalone::StaticStruct(), ClipKind, ClipWrite },
			{ NodeType_BlendSpace, FAnimNode_BlendSpacePlayer_Standalone::StaticStruct(), BlendSpaceKind, BlendSpaceWrite },
			{ NodeType_Blend, FAnimNode_TwoWayBlend::StaticStruct(), BlendKind, BlendWrite },
			{ NodeType_BlendList, FVgeAnimNode_BlendList::StaticStruct(), BlendListKind, BlendListWrite },
			{ NodeType_LinkedGraph, FVgeAnimNode_LinkedAnimGraph::StaticStruct(), LinkedGraphKind, LinkedGraphWrite },
			{ NodeType_Inertialize, FVgeAnimNode_Inertialization::StaticStruct(), InertializeKind, InertializeWrite },
			{ NodeType_StateMachine, FVgeAnimNode_StateMachine::StaticStruct(), StateMachineKind, StateMachineWrite },
			{ NodeType_State, FVgeAnimNode_State::StaticStruct(), StateKind, StateWrite },
			{ NodeType_Transition, FVgeAnimNode_Transition::StaticStruct(), TransitionKind, TransitionWrite },
			{ NodeType_Layered, FVgeAnimNode_LayeredBoneBlend::StaticStruct(), LayeredKind, LayeredWrite },
			{ NodeType_Slot, FAnimNode_Slot::StaticStruct(), SlotKind, SlotWrite },
			{ NodeType_TwoBoneIK, FVgeAnimNode_TwoBoneIK::StaticStruct(), TwoBoneIKKind, TwoBoneIKWrite },
			{ NodeType_AnimDynamics, FVgeAnimNode_AnimDynamics::StaticStruct(), AnimDynamicsKind, AnimDynamicsWrite },
			{ NodeType_Control, FVgeAnimNode_SkeletalControl::StaticStruct(), ControlKind, ControlWrite },
		};
		return Types;
	}

	const FNodeType* FindType(FName Name)
	{
		return NodeTypes().FindByPredicate([Name](const FNodeType& Type) { return Type.Name == Name; });
	}
}

FAnimNode_Base* FVgeAnimGraphNode::Base()
{
	if (Type == NodeType_Clip) return As<FAnimNode_SequencePlayer_Standalone>(*this);
	if (Type == NodeType_BlendSpace) return As<FAnimNode_BlendSpacePlayer_Standalone>(*this);
	if (Type == NodeType_Blend) return As<FAnimNode_TwoWayBlend>(*this);
	if (Type == NodeType_BlendList) return As<FVgeAnimNode_BlendList>(*this);
	if (Type == NodeType_LinkedGraph) return As<FVgeAnimNode_LinkedAnimGraph>(*this);
	if (Type == NodeType_Inertialize) return As<FVgeAnimNode_Inertialization>(*this);
	if (Type == NodeType_StateMachine) return As<FVgeAnimNode_StateMachine>(*this);
	if (Type == NodeType_State) return As<FVgeAnimNode_State>(*this);
	if (Type == NodeType_Transition) return As<FVgeAnimNode_Transition>(*this);
	if (Type == NodeType_Layered) return As<FVgeAnimNode_LayeredBoneBlend>(*this);
	if (Type == NodeType_Slot) return As<FAnimNode_Slot>(*this);
	if (Type == NodeType_TwoBoneIK) return As<FVgeAnimNode_TwoBoneIK>(*this);
	if (Type == NodeType_AnimDynamics) return As<FVgeAnimNode_AnimDynamics>(*this);
	if (Type == NodeType_Control) return As<FVgeAnimNode_SkeletalControl>(*this);
	return nullptr;
}

void FVgeAnimInstanceProxy::SetGraph(const TSharedPtr<FJsonObject>& InRoot, UVgeAnimInstance& InOwner, bool bLive)
{
	TArray<FVgeAnimGraphNode> Previous = MoveTemp(Nodes);
	Nodes.Reset();
	Bindings.Reset();
	Root = InRoot.IsValid() ? AddNode(InRoot, Previous, InOwner, bLive) : INDEX_NONE;

	// What the new graph left out.
	for (FVgeAnimGraphNode& Node : Previous)
	{
		if (Node.Node.IsValid() && Node.Type == NodeType_LinkedGraph)
		{
			As<FVgeAnimNode_LinkedAnimGraph>(Node)->Teardown(&InOwner);
		}
	}
	Previous.Reset();

	if (bLive)
	{
		// What UAnimInstance::InitializeAnimation does for the graph, without uninitializing the instance (its
		// montages, notifies and linked instances go on).
		TGuardValue<bool> Rebuilding(bRebuildingGraph, true);
		InOwner.RecalcRequiredBones();
		Initialize(&InOwner);
		InitializeRootNode();
	}
}

int32 FVgeAnimInstanceProxy::AddNode(const TSharedPtr<FJsonObject>& InDescription, TArray<FVgeAnimGraphNode>& Previous, UVgeAnimInstance& InOwner, bool bLive)
{
	FString Id;
	FString TypeName;
	InDescription->TryGetStringField(TEXT("id"), Id);
	InDescription->TryGetStringField(TEXT("type"), TypeName);
	const FNodeType* Type = FindType(FName(*TypeName));
	if (!Type)
	{
		UE_LOG(LogVgeAnim, Error, TEXT("node %s: unknown type '%s'"), *Id, *TypeName);
		return INDEX_NONE;
	}

	FVgeAnimGraphNode Node;
	const int32 Kept = Previous.IndexOfByPredicate([&](const FVgeAnimGraphNode& Each) { return Each.Id == Id && Each.Type == Type->Name && Each.Node.IsValid(); });
	const bool bReused = Kept != INDEX_NONE;
	if (bReused)
	{
		Node = MoveTemp(Previous[Kept]);
	}
	else
	{
		Node.Id = Id;
		Node.Type = Type->Name;
		Node.Node.InitializeAs(Type->Struct);
	}
	const int32 Index = Nodes.Add(MoveTemp(Node));

	TArray<int32> Children;
	const TArray<TSharedPtr<FJsonValue>>* ChildDescriptions;
	if (InDescription->TryGetArrayField(TEXT("children"), ChildDescriptions))
	{
		for (const TSharedPtr<FJsonValue>& Child : *ChildDescriptions)
		{
			const TSharedPtr<FJsonObject>* ChildObject;
			if (Child->TryGetObject(ChildObject))
			{
				const int32 ChildIndex = AddNode(*ChildObject, Previous, InOwner, bLive);
				if (ChildIndex != INDEX_NONE)
				{
					Children.Add(ChildIndex);
				}
			}
		}
	}
	Nodes[Index].Children = MoveTemp(Children);

	// A node already running takes changes the way SetNodeParam gives them; a new one is set up before its first
	// initialization.
	UAnimInstance* LiveOwner = bReused && bLive ? &InOwner : nullptr;
	LinkChildren(Index, LiveOwner);
	const TSharedPtr<FJsonObject>* Props;
	if (InDescription->TryGetObjectField(TEXT("props"), Props))
	{
		const TSharedPtr<FJsonValue> ControlNode = Type->Name == NodeType_Control ? (*Props)->TryGetField(TEXT("node")) : nullptr;
		if (ControlNode.IsValid())
		{
			WriteProp(Index, TEXT("node"), ControlNode, LiveOwner);
		}
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Prop : (*Props)->Values)
		{
			if (!(ControlNode.IsValid() && Prop.Key == TEXT("node")))
			{
				WriteProp(Index, Prop.Key, Prop.Value, LiveOwner);
			}
		}
	}
	return Index;
}

void FVgeAnimInstanceProxy::CollectAssetPlayers(int32 InNode, TArray<FAnimNode_AssetPlayerRelevancyBase*>& OutPlayers)
{
	FVgeAnimGraphNode& Node = Nodes[InNode];
	if (Node.Type == NodeType_Clip)
	{
		OutPlayers.Add(As<FAnimNode_SequencePlayer_Standalone>(Node));
	}
	else if (Node.Type == NodeType_BlendSpace)
	{
		OutPlayers.Add(As<FAnimNode_BlendSpacePlayer_Standalone>(Node));
	}
	// A nested machine's animations belong to its own states.
	if (Node.Type != NodeType_StateMachine)
	{
		for (int32 Child : Node.Children)
		{
			CollectAssetPlayers(Child, OutPlayers);
		}
	}
}

void FVgeAnimInstanceProxy::LinkChildren(int32 InNode, UAnimInstance* InLiveOwner)
{
	FVgeAnimGraphNode& Node = Nodes[InNode];
	const TArray<int32> Children = Node.Children;
	auto ChildAt = [this, &Children](int32 Slot) -> FAnimNode_Base* { return Children.IsValidIndex(Slot) ? Nodes[Children[Slot]].Base() : nullptr; };
	auto ExpectChildren = [&Node, &Children](int32 Count, const TCHAR* What)
	{
		if (Children.Num() != Count)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("%s#%s: takes %s, has %d"), *Node.Type.ToString(), *Node.Id, What, Children.Num());
		}
	};

	if (Node.Type == NodeType_Blend)
	{
		ExpectChildren(2, TEXT("two poses (A, B)"));
		FAnimNode_TwoWayBlend* Blend = As<FAnimNode_TwoWayBlend>(Node);
		Blend->A.SetLinkNode(ChildAt(0));
		Blend->B.SetLinkNode(ChildAt(1));
	}
	else if (Node.Type == NodeType_BlendList)
	{
		FVgeAnimNode_BlendList* List = As<FVgeAnimNode_BlendList>(Node);
		List->BlendPose.SetNum(Children.Num());
		for (int32 Slot = 0; Slot < Children.Num(); ++Slot)
		{
			List->BlendPose[Slot].SetLinkNode(ChildAt(Slot));
		}
	}
	else if (Node.Type == NodeType_LinkedGraph)
	{
		FVgeAnimNode_LinkedAnimGraph* Linked = As<FVgeAnimNode_LinkedAnimGraph>(Node);
		Linked->InputPoses.SetNum(Children.Num());
		for (int32 Slot = 0; Slot < Children.Num(); ++Slot)
		{
			Linked->InputPoses[Slot].SetLinkNode(ChildAt(Slot));
		}
		// The running instance's input pose nodes point into InputPoses.
		if (InLiveOwner)
		{
			Linked->Relink(InLiveOwner);
		}
	}
	else if (Node.Type == NodeType_Inertialize || Node.Type == NodeType_State || Node.Type == NodeType_Slot || Node.Type == NodeType_TwoBoneIK || Node.Type == NodeType_AnimDynamics || Node.Type == NodeType_Control)
	{
		ExpectChildren(1, TEXT("one pose"));
		FPoseLink* Source = Node.Type == NodeType_Inertialize ? &As<FVgeAnimNode_Inertialization>(Node)->Source
			: Node.Type == NodeType_State ? &As<FVgeAnimNode_State>(Node)->Source
			: Node.Type == NodeType_Slot ? &As<FAnimNode_Slot>(Node)->Source
			: Node.Type == NodeType_TwoBoneIK ? &As<FVgeAnimNode_TwoBoneIK>(Node)->Source()
			: Node.Type == NodeType_Control ? &As<FVgeAnimNode_SkeletalControl>(Node)->Source()
			: &As<FVgeAnimNode_AnimDynamics>(Node)->Source();
		Source->SetLinkNode(ChildAt(0));
	}
	else if (Node.Type == NodeType_Layered)
	{
		if (Children.Num() < 1)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("layered#%s: takes a base pose and a pose per layer, has none"), *Node.Id);
		}
		FVgeAnimNode_LayeredBoneBlend* Layered = As<FVgeAnimNode_LayeredBoneBlend>(Node);
		const int32 NumLayers = FMath::Max(0, Children.Num() - 1);
		Layered->BasePose.SetLinkNode(ChildAt(0));
		Layered->BlendPoses.SetNum(NumLayers);
		for (int32 Layer = 0; Layer < NumLayers; ++Layer)
		{
			Layered->BlendPoses[Layer].SetLinkNode(ChildAt(Layer + 1));
		}
		const int32 OldWeights = Layered->BlendWeights.Num();
		Layered->BlendWeights.SetNum(NumLayers);
		for (int32 Layer = OldWeights; Layer < NumLayers; ++Layer)
		{
			Layered->BlendWeights[Layer] = 1.0f;
		}
		Layered->LayerSetup.SetNum(NumLayers);
		Layered->InvalidatePerBoneWeights();
	}
	else if (Node.Type == NodeType_StateMachine)
	{
		FVgeAnimNode_StateMachine* Machine = As<FVgeAnimNode_StateMachine>(Node);
		Machine->States.Reset();
		Machine->Transitions.Reset();
		Machine->StateAssetPlayers.Reset();
		Machine->Variables = &Variables;
		for (int32 Child : Children)
		{
			FVgeAnimGraphNode& ChildNode = Nodes[Child];
			if (ChildNode.Type == NodeType_State)
			{
				Machine->States.Add(As<FVgeAnimNode_State>(ChildNode));
				TArray<FAnimNode_AssetPlayerRelevancyBase*>& Players = Machine->StateAssetPlayers.AddDefaulted_GetRef();
				for (int32 Pose : ChildNode.Children)
				{
					CollectAssetPlayers(Pose, Players);
				}
			}
			else if (ChildNode.Type == NodeType_Transition)
			{
				Machine->Transitions.Add(As<FVgeAnimNode_Transition>(ChildNode));
			}
			else
			{
				UE_LOG(LogVgeAnim, Error, TEXT("stateMachine#%s: holds states and transitions, not %s#%s"), *Node.Id, *ChildNode.Type.ToString(), *ChildNode.Id);
			}
		}
	}
	else if (Children.Num() > 0)
	{
		UE_LOG(LogVgeAnim, Error, TEXT("%s#%s: takes no poses, has %d"), *Node.Type.ToString(), *Node.Id, Children.Num());
	}
}

bool FVgeAnimInstanceProxy::WriteProp(int32 InNode, const FString& InProp, const TSharedPtr<FJsonValue>& InValue, UAnimInstance* InLiveOwner)
{
	FVgeAnimGraphNode& Node = Nodes[InNode];
	const FNodeType* Type = FindType(Node.Type);
	const EPropKind Kind = Type->Kind(InProp);
	if (Kind == EPropKind::None)
	{
		UE_LOG(LogVgeAnim, Error, TEXT("%s#%s has no prop '%s'"), *Node.Type.ToString(), *Node.Id, *InProp);
		return false;
	}
	Bindings.RemoveAll([InNode, &InProp](const FVgeAnimGraphBinding& Binding) { return Binding.Node == InNode && Binding.Prop == InProp; });

	auto BoundVariable = [](const TSharedPtr<FJsonValue>& Value, FName& OutVariable)
	{
		const TSharedPtr<FJsonObject>* Object;
		FString Variable;
		if (Value->Type == EJson::Object && Value->TryGetObject(Object) && (*Object)->TryGetStringField(TEXT("param"), Variable))
		{
			OutVariable = FName(*Variable);
			return true;
		}
		return false;
	};
	auto NumberOf = [&Node, &InProp](const TSharedPtr<FJsonValue>& Value, double& OutNumber)
	{
		// By type: FJsonValue's TryGet* also convert numbers, bools and strings into one another.
		if (Value->Type == EJson::Number) { OutNumber = Value->AsNumber(); return true; }
		if (Value->Type == EJson::Boolean) { OutNumber = Value->AsBool() ? 1.0 : 0.0; return true; }
		UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: expects a number, a bool or {\"param\": name}"), *Node.Type.ToString(), *Node.Id, *InProp);
		return false;
	};

	FPropValue Value;
	switch (Kind)
	{
	case EPropKind::Number:
	{
		FName Variable;
		if (BoundVariable(InValue, Variable))
		{
			Bindings.Add({ InNode, InProp, INDEX_NONE, Variable });
			return false;
		}
		return NumberOf(InValue, Value.Number) && Type->Write(Node, InProp, Value, InLiveOwner);
	}
	case EPropKind::Numbers:
	{
		const TArray<TSharedPtr<FJsonValue>>* Elements;
		if (InValue->Type != EJson::Array || !InValue->TryGetArray(Elements))
		{
			// A single number for every element.
			return NumberOf(InValue, Value.Number) && Type->Write(Node, InProp, Value, InLiveOwner);
		}
		bool bBones = false;
		Value.Count = Elements->Num();
		for (int32 Element = 0; Element < Elements->Num(); ++Element)
		{
			Value.Element = Element;
			Value.Number = 0.0;
			FName Variable;
			if (BoundVariable((*Elements)[Element], Variable))
			{
				Bindings.Add({ InNode, InProp, Element, Variable });
			}
			else
			{
				NumberOf((*Elements)[Element], Value.Number);
			}
			bBones |= Type->Write(Node, InProp, Value, InLiveOwner);
		}
		return bBones;
	}
	case EPropKind::Object:
	{
		FString Path;
		if (InValue->Type == EJson::String && InValue->TryGetString(Path) && !Path.IsEmpty())
		{
			Value.Object = StaticLoadObject(UObject::StaticClass(), nullptr, *Path);
			if (!Value.Object)
			{
				UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: asset not found: %s"), *Node.Type.ToString(), *Node.Id, *InProp, *Path);
			}
		}
		return Type->Write(Node, InProp, Value, InLiveOwner);
	}
	case EPropKind::Text:
		if (InValue->Type != EJson::String)
		{
			UE_LOG(LogVgeAnim, Error, TEXT("%s#%s.%s: expects a string"), *Node.Type.ToString(), *Node.Id, *InProp);
			return false;
		}
		Value.Text = InValue->AsString();
		return Type->Write(Node, InProp, Value, InLiveOwner);
	case EPropKind::Json:
	{
		FName Variable;
		if (Node.Type == NodeType_Control && BoundVariable(InValue, Variable))
		{
			Bindings.Add({ InNode, InProp, INDEX_NONE, Variable });
			return false;
		}
		Value.Json = InValue;
	}
		return Type->Write(Node, InProp, Value, InLiveOwner);
	default:
		return false;
	}
}

int32 FVgeAnimInstanceProxy::FindNode(const FString& InId) const
{
	return Nodes.IndexOfByPredicate([&InId](const FVgeAnimGraphNode& Node) { return Node.Id == InId; });
}

void FVgeAnimInstanceProxy::SetNodeParam(const FString& InId, const FString& InProp, const TSharedPtr<FJsonValue>& InValue, UAnimInstance* InLiveOwner)
{
	const int32 Index = FindNode(InId);
	if (Index == INDEX_NONE)
	{
		UE_LOG(LogVgeAnim, Error, TEXT("SetNodeParam: no node '%s' in the graph"), *InId);
		return;
	}
	if (WriteProp(Index, InProp, InValue, InLiveOwner) && InLiveOwner)
	{
		// Bone references and per-bone data are built when bones are cached; a slot registers when it initializes.
		InLiveOwner->RecalcRequiredBones();
		if (Nodes[Index].Type == NodeType_Slot)
		{
			FAnimationInitializeContext Context(this);
			Nodes[Index].Base()->Initialize_AnyThread(Context);
		}
	}
}

FAnimNode_Base* FVgeAnimInstanceProxy::GetCustomRootNode()
{
	return Nodes.IsValidIndex(Root) ? Nodes[Root].Base() : nullptr;
}

void FVgeAnimInstanceProxy::GetCustomNodes(TArray<FAnimNode_Base*>& OutNodes)
{
	for (FVgeAnimGraphNode& Node : Nodes)
	{
		OutNodes.Add(Node.Base());
	}
}

void FVgeAnimInstanceProxy::PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds)
{
	FAnimInstanceProxy::PreUpdate(InAnimInstance, DeltaSeconds);

	// On the game thread, before the update that may run on a worker.
	UVgeAnimInstance* Instance = CastChecked<UVgeAnimInstance>(InAnimInstance);
	for (const UVgeAnimInstance::FPendingNodeParam& Param : Instance->TakePendingNodeParams())
	{
		SetNodeParam(Param.NodeId, Param.Prop, Param.Value, Instance);
	}
	Variables = Instance->GetVariables();
	for (const FVgeAnimGraphBinding& Binding : Bindings)
	{
		FPropValue Value;
		Value.Number = Variables.FindRef(Binding.Variable);
		Value.Element = Binding.Element;
		FindType(Nodes[Binding.Node].Type)->Write(Nodes[Binding.Node], Binding.Prop, Value, nullptr);
	}
}

void FVgeAnimInstanceProxy::AddReferencedObjects(UAnimInstance* InAnimInstance, FReferenceCollector& Collector)
{
	FAnimInstanceProxy::AddReferencedObjects(InAnimInstance, Collector);

	// The nodes' assets, classes and linked instances (their UPROPERTYs).
	for (FVgeAnimGraphNode& Node : Nodes)
	{
		Node.Node.AddStructReferencedObjects(Collector);
	}
}

FString FVgeAnimInstanceProxy::DescribeGraph()
{
	return Nodes.IsValidIndex(Root) ? DescribeNode(Root) : FString();
}

FString FVgeAnimInstanceProxy::DescribeNode(int32 InNode)
{
	FVgeAnimGraphNode& Node = Nodes[InNode];
	FString Text = FString::Printf(TEXT("%s#%s"), *Node.Type.ToString(), *Node.Id);
	if (Node.Type == NodeType_LinkedGraph)
	{
		FVgeAnimNode_LinkedAnimGraph* Linked = As<FVgeAnimNode_LinkedAnimGraph>(Node);
		const UAnimInstance* Running = Linked->GetTargetInstance<UAnimInstance>();
		Text += FString::Printf(TEXT("[class=%s running=%s linked=%s]"), *GetNameSafe(*Linked->InstanceClass), *GetNameSafe(Running ? Running->GetClass() : nullptr), Linked->LinkedRoot ? TEXT("yes") : TEXT("no"));
	}
	else if (Node.Type == NodeType_StateMachine)
	{
		Text += FString::Printf(TEXT("[state=%s]"), *As<FVgeAnimNode_StateMachine>(Node)->GetCurrentStateName().ToString());
	}
	else if (Node.Type == NodeType_State)
	{
		Text += FString::Printf(TEXT("[%s]"), *As<FVgeAnimNode_State>(Node)->Name.ToString());
	}
	else if (Node.Type == NodeType_Transition)
	{
		const FVgeAnimNode_Transition* Transition = As<FVgeAnimNode_Transition>(Node);
		Text += FString::Printf(TEXT("[%s->%s when \"%s\"]"), *Transition->From.ToString(), *Transition->To.ToString(), *Transition->ConditionText);
	}
	TArray<FString> Children;
	for (int32 Child : Node.Children)
	{
		Children.Add(DescribeNode(Child));
	}
	return Children.IsEmpty() ? Text : FString::Printf(TEXT("%s(%s)"), *Text, *FString::Join(Children, TEXT(", ")));
}

FString FVgeAnimInstanceProxy::DescribeNodeState(const FString& InId)
{
	const int32 Index = FindNode(InId);
	if (Index == INDEX_NONE)
	{
		return FString();
	}
	FVgeAnimGraphNode& Node = Nodes[Index];
	TSharedRef<FJsonObject> State = MakeShared<FJsonObject>();
	State->SetStringField(TEXT("type"), Node.Type.ToString());
	auto Numbers = [](const TArray<float>& Values)
	{
		TArray<TSharedPtr<FJsonValue>> Array;
		for (float Value : Values)
		{
			Array.Add(MakeShared<FJsonValueNumber>(Value));
		}
		return Array;
	};

	if (Node.Type == NodeType_StateMachine)
	{
		const FVgeAnimNode_StateMachine* Machine = As<FVgeAnimNode_StateMachine>(Node);
		State->SetStringField(TEXT("state"), Machine->GetCurrentStateName().ToString());
		State->SetNumberField(TEXT("elapsed"), Machine->GetElapsedTime());
		State->SetNumberField(TEXT("transitions"), Machine->GetTransitionCount());
		TSharedRef<FJsonObject> Weights = MakeShared<FJsonObject>();
		for (int32 StateIndex = 0; StateIndex < Machine->States.Num(); ++StateIndex)
		{
			Weights->SetNumberField(Machine->States[StateIndex]->Name.ToString(), Machine->GetStateWeight(StateIndex));
		}
		State->SetObjectField(TEXT("weights"), Weights);
	}
	else if (Node.Type == NodeType_BlendList)
	{
		const FVgeAnimNode_BlendList* List = As<FVgeAnimNode_BlendList>(Node);
		State->SetNumberField(TEXT("index"), List->GetActiveChildIndex());
		TArray<float> Weights;
		for (int32 Child = 0; Child < List->BlendPose.Num(); ++Child)
		{
			Weights.Add(List->GetChildWeight(Child));
		}
		State->SetArrayField(TEXT("weights"), Numbers(Weights));
	}
	else if (Node.Type == NodeType_Inertialize)
	{
		const FVgeAnimNode_Inertialization* Inertialization = As<FVgeAnimNode_Inertialization>(Node);
		State->SetBoolField(TEXT("active"), Inertialization->IsActive());
		State->SetNumberField(TEXT("elapsed"), Inertialization->GetElapsedTime());
		State->SetNumberField(TEXT("duration"), Inertialization->GetDuration());
	}
	else if (Node.Type == NodeType_Clip || Node.Type == NodeType_BlendSpace)
	{
		const FAnimNode_AssetPlayerRelevancyBase* Player = Node.Type == NodeType_Clip
			? static_cast<const FAnimNode_AssetPlayerRelevancyBase*>(As<FAnimNode_SequencePlayer_Standalone>(Node))
			: static_cast<const FAnimNode_AssetPlayerRelevancyBase*>(As<FAnimNode_BlendSpacePlayer_Standalone>(Node));
		State->SetNumberField(TEXT("time"), Player->GetCurrentAssetTime());
		State->SetNumberField(TEXT("length"), Player->GetCurrentAssetLength());
		State->SetNumberField(TEXT("weight"), Player->GetCachedBlendWeight());
	}
	else if (Node.Type == NodeType_Layered)
	{
		State->SetArrayField(TEXT("weights"), Numbers(As<FVgeAnimNode_LayeredBoneBlend>(Node)->BlendWeights));
	}
	else if (Node.Type == NodeType_TwoBoneIK)
	{
		const FAnimNode_TwoBoneIK& IK = As<FVgeAnimNode_TwoBoneIK>(Node)->IK;
		State->SetNumberField(TEXT("alpha"), IK.ActualAlpha);
		State->SetArrayField(TEXT("effectorLocation"), Numbers({ static_cast<float>(IK.EffectorLocation.X), static_cast<float>(IK.EffectorLocation.Y), static_cast<float>(IK.EffectorLocation.Z) }));
	}
	else if (Node.Type == NodeType_Blend)
	{
		State->SetNumberField(TEXT("alpha"), As<FAnimNode_TwoWayBlend>(Node)->Alpha);
	}
	else if (Node.Type == NodeType_AnimDynamics)
	{
		const FAnimNode_AnimDynamics& Dynamics = As<FVgeAnimNode_AnimDynamics>(Node)->Dynamics;
		State->SetNumberField(TEXT("bodies"), Dynamics.GetNumBodies());
		TArray<TSharedPtr<FJsonValue>> Positions;
		for (int32 Body = 0; Body < Dynamics.GetNumBodies(); ++Body)
		{
			const FVector Position = Dynamics.GetPhysBody(Body).Pose.Position;
			Positions.Add(MakeShared<FJsonValueArray>(Numbers({ static_cast<float>(Position.X), static_cast<float>(Position.Y), static_cast<float>(Position.Z) })));
		}
		State->SetArrayField(TEXT("positions"), Positions);
	}

	FString Json;
	FJsonSerializer::Serialize(State, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));
	return Json;
}

UAnimInstance* FVgeAnimInstanceProxy::GetLinkedInstance(const FString& InId)
{
	const int32 Index = FindNode(InId);
	return Index != INDEX_NONE && Nodes[Index].Type == NodeType_LinkedGraph ? As<FVgeAnimNode_LinkedAnimGraph>(Nodes[Index])->GetTargetInstance<UAnimInstance>() : nullptr;
}

FAnimInstanceProxy* UVgeAnimInstance::CreateAnimInstanceProxy()
{
	return new FVgeAnimInstanceProxy(this);
}

void UVgeAnimInstance::NativeInitializeAnimation()
{
	Super::NativeInitializeAnimation();
	bRunning = true;
}

void UVgeAnimInstance::NativeUninitializeAnimation()
{
	bRunning = false;
	Super::NativeUninitializeAnimation();
}

void UVgeAnimInstance::SetGraph(const FString& Json)
{
	TSharedPtr<FJsonObject> Root;
	if (!Json.IsEmpty() && (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) || !Root.IsValid()))
	{
		UE_LOG(LogVgeAnim, Error, TEXT("SetGraph: not a JSON object"));
		return;
	}
	// Blocks on an evaluation still running on a worker: the graph changes under nothing.
	GetProxyOnGameThread<FVgeAnimInstanceProxy>().SetGraph(Root, *this, bRunning);
}

void UVgeAnimInstance::SetNodeParam(const FString& NodeId, const FString& Prop, const FString& Json)
{
	// TJsonReader starts at an object or an array only, so a bare value (a number, a bool) is read as [value].
	TArray<TSharedPtr<FJsonValue>> Values;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(TEXT("[") + Json + TEXT("]")), Values) || Values.Num() != 1 || !Values[0].IsValid())
	{
		UE_LOG(LogVgeAnim, Error, TEXT("SetNodeParam %s.%s: not a JSON value: %s"), *NodeId, *Prop, *Json);
		return;
	}
	if (!bRunning)
	{
		GetProxyOnGameThread<FVgeAnimInstanceProxy>().SetNodeParam(NodeId, Prop, Values[0], nullptr);
		return;
	}
	FPendingNodeParam* Pending = PendingNodeParams.FindByPredicate([&](const FPendingNodeParam& Param) { return Param.NodeId == NodeId && Param.Prop == Prop; });
	if (Pending)
	{
		Pending->Value = Values[0];
	}
	else
	{
		PendingNodeParams.Add({ NodeId, Prop, Values[0] });
	}
}

FString UVgeAnimInstance::DescribeGraph()
{
	return GetProxyOnGameThread<FVgeAnimInstanceProxy>().DescribeGraph();
}

FString UVgeAnimInstance::DescribeNode(const FString& NodeId)
{
	return GetProxyOnGameThread<FVgeAnimInstanceProxy>().DescribeNodeState(NodeId);
}

UAnimInstance* UVgeAnimInstance::GetLinkedInstance(const FString& NodeId)
{
	return GetProxyOnGameThread<FVgeAnimInstanceProxy>().GetLinkedInstance(NodeId);
}
