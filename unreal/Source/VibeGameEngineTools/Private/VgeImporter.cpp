#include "VgeImporter.h"

#include "AssetImportTask.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "Animation/Skeleton.h"
#include "Engine/SkeletalMesh.h"
#include "VgeCloth.h"
#include "VgeRagdoll.h"
#include "Engine/StaticMesh.h"
#include "InterchangeGenericAssetsPipeline.h"
#include "InterchangeGenericAssetsPipelineSharedSettings.h"
#include "InterchangeManager.h"
#include "FileHelpers.h"
#include "HAL/FileManager.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Misc/PackageName.h"
#include "ObjectTools.h"
#include "UObject/UObjectGlobals.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeImport, Log, All);

const TArray<VgeImporter::FMasterSet>& VgeImporter::MasterSets()
{
	static const TArray<FMasterSet> Sets = {
		{ TEXT("/InterchangeAssets/gltf"), TEXT("/Game/Vge/Materials/Gltf"),
			{ TEXT("M_Default"), TEXT("M_ClearCoat"), TEXT("M_Sheen"), TEXT("M_SpecularGlossiness"), TEXT("M_Transmission"), TEXT("M_Unlit") }, true },
		// The surface masters of the Interchange FBX (and OBJ, USD, MaterialX) pipelines; DecalMaterial is a decal
		// domain and never on a mesh, CommonMaterial and CommonMaterialWithUVTransform are material functions.
		{ TEXT("/InterchangeAssets/Materials"), TEXT("/Game/Vge/Materials/Interchange"),
			{ TEXT("ClearCoatMaterial_MR"), TEXT("ClearCoatMaterial_SG"),
				TEXT("FBXLegacyLambertSurfaceMaterial"), TEXT("FBXLegacyLambertSurfaceMaterialBump"), TEXT("FBXLegacyPhongSurfaceMaterial"),
				TEXT("FBXLegacyPhongSurfaceMaterialBump"), TEXT("LambertSurfaceMaterial"), TEXT("LambertSurfaceMaterialWithUVTransform"),
				TEXT("OrenNayerMaterial"), TEXT("PBRSurfaceMaterial_MR"), TEXT("PBRSurfaceMaterial_SG"), TEXT("PhongSurfaceMaskMaterial"),
				TEXT("PhongSurfaceMaskMaterialWithUVTransform"), TEXT("PhongSurfaceMaterial"), TEXT("PhongSurfaceMaterialWithUVTransform"),
				TEXT("PhongSurfaceTranslucentMaterial"), TEXT("PhongSurfaceTranslucentMaterialWithUVTransform"), TEXT("SheenMaterial_MR"),
				TEXT("SheenMaterial_SG"), TEXT("SubsurfaceMaterial_MR"), TEXT("SubsurfaceMaterial_SG"), TEXT("ThinTranslucentMaterial_MR"),
				TEXT("ThinTranslucentMaterial_SG"), TEXT("UnlitMaterial") }, false },
	};
	return Sets;
}

UMaterial* VgeImporter::FindProjectMaster(const UMaterial* InterchangeMaster)
{
	if (!InterchangeMaster)
	{
		return nullptr;
	}
	const FString Path = InterchangeMaster->GetPathName();
	for (const FMasterSet& Set : MasterSets())
	{
		if (Path.StartsWith(FString(Set.SourcePath) / TEXT("")))
		{
			const FString Name = InterchangeMaster->GetName();
			return LoadObject<UMaterial>(nullptr, *FString::Printf(TEXT("%s/%s.%s"), Set.ProjectPath, *Name, *Name), nullptr, LOAD_NoWarn);
		}
	}
	return nullptr;
}

namespace
{
	bool IsInterchangeMaster(const UMaterial* Material)
	{
		return Material && VgeImporter::MasterSets().ContainsByPredicate([Material](const VgeImporter::FMasterSet& Set) { return Material->GetPathName().StartsWith(FString(Set.SourcePath) / TEXT("")); });
	}

