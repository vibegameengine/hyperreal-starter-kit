#include "VgeMotionMatching.h"

#include "Animation/AnimBlueprint.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimSequence.h"
#include "Animation/Skeleton.h"
#include "AnimGraphNode_Root.h"
#include "EdGraph/EdGraph.h"
#include "EdGraphSchema_K2.h"
#include "Factories/AnimBlueprintFactory.h"
#include "FileHelpers.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/PackageName.h"
#include "PoseSearch/PoseSearchDatabase.h"
#include "PoseSearch/PoseSearchSchema.h"
#include "UObject/Package.h"

namespace
{
	template <typename T>
	T* NewAsset(const FString& Folder, const FString& Name, UClass* Class = T::StaticClass())
	{
		UPackage* Package = CreatePackage(*FString::Printf(TEXT("%s/%s"), *Folder, *Name));
		return NewObject<T>(Package, Class, *Name, RF_Public | RF_Standalone);
	}

	UEdGraphNode* AddGraphNode(UEdGraph* Graph, const TCHAR* ClassPath, int32 X)
	{
		UClass* Class = FindObject<UClass>(nullptr, ClassPath);
		if (!Class)
		{
			return nullptr;
		}
		UEdGraphNode* Node = NewObject<UEdGraphNode>(Graph, Class, NAME_None, RF_Transactional);
		Graph->AddNode(Node, false, false);
		Node->CreateNewGuid();
		Node->PostPlacedNewNode();
		Node->AllocateDefaultPins();
		Node->NodePosX = X;
		return Node;
	}

	void* NodeStruct(UEdGraphNode* GraphNode)
	{
		const FStructProperty* Property = CastField<FStructProperty>(GraphNode->GetClass()->FindPropertyByName(TEXT("Node")));
		return Property ? Property->ContainerPtrToValuePtr<void>(GraphNode) : nullptr;
	}

	template <typename T>
	void SetNodeField(UEdGraphNode* GraphNode, const TCHAR* Field, const T& Value)
	{
		const FStructProperty* Property = CastField<FStructProperty>(GraphNode->GetClass()->FindPropertyByName(TEXT("Node")));
		if (!Property)
		{
			return;
		}
		if (const FProperty* Member = Property->Struct->FindPropertyByName(Field))
		{
			*Member->ContainerPtrToValuePtr<T>(NodeStruct(GraphNode)) = Value;
		}
	}

	UEdGraphPin* PosePin(UEdGraphNode* Node, EEdGraphPinDirection Direction)
	{
		for (UEdGraphPin* Pin : Node->Pins)
		{
			const UObject* Type = Pin->PinType.PinSubCategoryObject.Get();
			if (Pin->Direction == Direction && (Type == FPoseLink::StaticStruct() || Type == FComponentSpacePoseLink::StaticStruct()))
			{
				return Pin;
			}
		}
		return nullptr;
	}

	double RootSpeed(const UAnimSequence* Sequence)
	{
		const double Length = Sequence->GetPlayLength();
		if (Length <= 0.0)
		{
			return 0.0;
		}
		const FTransform Root = Sequence->ExtractRootMotionFromRange(0.0, Length, FAnimExtractContext());
		return Root.GetTranslation().Size2D() / Length;
	}

	FFloatInterval PlayRateOf(const TSharedPtr<FJsonObject>& Request)
	{
		const TArray<TSharedPtr<FJsonValue>>* Range = nullptr;
		if (Request->TryGetArrayField(TEXT("playRate"), Range) && Range->Num() == 2)
		{
			return FFloatInterval(static_cast<float>((*Range)[0]->AsNumber()), static_cast<float>((*Range)[1]->AsNumber()));
		}
		return FFloatInterval(1.f, 1.f);
	}
}

