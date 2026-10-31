#include "VgeRetargeter.h"

#include "Animation/AnimSequence.h"
#include "Animation/AnimData/IAnimationDataController.h"
#include "Curves/RichCurve.h"
#include "JsonObjectConverter.h"
#include "Animation/AnimData/IAnimationDataModel.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Engine/SkeletalMesh.h"
#include "FileHelpers.h"
#include "RetargetEditor/IKRetargetBatchOperation.h"
#include "RetargetEditor/IKRetargeterController.h"
#include "Retargeter/IKRetargeter.h"
#include "Retargeter/RetargetOps/FKChainsOp.h"
#include "Retargeter/RetargetOps/PinBoneOp.h"
#include "Retargeter/RetargetOps/RootMotionGeneratorOp.h"
#include "Retargeter/RetargetOps/RunIKRigOp.h"
#include "Rig/IKRigDefinition.h"
#include "RigEditor/IKRigAutoCharacterizer.h"
#include "RigEditor/IKRigAutoFBIK.h"
#include "RigEditor/IKRigController.h"
#include "UObject/StrongObjectPtr.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeRetarget, Log, All);

namespace
{
	// FProceduralRetargetAssets::AutoGenerateIKRigAsset: an IK Rig for the mesh, its retarget chains characterized
	// from the skeleton, and full-body IK generated.
	UIKRigDefinition* AutoGenerateIKRig(USkeletalMesh* Mesh, FAutoCharacterizeResults& Characterization)
	{
		UIKRigDefinition* Rig = NewObject<UIKRigDefinition>(GetTransientPackage(), MakeUniqueObjectName(GetTransientPackage(), UIKRigDefinition::StaticClass(), TEXT("VgeRetargetIKRig")), RF_Public | RF_Standalone);
		const UIKRigController* Controller = UIKRigController::GetController(Rig);
		Controller->SetSkeletalMesh(Mesh);
		Controller->AutoGenerateRetargetDefinition(Characterization);
		Controller->SetRetargetDefinition(Characterization.AutoRetargetDefinition.RetargetDefinition);
		FAutoFBIKResults IKResults;
		Controller->AutoGenerateFBIK(IKResults);
		return Rig;
	}