	FMaterialInstanceBasePropertyOverrides InheritedBaseOverrides(const UMaterialInstanceConstant* Instance, const UMaterialInstance* FormerParent)
	{
		FMaterialInstanceBasePropertyOverrides Overrides = Instance->BasePropertyOverrides;
		if (!FormerParent)
		{
			return Overrides;
		}
		const UScriptStruct* Struct = FMaterialInstanceBasePropertyOverrides::StaticStruct();
		void* Own = &Overrides;
		const void* Inherited = &FormerParent->BasePropertyOverrides;
		for (TFieldIterator<FBoolProperty> Flag(Struct); Flag; ++Flag)
		{
			const FString FlagName = Flag->GetName();
			if (!FlagName.StartsWith(TEXT("bOverride_")) || !Flag->GetPropertyValue_InContainer(Inherited) || Flag->GetPropertyValue_InContainer(Own))
			{
				continue;
			}
			const FProperty* Value = Struct->FindPropertyByName(FName(*FlagName.RightChop(10)));
			if (const FBoolProperty* Switch = CastField<FBoolProperty>(Value))
			{
				Switch->SetPropertyValue_InContainer(Own, Switch->GetPropertyValue_InContainer(Inherited));
			}
			else if (Value)
			{
				Value->CopyCompleteValue_InContainer(Own, Inherited);
			}
			if (Value)
			{
				Flag->SetPropertyValue_InContainer(Own, true);
			}
		}
		return Overrides;
	}
}

namespace
{
	// Runs one automated import task; Options is null for the project's default pipeline stack.
	TArray<UObject*> RunImportTask(const FString& Source, const FString& Dest, UObject* Options)
	{
		UAssetImportTask* Task = NewObject<UAssetImportTask>();
		Task->AddToRoot();
		Task->Filename = Source;
		Task->DestinationPath = Dest;
		Task->bAutomated = true;
		Task->bReplaceExisting = true;
		Task->bSave = false;
		Task->Options = Options;
		FAssetToolsModule::GetModule().Get().ImportAssetTasks({ Task });
		TArray<UObject*> Objects = Task->GetObjects();
		Task->RemoveFromRoot();
		return Objects;
	}

	TSharedRef<FJsonObject> SaveAndReport(const TArray<UObject*>& Imported, const FString& Source, const FString& Dest)
	{
		TArray<TSharedPtr<FJsonValue>> Objects;
		TArray<UPackage*> Packages;
		for (UObject* Object : Imported)
		{
			if (!Object)
			{
				continue;
			}
			Packages.AddUnique(Object->GetPackage());
			TSharedPtr<FJsonObject> Entry = MakeShared<FJsonObject>();
			Entry->SetStringField(TEXT("path"), Object->GetPathName());
			Entry->SetStringField(TEXT("class"), Object->GetClass()->GetName());
			Objects.Add(MakeShared<FJsonValueObject>(Entry));
			UE_LOGF(LogVgeImport, Display, "Imported %ls (%ls)", *Object->GetPathName(), *Object->GetClass()->GetName());
		}

		const bool bSaved = Packages.Num() > 0 && UEditorLoadingAndSavingUtils::SavePackages(Packages, false);
		if (!bSaved)
		{
			UE_LOGF(LogVgeImport, Error, "Nothing imported or saved from %ls", *Source);
		}

		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("source"), Source);
		Report->SetStringField(TEXT("dest"), Dest);
		Report->SetBoolField(TEXT("saved"), bSaved);
		Report->SetArrayField(TEXT("objects"), Objects);
		return Report;
	}
}

TSharedRef<FJsonObject> VgeImporter::ImportSound(const FString& Source, const FString& Dest)
{
	return SaveAndReport(RunImportTask(Source, Dest, nullptr), Source, Dest);
}

