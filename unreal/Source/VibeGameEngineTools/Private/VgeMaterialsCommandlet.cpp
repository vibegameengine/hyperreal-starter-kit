#include "VgeMaterialsCommandlet.h"

#include "AssetToolsModule.h"
#include "FileHelpers.h"
#include "Materials/Material.h"
#include "VgeImporter.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeMaterials, Log, All);

int32 UVgeMaterialsCommandlet::Main(const FString& Params)
{
	static const EMaterialUsage Usages[] = { MATUSAGE_SkeletalMesh, MATUSAGE_MorphTargets, MATUSAGE_Nanite, MATUSAGE_InstancedStaticMeshes, MATUSAGE_Clothing, MATUSAGE_GeometryCollections };

	TArray<UPackage*> Packages;
	for (const VgeImporter::FMasterSet& Set : VgeImporter::MasterSets())
	{
		for (const FString& Name : Set.Names)
		{
			UMaterial* Source = LoadObject<UMaterial>(nullptr, *FString::Printf(TEXT("%s/%s.%s"), Set.SourcePath, *Name, *Name));
			if (!Source)
			{
				UE_LOGF(LogVgeMaterials, Error, "Interchange master %ls/%ls not found", Set.SourcePath, *Name);
				return 1;
			}
			UMaterial* Copy = VgeImporter::FindProjectMaster(Source);
			if (!Copy)
			{
				Copy = Cast<UMaterial>(FAssetToolsModule::GetModule().Get().DuplicateAsset(Name, Set.ProjectPath, Source));
			}
			if (!Copy)
			{
				UE_LOGF(LogVgeMaterials, Error, "Could not create the project copy of %ls", *Name);
				return 1;
			}
			TArray<FString> Refused;
			for (EMaterialUsage Usage : Usages)
			{
				Copy->SetMaterialUsage(Usage);
				if (!Copy->CheckMaterialUsage(Usage))
				{
					Refused.Add(FString::FromInt(static_cast<int32>(Usage)));
				}
			}
			if (!Refused.IsEmpty() && Set.bEveryUsage)
			{
				UE_LOGF(LogVgeMaterials, Error, "%ls refused usage %ls", *Copy->GetPathName(), *FString::Join(Refused, TEXT(", ")));
				return 1;
			}
			Packages.Add(Copy->GetPackage());
			UE_LOGF(LogVgeMaterials, Display, "%ls ready%ls", *Copy->GetPathName(), Refused.IsEmpty() ? TEXT(" with skeletal, morph target, Nanite, instancing, clothing and geometry collection usage") : *FString::Printf(TEXT(", refused usage %s"), *FString::Join(Refused, TEXT(", "))));
		}
	}
	return UEditorLoadingAndSavingUtils::SavePackages(Packages, false) ? 0 : 1;
}