	// FProceduralRetargetAssets::AutoGenerateIKRetargetAsset: default ops, exact chain mapping, the target's retarget
	// pose auto-aligned to the source, root motion and pinned bones from the target's characterization.
	UIKRetargeter* AutoGenerateRetargeter(UIKRigDefinition* SourceRig, UIKRigDefinition* TargetRig, const FAutoCharacterizeResults& Source, const FAutoCharacterizeResults& Target)
	{
		UIKRetargeter* Retargeter = NewObject<UIKRetargeter>(GetTransientPackage(), MakeUniqueObjectName(GetTransientPackage(), UIKRetargeter::StaticClass(), TEXT("VgeRetargeter")), RF_Public | RF_Standalone);
		const UIKRetargeterController* Controller = UIKRetargeterController::GetController(Retargeter);
		FScopedReinitializeIKRetargeter Reinitialize(Controller, ERetargetRefreshMode::ProcessorAndOpStack);

		Controller->SetIKRig(ERetargetSourceOrTarget::Source, SourceRig);
		Controller->SetIKRig(ERetargetSourceOrTarget::Target, TargetRig);
		Controller->RemoveAllOps();
		Controller->AddDefaultOps();

		// Exact mapping only, as the editor's auto retarget does (fuzzy can map toes to fingers).
		FIKRetargetFKChainsOp* FKChainOp = Controller->GetFirstRetargetOpOfType<FIKRetargetFKChainsOp>();
		FKChainOp->Settings.ChainMapping.AutoMapChains(EAutoMapChainType::Exact, /*bForceRemap*/ true);

		const FName TargetPose = Controller->GetCurrentRetargetPoseName(ERetargetSourceOrTarget::Target);
		Controller->ResetRetargetPose(TargetPose, TArray<FName>(), ERetargetSourceOrTarget::Target);
		Controller->AutoAlignAllBones(ERetargetSourceOrTarget::Target);
		const TArray<FName>& BonesToExclude = Target.AutoRetargetDefinition.BonesToExcludeFromAutoPose;
		if (!BonesToExclude.IsEmpty())
		{
			Controller->ResetRetargetPose(Controller->GetCurrentRetargetPoseName(ERetargetSourceOrTarget::Target), BonesToExclude, ERetargetSourceOrTarget::Target);
		}

		Controller->GetFirstRetargetOpOfType<FIKRetargetRunIKRigOp>()->SetEnabled(false);

		FIKRetargetRootMotionOp* RootOp = Controller->GetFirstRetargetOpOfType<FIKRetargetRootMotionOp>();
		const FName TargetRoot = TargetRig->GetSkeleton().BoneNames[0];
		if (TargetRoot != Target.AutoRetargetDefinition.RetargetDefinition.PelvisBone)
		{
			const FName SourceRoot = SourceRig->GetSkeleton().BoneNames[0];
			if (SourceRoot == Source.AutoRetargetDefinition.RetargetDefinition.PelvisBone)
			{
				RootOp->Settings.RootMotionSource = ERootMotionSource::GenerateFromTargetPelvis;
				RootOp->Settings.RootHeightSource = ERootMotionHeightSource::SnapToGround;
				RootOp->Settings.bRotateWithPelvis = true;
				RootOp->Settings.bMaintainOffsetFromPelvis = true;
			}
		}
		else
		{
			RootOp->SetEnabled(false);
		}

		Controller->AddRetargetOp(FIKRetargetPinBoneOp::StaticStruct());
		FIKRetargetPinBoneOp* PinBoneOp = Controller->GetFirstRetargetOpOfType<FIKRetargetPinBoneOp>();
		PinBoneOp->Settings.TranslationMode = EPinBoneTranslationMode::CopyGlobalPosition;
		PinBoneOp->Settings.RotationMode = EPinBoneRotationMode::CopyGlobalRotation;
		for (const FBoneToPin& BoneToPin : Target.AutoRetargetDefinition.BonesToPin.GetBonesToPin())
		{
			FPinBoneData PinBoneData;
			PinBoneData.BoneToCopyFrom.BoneName = BoneToPin.BoneToPinTo;
			PinBoneData.BoneToCopyTo.BoneName = BoneToPin.BoneToPin;
			PinBoneOp->Settings.BonesToPin.Add(PinBoneData);
		}
		return Retargeter;
	}

	bool GeneratesRootFromPelvis(const UIKRigDefinition* SourceRig, const UIKRigDefinition* TargetRig, const FAutoCharacterizeResults& Source, const FAutoCharacterizeResults& Target)
	{
		return TargetRig->GetSkeleton().BoneNames[0] != Target.AutoRetargetDefinition.RetargetDefinition.PelvisBone
			&& SourceRig->GetSkeleton().BoneNames[0] == Source.AutoRetargetDefinition.RetargetDefinition.PelvisBone;
	}

	constexpr double RootSmoothingSeconds = 0.5;

	constexpr double LoopSeamDegrees = 1.0;

	bool IsSeamlessLoop(const UAnimSequence* Sequence)
	{
		const IAnimationDataModel* Model = Sequence->GetDataModel();
		const FReferenceSkeleton& Skeleton = Sequence->GetSkeleton()->GetReferenceSkeleton();
		bool bAnyTrack = false;
		for (int32 Bone = 1; Bone < Skeleton.GetNum(); ++Bone)
		{
			const FName Name = Skeleton.GetBoneName(Bone);
			if (!Model->IsValidBoneTrackName(Name))
			{
				continue;
			}
			TArray<FTransform> Keys;
			Model->GetBoneTrackTransforms(Name, Keys);
			if (Keys.Num() < 2)
			{
				continue;
			}
			bAnyTrack = true;
			if (FMath::RadiansToDegrees(Keys[0].GetRotation().AngularDistance(Keys.Last().GetRotation())) > LoopSeamDegrees)
			{
				return false;
			}
		}
		return bAnyTrack;
	}