TSharedRef<FJsonObject> VgeImporter::ImportAnimations(const FString& Source, const FString& Dest, const FString& SkeletonPath)
{
	USkeleton* Skeleton = LoadObject<USkeleton>(nullptr, *SkeletonPath);
	if (!Skeleton)
	{
		TSharedRef<FJsonObject> Report = MakeShared<FJsonObject>();
		Report->SetStringField(TEXT("error"), FString::Printf(TEXT("skeleton %s not found"), *SkeletonPath));
		return Report;
	}
	// A transient generic pipeline as the whole stack, the way InterchangeMeshUtilities overrides it.
	UInterchangeGenericAssetsPipeline* Pipeline = NewObject<UInterchangeGenericAssetsPipeline>(GetTransientPackage());
	Pipeline->ClearFlags(RF_Standalone | RF_Public);
	Pipeline->CommonSkeletalMeshesAndAnimationsProperties->bImportOnlyAnimations = true;
	Pipeline->CommonSkeletalMeshesAndAnimationsProperties->Skeleton = Skeleton;
	UInterchangePipelineStackOverride* Override = NewObject<UInterchangePipelineStackOverride>();
	Override->AddPipeline(Pipeline);
	Pipeline->AddToRoot();
	const TArray<UObject*> Imported = RunImportTask(Source, Dest, Override);
	Pipeline->RemoveFromRoot();
	return SaveAndReport(Imported, Source, Dest);
}

namespace
{
	void ApplyMeshSettings(UStaticMesh* Mesh, const TSharedPtr<FJsonObject>& MeshSettings)
	{
		bool bNanite = true;
		if (MeshSettings)
		{
			MeshSettings->TryGetBoolField(TEXT("nanite"), bNanite);
		}
		FMeshNaniteSettings Settings = Mesh->GetNaniteSettings();
		Settings.bEnabled = bNanite;
		Mesh->SetNaniteSettings(Settings);

		const TArray<TSharedPtr<FJsonValue>>* Lods = nullptr;
		if (bNanite || !MeshSettings || !MeshSettings->TryGetArrayField(TEXT("lods"), Lods))
		{
			return;
		}
		Mesh->SetNumSourceModels(Lods->Num() + 1);
		for (int32 Index = 0; Index < Lods->Num(); ++Index)
		{
			const TSharedPtr<FJsonObject> Lod = (*Lods)[Index]->AsObject();
			FStaticMeshSourceModel& Model = Mesh->GetSourceModel(Index + 1);
			Model.ReductionSettings.PercentTriangles = static_cast<float>(Lod->GetNumberField(TEXT("triangles")));
			Model.ScreenSize.Default = static_cast<float>(Lod->GetNumberField(TEXT("screenSize")));
		}
		Mesh->SetAutoComputeLODScreenSize(false);
	}
}

namespace
{
	TSharedRef<FJsonObject> FinishImport(const TArray<UObject*>& Imported, const FString& Source, const FString& Dest, const TSharedPtr<FJsonObject>& Cloth, const TSharedPtr<FJsonObject>& MeshSettings);
}

TSharedRef<FJsonObject> VgeImporter::Import(const FString& Source, const FString& Dest, const TSharedPtr<FJsonObject>& Cloth, const TSharedPtr<FJsonObject>& MeshSettings)
{
	return FinishImport(RunImportTask(Source, Dest, nullptr), Source, Dest, Cloth, MeshSettings);
}

TArray<TSharedRef<FJsonObject>> VgeImporter::ImportMany(const TArray<FImportRequest>& Requests)
{
	TArray<UAssetImportTask*> Tasks;
	for (const FImportRequest& Request : Requests)
	{
		UAssetImportTask* Task = NewObject<UAssetImportTask>();
		Task->AddToRoot();
		Task->Filename = Request.Source;
		Task->DestinationPath = Request.Dest;
		Task->bAutomated = true;
		Task->bReplaceExisting = true;
		Task->bSave = false;
		Task->bAsync = true;
		Tasks.Add(Task);
	}
	FAssetToolsModule::GetModule().Get().ImportAssetTasks(Tasks);
	TArray<TSharedRef<FJsonObject>> Reports;
	for (int32 Index = 0; Index < Tasks.Num(); ++Index)
	{
		const FImportRequest& Request = Requests[Index];
		Reports.Add(FinishImport(Tasks[Index]->GetObjects(), Request.Source, Request.Dest, Request.Cloth, Request.MeshSettings));
		Tasks[Index]->RemoveFromRoot();
	}
	return Reports;
}