TSharedRef<FJsonObject> VgeMotionMatching::Build(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString AssetPath = Request->GetStringField(TEXT("path"));
	const FString Folder = FPackageName::GetLongPackagePath(AssetPath);
	const FString Name = FPackageName::GetShortName(AssetPath);

	USkeleton* Skeleton = LoadObject<USkeleton>(nullptr, *Request->GetStringField(TEXT("skeleton")));
	if (!Skeleton)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no skeleton %s"), *Request->GetStringField(TEXT("skeleton"))));
		return Result;
	}

	TArray<UAnimSequence*> Sequences;
	TArray<TSharedPtr<FJsonValue>> Clips;
	for (const TSharedPtr<FJsonValue>& Value : Request->GetArrayField(TEXT("clips")))
	{
		UAnimSequence* Sequence = LoadObject<UAnimSequence>(nullptr, *Value->AsString());
		TSharedPtr<FJsonObject> Clip = MakeShared<FJsonObject>();
		Clip->SetStringField(TEXT("path"), Value->AsString());
		if (!Sequence)
		{
			Clip->SetStringField(TEXT("error"), TEXT("not an animation sequence"));
		}
		else
		{
			Clip->SetNumberField(TEXT("length"), Sequence->GetPlayLength());
			Clip->SetNumberField(TEXT("rootSpeed"), RootSpeed(Sequence));
			Sequences.Add(Sequence);
		}
		Clips.Add(MakeShared<FJsonValueObject>(Clip));
	}
	Result->SetArrayField(TEXT("clips"), Clips);
	if (Sequences.IsEmpty())
	{
		Result->SetStringField(TEXT("error"), TEXT("no clips to search"));
		return Result;
	}

	UPoseSearchSchema* Schema = NewAsset<UPoseSearchSchema>(Folder, Name + TEXT("_Schema"));
	Schema->AddSkeleton(Skeleton);
	Schema->AddDefaultChannels();

	UPoseSearchDatabase* Database = NewAsset<UPoseSearchDatabase>(Folder, Name + TEXT("_Database"));
	Database->Schema = Schema;
	for (UAnimSequence* Sequence : Sequences)
	{
		FPoseSearchDatabaseAnimationAsset Entry;
		Entry.AnimAsset = Sequence;
		Database->AddAnimationAsset(Entry);
	}

	UAnimBlueprintFactory* Factory = NewObject<UAnimBlueprintFactory>();
	Factory->TargetSkeleton = Skeleton;
	Factory->ParentClass = UAnimInstance::StaticClass();
	Factory->BlueprintType = BPTYPE_Normal;
	UPackage* GraphPackage = CreatePackage(*AssetPath);
	UAnimBlueprint* Blueprint = Cast<UAnimBlueprint>(Factory->FactoryCreateNew(UAnimBlueprint::StaticClass(), GraphPackage, *Name, RF_Public | RF_Standalone, nullptr, GWarn));
	UEdGraph* AnimGraph = nullptr;
	for (UEdGraph* Graph : Blueprint ? Blueprint->FunctionGraphs : TArray<TObjectPtr<UEdGraph>>())
	{
		if (Graph->GetFName() == UEdGraphSchema_K2::GN_AnimGraph)
		{
			AnimGraph = Graph;
		}
	}
	UAnimGraphNode_Root* Root = nullptr;
	for (UEdGraphNode* Node : AnimGraph ? AnimGraph->Nodes : TArray<TObjectPtr<UEdGraphNode>>())
	{
		Root = Root ? Root : Cast<UAnimGraphNode_Root>(Node);
	}
	if (!Root)
	{
		Result->SetStringField(TEXT("error"), TEXT("the animation blueprint has no AnimGraph root"));
		return Result;
	}

	UEdGraphNode* History = AddGraphNode(AnimGraph, TEXT("/Script/PoseSearchEditor.AnimGraphNode_PoseSearchHistoryCollector"), -300);
	UEdGraphNode* Matching = AddGraphNode(AnimGraph, TEXT("/Script/PoseSearchEditor.AnimGraphNode_MotionMatching"), -700);
	if (!History || !Matching)
	{
		Result->SetStringField(TEXT("error"), TEXT("the PoseSearch editor nodes are not loaded; enable the PoseSearch plugin"));
		return Result;
	}
	SetNodeField(History, TEXT("bGenerateTrajectory"), true);
	SetNodeField(Matching, TEXT("Database"), TObjectPtr<const UPoseSearchDatabase>(Database));
	if (UEdGraphPin* DatabasePin = Matching->FindPin(TEXT("Database"), EGPD_Input))
	{
		DatabasePin->DefaultObject = Database;
	}
	SetNodeField(Matching, TEXT("bUseInertialBlend"), false);
	SetNodeField(Matching, TEXT("PlayRate"), PlayRateOf(Request));
	PosePin(Matching, EGPD_Output)->MakeLinkTo(PosePin(History, EGPD_Input));
	PosePin(History, EGPD_Output)->MakeLinkTo(PosePin(Root, EGPD_Input));

	FKismetEditorUtilities::CompileBlueprint(Blueprint);
	const bool bCompiled = Blueprint->Status != BS_Error;

	const bool bSaved = UEditorLoadingAndSavingUtils::SavePackages({ Schema->GetPackage(), Database->GetPackage(), GraphPackage }, false);
	Result->SetBoolField(TEXT("saved"), bSaved && bCompiled);
	Result->SetStringField(TEXT("animClass"), Blueprint->GeneratedClass ? Blueprint->GeneratedClass->GetPathName() : FString());
	Result->SetStringField(TEXT("database"), Database->GetPathName());
	if (!bCompiled)
	{
		Result->SetStringField(TEXT("error"), TEXT("the motion matching animation blueprint did not compile; see the service log"));
	}
	return Result;
}