	TArray<FVector> SmoothedTranslations(const TArray<FTransform>& Root, int32 HalfWindow)
	{
		TArray<FVector> Smoothed;
		Smoothed.SetNum(Root.Num());
		for (int32 Frame = 0; Frame < Root.Num(); ++Frame)
		{
			const int32 Reach = FMath::Min3(HalfWindow, Frame, Root.Num() - 1 - Frame);
			FVector Sum = FVector::ZeroVector;
			for (int32 Offset = -Reach; Offset <= Reach; ++Offset)
			{
				Sum += Root[Frame + Offset].GetTranslation();
			}
			Smoothed[Frame] = Sum / (2 * Reach + 1);
			Smoothed[Frame].Z = Root[Frame].GetTranslation().Z;
		}
		return Smoothed;
	}

	TArray<double> UnwrappedYaws(const TArray<FTransform>& Root)
	{
		TArray<double> Yaws;
		for (const FTransform& Key : Root)
		{
			const double Yaw = Key.Rotator().Yaw;
			Yaws.Add(Yaws.IsEmpty() ? Yaw : Yaws.Last() + FMath::UnwindDegrees(Yaw - Yaws.Last()));
		}
		return Yaws;
	}

	TArray<FVector> StraightLoopTranslations(const TArray<FTransform>& Root)
	{
		const int32 Steps = Root.Num() - 1;
		const FVector Start = Root[0].GetTranslation();
		const FVector Travel = Root.Last().GetTranslation() - Start;
		TArray<FVector> Straight;
		for (int32 Frame = 0; Frame <= Steps; ++Frame)
		{
			FVector Point = Start + Travel * (static_cast<double>(Frame) / Steps);
			Point.Z = Root[Frame].GetTranslation().Z;
			Straight.Add(Point);
		}
		return Straight;
	}

	TArray<double> ConstantLoopYaws(const TArray<double>& Yaws)
	{
		double Sum = 0.0;
		for (int32 Frame = 0; Frame < Yaws.Num() - 1; ++Frame)
		{
			Sum += Yaws[Frame];
		}
		TArray<double> Constant;
		Constant.Init(Sum / (Yaws.Num() - 1), Yaws.Num());
		return Constant;
	}

	TArray<double> SmoothedYaws(const TArray<double>& Yaws, int32 HalfWindow)
	{
		TArray<double> Smoothed;
		Smoothed.SetNum(Yaws.Num());
		for (int32 Frame = 0; Frame < Yaws.Num(); ++Frame)
		{
			const int32 Reach = FMath::Min3(HalfWindow, Frame, Yaws.Num() - 1 - Frame);
			double Sum = 0.0;
			for (int32 Offset = -Reach; Offset <= Reach; ++Offset)
			{
				Sum += Yaws[Frame + Offset];
			}
			Smoothed[Frame] = Sum / (2 * Reach + 1);
		}
		return Smoothed;
	}

	TArray<FVector> GlobalPositions(const UAnimSequence* Sequence, int32 Bone)
	{
		const IAnimationDataModel* Model = Sequence->GetDataModel();
		const FReferenceSkeleton& Skeleton = Sequence->GetSkeleton()->GetReferenceSkeleton();
		const int32 Frames = Model->GetNumberOfKeys();
		TArray<FTransform> Global;
		Global.Init(FTransform::Identity, Frames);
		for (int32 Index = Bone; Index != INDEX_NONE; Index = Skeleton.GetParentIndex(Index))
		{
			TArray<FTransform> Local;
			const FName Name = Skeleton.GetBoneName(Index);
			if (Model->IsValidBoneTrackName(Name))
			{
				Model->GetBoneTrackTransforms(Name, Local);
			}
			for (int32 Frame = 0; Frame < Frames; ++Frame)
			{
				Global[Frame] = Global[Frame] * (Local.IsValidIndex(Frame) ? Local[Frame] : Skeleton.GetRefBonePose()[Index]);
			}
		}
		TArray<FVector> Positions;
		for (const FTransform& Transform : Global)
		{
			Positions.Add(Transform.GetLocation());
		}
		return Positions;
	}