namespace
{
TSharedRef<FJsonObject> FinishImport(const TArray<UObject*>& Imported, const FString& Source, const FString& Dest, const TSharedPtr<FJsonObject>& Cloth, const TSharedPtr<FJsonObject>& MeshSettings)
{
	// Material instances first, so meshes built below already see their final materials.
	for (UObject* Object : Imported)
	{
		UMaterialInstanceConstant* Instance = Cast<UMaterialInstanceConstant>(Object);
		UMaterial* InterchangeMaster = Instance && Instance->Parent ? Instance->Parent->GetMaterial() : nullptr;
		if (UMaterial* ProjectMaster = VgeImporter::FindProjectMaster(InterchangeMaster))
		{
			Instance->Modify();
			FMaterialInstanceBasePropertyOverrides Overrides = InheritedBaseOverrides(Instance, Cast<UMaterialInstance>(Instance->Parent));
			Instance->SetParentEditorOnly(ProjectMaster);
			Instance->UpdateStaticPermutation(Instance->GetStaticParameters(), Overrides);
			Instance->PostEditChange();
		}
		else if (IsInterchangeMaster(InterchangeMaster))
		{
			UE_LOGF(LogVgeImport, Error, "%ls uses %ls, which has no project copy; run -run=VgeMaterials", *Instance->GetPathName(), *InterchangeMaster->GetPathName());
		}
	}

	for (UObject* Object : Imported)
	{
		if (UStaticMesh* Mesh = Cast<UStaticMesh>(Object))
		{
			Mesh->Modify();
			ApplyMeshSettings(Mesh, MeshSettings);
			Mesh->PostEditChange();
		}
	}

	// A skeletal mesh's generated physics asset is built again as a ragdoll (VgeRagdoll.cpp says why), before saving.
	TArray<TSharedPtr<FJsonValue>> Ragdolls;
	for (UObject* Object : Imported)
	{
		if (USkeletalMesh* Mesh = Cast<USkeletalMesh>(Object); Mesh && Mesh->GetPhysicsAsset())
		{
			Ragdolls.Add(MakeShared<FJsonValueObject>(VgeRagdoll::Build(Mesh)));
		}
	}
	TArray<TSharedPtr<FJsonValue>> Cloths;
	for (UObject* Object : Imported)
	{
		if (USkeletalMesh* Mesh = Cast<USkeletalMesh>(Object); Mesh && Cloth.IsValid())
		{
			Cloths.Add(MakeShared<FJsonValueObject>(VgeCloth::Build(Mesh, Cloth)));
		}
	}
	TSharedRef<FJsonObject> Report = SaveAndReport(Imported, Source, Dest);
	if (Ragdolls.Num() > 0)
	{
		Report->SetArrayField(TEXT("ragdolls"), Ragdolls);
	}
	if (Cloths.Num() > 0)
	{
		Report->SetArrayField(TEXT("cloth"), Cloths);
	}
	return Report;
}
}

int32 VgeImporter::DeleteContentPath(const FString& ContentPath)
{
	IAssetRegistry& AssetRegistry = FAssetRegistryModule::GetRegistry();
	TArray<FAssetData> Assets;
	AssetRegistry.GetAssetsByPath(FName(*ContentPath), Assets, /*bRecursive*/ true);

	TArray<UObject*> Loaded;
	TSet<FName> PackageNames;
	for (const FAssetData& Asset : Assets)
	{
		PackageNames.Add(Asset.PackageName);
		if (UObject* Object = Asset.GetAsset())
		{
			Loaded.Add(Object);
		}
	}
	if (Loaded.Num() > 0)
	{
		ObjectTools::ForceDeleteObjects(Loaded, /*ShowConfirmation*/ false);
	}

	// ForceDeleteObjects removes what it loaded; anything left on disk under the path goes too.
	FString Directory;
	if (FPackageName::TryConvertLongPackageNameToFilename(ContentPath / TEXT(""), Directory))
	{
		IFileManager::Get().DeleteDirectory(*Directory, /*RequireExists*/ false, /*Tree*/ true);
		AssetRegistry.ScanPathsSynchronous({ ContentPath }, /*bForceRescan*/ true);
	}
	UE_LOGF(LogVgeImport, Display, "Deleted %d packages under %ls", PackageNames.Num(), *ContentPath);
	return PackageNames.Num();
}
