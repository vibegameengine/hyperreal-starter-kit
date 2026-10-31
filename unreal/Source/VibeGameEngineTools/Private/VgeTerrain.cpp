#include "VgeTerrain.h"

#include "Engine/World.h"
#include "FileHelpers.h"
#include "Landscape.h"
#include "LandscapeInfo.h"
#include "LandscapeLayerInfoObject.h"
#include "LandscapeGrassType.h"
#include "LandscapeProxy.h"
#include "MaterialEditingLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpressionLandscapeGrassOutput.h"
#include "Materials/MaterialExpressionLandscapeLayerSample.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Materials/MaterialInterface.h"
#include "Engine/StaticMesh.h"
#include "Misc/Base64.h"
#include "Misc/PackageName.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"

namespace
{
	bool ReadVector(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, FVector& Out)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (!Object->TryGetArrayField(Field, Items) || Items->Num() != 3)
		{
			return false;
		}
		Out = FVector((*Items)[0]->AsNumber(), (*Items)[1]->AsNumber(), (*Items)[2]->AsNumber());
		return true;
	}

	bool Decode(const FString& Base64, TArray<uint8>& Out)
	{
		return FBase64::Decode(Base64, Out);
	}

	ULandscapeLayerInfoObject* CreateLayerInfo(const FString& Folder, const FName& LayerName)
	{
		const FString AssetName = FString::Printf(TEXT("LayerInfo_%s"), *LayerName.ToString());
		UPackage* Package = CreatePackage(*FString::Printf(TEXT("%s/%s"), *Folder, *AssetName));
		ULandscapeLayerInfoObject* LayerInfo = NewObject<ULandscapeLayerInfoObject>(Package, *AssetName, RF_Public | RF_Standalone);
		LayerInfo->SetLayerName(LayerName, false);
		LayerInfo->MarkPackageDirty();
		return LayerInfo;
	}

	ULandscapeGrassType* CreateGrassType(const FString& Folder, const TSharedPtr<FJsonObject>& Grass, int32 Index, FString& Error)
	{
		const FString Layer = Grass->GetStringField(TEXT("layer"));
		const FString MeshPath = Grass->GetStringField(TEXT("mesh"));
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath);
		if (!Mesh)
		{
			Error = FString::Printf(TEXT("grass on %s: no static mesh %s"), *Layer, *MeshPath);
			return nullptr;
		}
		const FString AssetName = FString::Printf(TEXT("Grass_%s_%d"), *Layer, Index);
		UPackage* Package = CreatePackage(*FString::Printf(TEXT("%s/%s"), *Folder, *AssetName));
		ULandscapeGrassType* GrassType = NewObject<ULandscapeGrassType>(Package, *AssetName, RF_Public | RF_Standalone);
		FGrassVariety Variety;
		Variety.GrassMesh = Mesh;
		FString MaterialPath;
		if (Grass->TryGetStringField(TEXT("material"), MaterialPath) && !MaterialPath.IsEmpty())
		{
			UMaterialInterface* Override = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
			if (!Override)
			{
				Error = FString::Printf(TEXT("grass on %s: no material %s"), *Layer, *MaterialPath);
				return nullptr;
			}
			Variety.OverrideMaterials.Add(Override);
		}
		Variety.GrassDensity.Default = static_cast<float>(Grass->GetNumberField(TEXT("density")));
		Variety.StartCullDistance.Default = static_cast<int32>(Grass->GetNumberField(TEXT("startCull")));
		Variety.EndCullDistance.Default = static_cast<int32>(Grass->GetNumberField(TEXT("endCull")));
		Variety.Scaling = EGrassScaling::Uniform;
		const TArray<TSharedPtr<FJsonValue>>* Scale = nullptr;
		if (Grass->TryGetArrayField(TEXT("scale"), Scale) && Scale->Num() == 2)
		{
			Variety.ScaleX = FFloatInterval(static_cast<float>((*Scale)[0]->AsNumber()), static_cast<float>((*Scale)[1]->AsNumber()));
		}
		Variety.RandomRotation = true;
		Variety.AlignToSurface = true;
		Variety.bUseGrid = true;
		Variety.PlacementJitter = 1.0f;
		Variety.bCastDynamicShadow = false;
		GrassType->GrassVarieties.Add(Variety);
		GrassType->MarkPackageDirty();
		return GrassType;
	}

	UMaterialInterface* MaterialWithGrass(UMaterialInterface* Material, const FString& Folder, const TArray<TPair<FName, ULandscapeGrassType*>>& Grass)
	{
		UMaterial* Base = Material->GetMaterial();
		UPackage* Package = CreatePackage(*FString::Printf(TEXT("%s/TerrainMaterial"), *Folder));
		UMaterial* Copy = DuplicateObject<UMaterial>(Base, Package, TEXT("TerrainMaterial"));
		Copy->SetFlags(RF_Public | RF_Standalone);
		UMaterialExpressionLandscapeGrassOutput* Output = Cast<UMaterialExpressionLandscapeGrassOutput>(UMaterialEditingLibrary::CreateMaterialExpression(Copy, UMaterialExpressionLandscapeGrassOutput::StaticClass(), 0, 600));
		Output->GrassTypes.Reset();
		for (const TPair<FName, ULandscapeGrassType*>& Entry : Grass)
		{
			UMaterialExpressionLandscapeLayerSample* Sample = Cast<UMaterialExpressionLandscapeLayerSample>(UMaterialEditingLibrary::CreateMaterialExpression(Copy, UMaterialExpressionLandscapeLayerSample::StaticClass(), -300, 600));
			Sample->ParameterName = Entry.Key;
			FGrassInput& Input = Output->GrassTypes.AddDefaulted_GetRef();
			Input.Name = Entry.Value->GetFName();
			Input.GrassType = Entry.Value;
			Input.Input.Connect(0, Sample);
		}
		UMaterialEditingLibrary::RecompileMaterial(Copy);
		Copy->MarkPackageDirty();
		UMaterialInstanceConstant* Instance = Cast<UMaterialInstanceConstant>(Material);
		if (!Instance)
		{
			return Copy;
		}
		UMaterialInstanceConstant* InstanceCopy = DuplicateObject<UMaterialInstanceConstant>(Instance, Package, TEXT("TerrainMaterialInstance"));
		InstanceCopy->SetFlags(RF_Public | RF_Standalone);
		InstanceCopy->SetParentEditorOnly(Copy);
		InstanceCopy->PostEditChange();
		return InstanceCopy;
	}
}