	void AddSpeedCurves(UAnimSequence* Sequence, const TArray<TSharedPtr<FJsonValue>>& Curves)
	{
		const IAnimationDataModel* Model = Sequence->GetDataModel();
		const FReferenceSkeleton& Skeleton = Sequence->GetSkeleton()->GetReferenceSkeleton();
		const double Rate = Model->GetFrameRate().AsDecimal();
		IAnimationDataController& Controller = Sequence->GetController();
		IAnimationDataController::FScopedBracket Bracket(Controller, FText::FromString(TEXT("Speed curves")), false);
		for (const TSharedPtr<FJsonValue>& Value : Curves)
		{
			const TSharedPtr<FJsonObject> Entry = Value->AsObject();
			const int32 Bone = Entry ? Skeleton.FindBoneIndex(FName(*Entry->GetStringField(TEXT("bone")))) : INDEX_NONE;
			if (Bone == INDEX_NONE)
			{
				continue;
			}
			const TArray<FVector> Positions = GlobalPositions(Sequence, Bone);
			const int32 Last = Positions.Num() - 1;
			if (Last < 1)
			{
				continue;
			}
			TArray<FRichCurveKey> Keys;
			for (int32 Frame = 0; Frame <= Last; ++Frame)
			{
				const int32 Before = FMath::Max(Frame - 1, 0);
				const int32 After = FMath::Min(Frame + 1, Last);
				const double Speed = FVector::Dist(Positions[After], Positions[Before]) * Rate / (After - Before);
				Keys.Add(FRichCurveKey(static_cast<float>(Frame / Rate), static_cast<float>(Speed)));
			}
			const FAnimationCurveIdentifier Id(FName(*Entry->GetStringField(TEXT("curve"))), ERawCurveTrackTypes::RCT_Float);
			Controller.AddCurve(Id, 0x00000004, false);
			Controller.SetCurveKeys(Id, Keys, false);
		}
	}

	void SmoothRootTrack(UAnimSequence* Sequence, bool bLoop)
	{
		const IAnimationDataModel* Model = Sequence->GetDataModel();
		const FReferenceSkeleton& Skeleton = Sequence->GetSkeleton()->GetReferenceSkeleton();
		const FName RootName = Skeleton.GetBoneName(0);
		TArray<FTransform> Root;
		Model->GetBoneTrackTransforms(RootName, Root);
		if (Root.Num() < 3)
		{
			return;
		}
		const int32 HalfWindow = FMath::Max(1, FMath::RoundToInt(Model->GetFrameRate().AsDecimal() * RootSmoothingSeconds * 0.5));
		const TArray<FVector> Smoothed = bLoop ? StraightLoopTranslations(Root) : SmoothedTranslations(Root, HalfWindow);
		const TArray<double> Yaws = UnwrappedYaws(Root);
		const TArray<double> SmoothYaws = bLoop ? ConstantLoopYaws(Yaws) : SmoothedYaws(Yaws, HalfWindow);
		TArray<FTransform> NewRoot = Root;
		for (int32 Frame = 0; Frame < Root.Num(); ++Frame)
		{
			NewRoot[Frame].SetTranslation(Smoothed[Frame]);
			NewRoot[Frame].SetRotation(FQuat(FRotator(0.0, SmoothYaws[Frame], 0.0)));
		}

		IAnimationDataController& Controller = Sequence->GetController();
		IAnimationDataController::FScopedBracket Bracket(Controller, FText::FromString(TEXT("Smooth root motion")), false);
		for (int32 Bone = 1; Bone < Skeleton.GetNum(); ++Bone)
		{
			const FName ChildName = Skeleton.GetBoneName(Bone);
			if (Skeleton.GetParentIndex(Bone) != 0 || !Model->IsValidBoneTrackName(ChildName))
			{
				continue;
			}
			TArray<FTransform> Child;
			Model->GetBoneTrackTransforms(ChildName, Child);
			TArray<FVector> Positions;
			TArray<FQuat> Rotations;
			TArray<FVector> Scales;
			for (int32 Frame = 0; Frame < Child.Num() && Frame < Root.Num(); ++Frame)
			{
				const FTransform World = Child[Frame] * Root[Frame];
				const FTransform Local = World.GetRelativeTransform(NewRoot[Frame]);
				Positions.Add(Local.GetTranslation());
				Rotations.Add(Local.GetRotation());
				Scales.Add(Local.GetScale3D());
			}
			Controller.SetBoneTrackKeys(ChildName, Positions, Rotations, Scales, false);
		}
		TArray<FVector> RootPositions;
		TArray<FQuat> RootRotations;
		TArray<FVector> RootScales;
		for (const FTransform& Key : NewRoot)
		{
			RootPositions.Add(Key.GetTranslation());
			RootRotations.Add(Key.GetRotation());
			RootScales.Add(Key.GetScale3D());
		}
		Controller.SetBoneTrackKeys(RootName, RootPositions, RootRotations, RootScales, false);
	}

