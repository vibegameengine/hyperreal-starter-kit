#include "VgeRetargeter.h"

#include "Animation/AnimSequence.h"
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

	TSharedRef<FJsonObject> Failure(const FString& Message)
	{
		UE_LOGF(LogVgeRetarget, Error, "%ls", *Message);
		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("error"), Message);
		return Report;
	}
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
			Sequence->Modify();
			Sequence->bEnableRootMotion = true;
			Sequence->bForceRootLock = true;
			Sequence->PostEditChange();
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
