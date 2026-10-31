#include "VgeGroom.h"

#include "Engine/SkeletalMesh.h"
#include "GroomAsset.h"
#include "GroomBindingAsset.h"
#include "GroomBindingCompiler.h"
#include "HairStrandsCore.h"

TSharedRef<FJsonObject> VgeGroom::Bind(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString GroomPath = Request->GetStringField(TEXT("groom"));
	const FString MeshPath = Request->GetStringField(TEXT("skeletalMesh"));
	const FString PackagePath = Request->GetStringField(TEXT("path"));
	UGroomAsset* Groom = LoadObject<UGroomAsset>(nullptr, *GroomPath);
	USkeletalMesh* Mesh = LoadObject<USkeletalMesh>(nullptr, *MeshPath);
	if (!Groom || !Mesh)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no %s %s"), Groom ? TEXT("skeletal mesh") : TEXT("groom"), Groom ? *MeshPath : *GroomPath));
		return Result;
	}
	int32 InterpolationPoints = 100;
	Request->TryGetNumberField(TEXT("interpolationPoints"), InterpolationPoints);
	UGroomBindingAsset* Binding = FHairStrandsCore::CreateGroomBindingAsset(EGroomBindingMeshType::SkeletalMesh, PackagePath, nullptr, Groom, nullptr, Mesh, InterpolationPoints, -1);
	if (!Binding)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("could not bind %s to %s"), *GroomPath, *MeshPath));
		return Result;
	}
	Binding->Build();
	FGroomBindingCompilingManager::Get().FinishCompilation({ Binding });
	if (!Binding->IsValid())
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("the binding of %s to %s did not build; see the service log"), *GroomPath, *MeshPath));
		return Result;
	}
	Binding->MarkPackageDirty();
	Result->SetStringField(TEXT("binding"), Binding->GetPathName());
	return Result;
}