	TSharedRef<FJsonObject> Failure(const FString& Message)
	{
		UE_LOGF(LogVgeRetarget, Error, "%ls", *Message);
		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("error"), Message);
		return Report;
	}
}

void VgeRetargeter::FinishSequence(UAnimSequence* Sequence, const TSharedPtr<FJsonObject>& Request, bool bRootFromPelvis)
{
	Sequence->Modify();
	const bool bLoop = IsSeamlessLoop(Sequence);
	if (bRootFromPelvis)
	{
		SmoothRootTrack(Sequence, bLoop);
	}
	const TArray<TSharedPtr<FJsonValue>>* SpeedCurves = nullptr;
	if (Request->TryGetArrayField(TEXT("speedCurves"), SpeedCurves))
	{
		AddSpeedCurves(Sequence, *SpeedCurves);
	}
	Sequence->bLoop = bLoop;
	Sequence->bEnableRootMotion = true;
	Sequence->bForceRootLock = true;
	const TSharedPtr<FJsonObject>* SequenceFields = nullptr;
	if (Request->TryGetObjectField(TEXT("sequence"), SequenceFields))
	{
		FJsonObjectConverter::JsonObjectToUStruct((*SequenceFields).ToSharedRef(), UAnimSequence::StaticClass(), Sequence, 0, 0);
	}
	Sequence->PostEditChange();
}

