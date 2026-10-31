#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

// Retargets animations from one skeletal mesh's skeleton to another's, inside the content service: the steps the
// editor's Retarget Animations window takes with "Auto Generate Retargeter" (SRetargetAnimAssetsWindow.cpp,
// FProceduralRetargetAssets), then its batch duplicate-and-retarget (UIKRetargetBatchOperation).
namespace VgeRetargeter
{
	// Request: source, target (skeletal mesh object paths), animations (animation object paths on the source's
	// skeleton) and/or animationFolder (every sequence under that content folder), dest (content folder for the
	// retargeted copies). Report: the new animations, saved.
	TSharedRef<FJsonObject> Retarget(const TSharedPtr<FJsonObject>& Request);

	void FinishSequence(class UAnimSequence* Sequence, const TSharedPtr<FJsonObject>& Request, bool bRootFromPelvis);
}