TSharedRef<FJsonObject> VgeTerrain::Build(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString AssetPath = Request->GetStringField(TEXT("path"));
	const FString Folder = FPackageName::GetLongPackagePath(AssetPath);
	const FString AssetName = FPackageName::GetShortName(AssetPath);
	const int32 Components = static_cast<int32>(Request->GetNumberField(TEXT("components")));
	const int32 Sections = static_cast<int32>(Request->GetNumberField(TEXT("sectionsPerComponent")));
	const int32 Quads = static_cast<int32>(Request->GetNumberField(TEXT("quadsPerSection")));
	const int32 Verts = Components * Sections * Quads + 1;

	TArray<uint8> HeightBytes;
	if (!Decode(Request->GetStringField(TEXT("heights")), HeightBytes) || HeightBytes.Num() != Verts * Verts * 2)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("heights: %d bytes, %d x %d vertices take %d"), HeightBytes.Num(), Verts, Verts, Verts * Verts * 2));
		return Result;
	}
	TArray<uint16> Heights;
	Heights.SetNumUninitialized(Verts * Verts);
	FMemory::Memcpy(Heights.GetData(), HeightBytes.GetData(), HeightBytes.Num());

	FVector Scale(100.0, 100.0, 100.0);
	ReadVector(Request, TEXT("scale"), Scale);

	UMaterialInterface* Material = nullptr;
	FString MaterialPath;
	if (Request->TryGetStringField(TEXT("material"), MaterialPath) && !MaterialPath.IsEmpty())
	{
		Material = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
		if (!Material)
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no material %s"), *MaterialPath));
			return Result;
		}
	}

	TArray<FLandscapeImportLayerInfo> Layers;
	TArray<UPackage*> LayerPackages;
	const TArray<TSharedPtr<FJsonValue>>* LayerItems = nullptr;
	if (Request->TryGetArrayField(TEXT("layers"), LayerItems))
	{
		for (const TSharedPtr<FJsonValue>& Item : *LayerItems)
		{
			const TSharedPtr<FJsonObject> Layer = Item->AsObject();
			const FName LayerName(*Layer->GetStringField(TEXT("name")));
			FLandscapeImportLayerInfo ImportLayer(LayerName);
			if (!Decode(Layer->GetStringField(TEXT("weights")), ImportLayer.LayerData) || ImportLayer.LayerData.Num() != Verts * Verts)
			{
				Result->SetStringField(TEXT("error"), FString::Printf(TEXT("layer %s: %d weights, %d x %d vertices take %d"), *LayerName.ToString(), ImportLayer.LayerData.Num(), Verts, Verts, Verts * Verts));
				return Result;
			}
			ImportLayer.LayerInfo = CreateLayerInfo(Folder, LayerName);
			LayerPackages.Add(ImportLayer.LayerInfo->GetPackage());
			Layers.Add(MoveTemp(ImportLayer));
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* GrassItems = nullptr;
	if (Material && Request->TryGetArrayField(TEXT("grass"), GrassItems) && GrassItems->Num() > 0)
	{
		TArray<TPair<FName, ULandscapeGrassType*>> Grass;
		for (const TSharedPtr<FJsonValue>& Item : *GrassItems)
		{
			FString Error;
			ULandscapeGrassType* GrassType = CreateGrassType(Folder, Item->AsObject(), Grass.Num(), Error);
			if (!GrassType)
			{
				Result->SetStringField(TEXT("error"), Error);
				return Result;
			}
			Grass.Add({ FName(*Item->AsObject()->GetStringField(TEXT("layer"))), GrassType });
			LayerPackages.Add(GrassType->GetPackage());
		}
		Material = MaterialWithGrass(Material, Folder, Grass);
		LayerPackages.Add(Material->GetPackage());
	}

	UPackage* Package = CreatePackage(*AssetPath);
	UWorld* World = UWorld::CreateWorld(EWorldType::Editor, false, FName(*AssetName), Package);
	World->SetFlags(RF_Public | RF_Standalone);

	FActorSpawnParameters Spawn;
	Spawn.Name = TEXT("Terrain");
	const FVector Origin(-(Verts - 1) * Scale.X * 0.5, -(Verts - 1) * Scale.Y * 0.5, 0.0);
	ALandscape* Landscape = World->SpawnActor<ALandscape>(Origin, FRotator::ZeroRotator, Spawn);
	Landscape->SetActorScale3D(Scale);
	Landscape->LandscapeMaterial = Material;
	bool bRuntimeMaterialParameters = false;
	Request->TryGetBoolField(TEXT("runtimeMaterialParameters"), bRuntimeMaterialParameters);
	Landscape->bUseDynamicMaterialInstance = bRuntimeMaterialParameters;

	TMap<FGuid, TArray<uint16>> HeightsPerLayer;
	HeightsPerLayer.Add(FGuid(), MoveTemp(Heights));
	TMap<FGuid, TArray<FLandscapeImportLayerInfo>> LayersPerLayer;
	LayersPerLayer.Add(FGuid(), Layers);
	Landscape->Import(FGuid::NewGuid(), 0, 0, Verts - 1, Verts - 1, Sections, Quads, HeightsPerLayer, nullptr, LayersPerLayer, ELandscapeImportAlphamapType::Additive, TArrayView<const FLandscapeLayer>());
	Landscape->CreateLandscapeInfo();
	const int32 ComponentCount = Landscape->LandscapeComponents.Num();

	const bool bLayersSaved = LayerPackages.IsEmpty() || UEditorLoadingAndSavingUtils::SavePackages(LayerPackages, false);
	const bool bSaved = UEditorLoadingAndSavingUtils::SaveMap(World, AssetPath);
	World->DestroyWorld(false);
	World->RemoveFromRoot();

	Result->SetBoolField(TEXT("saved"), bSaved && bLayersSaved);
	Result->SetNumberField(TEXT("vertices"), Verts);
	Result->SetNumberField(TEXT("components"), ComponentCount);
	if (!bSaved || !bLayersSaved)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s was not saved; see the service log"), *AssetPath));
	}
	return Result;
}