TSharedRef<FJsonObject> VgeRetargeter::Retarget(const TSharedPtr<FJsonObject>& Request)
{
	const FString SourcePath = Request->GetStringField(TEXT("source"));
	const FString TargetPath = Request->GetStringField(TEXT("target"));
	const FString Dest = Request->GetStringField(TEXT("dest"));
	USkeletalMesh* SourceMesh = LoadObject<USkeletalMesh>(nullptr, *SourcePath);
	USkeletalMesh* TargetMesh = LoadObject<USkeletalMesh>(nullptr, *TargetPath);
	if (!SourceMesh || !TargetMesh)
	{
		return Failure(FString::Printf(TEXT("skeletal mesh not found: %s"), SourceMesh ? *TargetPath : *SourcePath));
	}

	FIKRetargetBatchOperationInputs Inputs;
	TArray<FString> AnimationPaths;
	const TArray<TSharedPtr<FJsonValue>>* Listed = nullptr;
	if (Request->TryGetArrayField(TEXT("animations"), Listed))
	{
		for (const TSharedPtr<FJsonValue>& Value : *Listed)
		{
			AnimationPaths.Add(Value->AsString());
		}
	}
	// Or every animation asset under a content folder (a character's whole set: sequences, blend spaces, montages).
	FString AnimationFolder;
	if (Request->TryGetStringField(TEXT("animationFolder"), AnimationFolder))
	{
		TArray<FAssetData> Found;
		FAssetRegistryModule::GetRegistry().ScanPathsSynchronous({ AnimationFolder }, /*bForceRescan*/ false);
		FAssetRegistryModule::GetRegistry().GetAssetsByPath(FName(*AnimationFolder), Found, /*bRecursive*/ true);
		for (const FAssetData& Asset : Found)
		{
			if (Asset.IsInstanceOf(UAnimationAsset::StaticClass()))
			{
				AnimationPaths.Add(Asset.GetObjectPathString());
			}
		}
	}
	for (const FString& Path : AnimationPaths)
	{
		UAnimationAsset* Animation = LoadObject<UAnimationAsset>(nullptr, *Path);
		if (!Animation)
		{
			return Failure(FString::Printf(TEXT("animation not found: %s"), *Path));
		}
		Inputs.AssetsToRetarget.Add(FAssetData(Animation));
	}
	if (Inputs.AssetsToRetarget.IsEmpty())
	{
		return Failure(TEXT("no animation to retarget"));
	}

	FAutoCharacterizeResults SourceCharacterization;
	FAutoCharacterizeResults TargetCharacterization;
	TStrongObjectPtr<UIKRigDefinition> SourceRig(AutoGenerateIKRig(SourceMesh, SourceCharacterization));
	TStrongObjectPtr<UIKRigDefinition> TargetRig(AutoGenerateIKRig(TargetMesh, TargetCharacterization));
	TStrongObjectPtr<UIKRetargeter> Retargeter(AutoGenerateRetargeter(SourceRig.Get(), TargetRig.Get(), SourceCharacterization, TargetCharacterization));

	Inputs.SourceMesh = SourceMesh;
	Inputs.TargetMesh = TargetMesh;
	Inputs.IKRetargetAsset = Retargeter.Get();
	Inputs.TargetPath = Dest / TEXT("");
	Inputs.bOverwriteExistingFiles = true;
	Inputs.bIncludeReferencedAssets = false;
	const TArray<FAssetData> Retargeted = UIKRetargetBatchOperation::RunBatchRetarget(Inputs);
	const bool bRootFromPelvis = GeneratesRootFromPelvis(SourceRig.Get(), TargetRig.Get(), SourceCharacterization, TargetCharacterization);

	TArray<TSharedPtr<FJsonValue>> Objects;
	TArray<UPackage*> Packages;
	for (const FAssetData& Asset : Retargeted)
	{
		UObject* Object = Asset.GetAsset();
		if (!Object)
		{
			continue;
		}
		if (UAnimSequence* Sequence = Cast<UAnimSequence>(Object))
		{
			FinishSequence(Sequence, Request, bRootFromPelvis);
		}
		Packages.AddUnique(Object->GetPackage());
		TSharedPtr<FJsonObject> Entry = MakeShared<FJsonObject>();
		Entry->SetStringField(TEXT("path"), Object->GetPathName());
		Entry->SetStringField(TEXT("class"), Object->GetClass()->GetName());
		Objects.Add(MakeShared<FJsonValueObject>(Entry));
		UE_LOGF(LogVgeRetarget, Display, "Retargeted %ls", *Object->GetPathName());
	}
	const bool bSaved = Packages.Num() > 0 && UEditorLoadingAndSavingUtils::SavePackages(Packages, false);
	if (!bSaved)
	{
		return Failure(FString::Printf(TEXT("nothing retargeted from %s to %s"), *SourcePath, *TargetPath));
	}

	TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
	Report->SetStringField(TEXT("dest"), Dest);
	Report->SetBoolField(TEXT("saved"), true);
	Report->SetArrayField(TEXT("objects"), Objects);
	TArray<TSharedPtr<FJsonValue>> Chains;
	for (const FBoneChain& Chain : TargetRig->GetRetargetChains())
	{
		Chains.Add(MakeShared<FJsonValueString>(Chain.ChainName.ToString()));
	}
	Report->SetArrayField(TEXT("targetChains"), Chains);
	return Report;
}
