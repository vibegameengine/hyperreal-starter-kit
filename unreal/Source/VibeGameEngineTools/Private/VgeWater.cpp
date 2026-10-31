#include "VgeWater.h"

#include "Engine/World.h"
#include "JsonObjectConverter.h"
#include "WaterBodyActor.h"
#include "WaterBodyComponent.h"
#include "WaterBodyLakeActor.h"
#include "WaterBodyRiverActor.h"
#include "WaterBodyRiverComponent.h"
#include "WaterEditorSettings.h"
#include "WaterMeshComponent.h"
#include "WaterRuntimeSettings.h"
#include "WaterSplineComponent.h"
#include "WaterSplineMetadata.h"
#include "WaterWaves.h"
#include "WaterZoneActor.h"

namespace
{
	FVector ReadVector(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, const FVector& Default)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (!Object->TryGetArrayField(Field, Items) || Items->Num() < 2)
		{
			return Default;
		}
		return FVector((*Items)[0]->AsNumber(), (*Items)[1]->AsNumber(), Items->Num() > 2 ? (*Items)[2]->AsNumber() : 0.0);
	}

	bool ApplyFields(UObject* Target, const TSharedPtr<FJsonObject>& Owner, const TCHAR* Field, FString& Error)
	{
		const TSharedPtr<FJsonObject>* Fields = nullptr;
		if (!Owner->TryGetObjectField(Field, Fields))
		{
			return true;
		}
		if (!FJsonObjectConverter::JsonObjectToUStruct(Fields->ToSharedRef(), Target->GetClass(), Target, 0, 0))
		{
			Error = FString::Printf(TEXT("%s: %s did not fit %s"), Field, *Target->GetName(), *Target->GetClass()->GetName());
			return false;
		}
		return true;
	}

	AWaterZone* SpawnZone(UWorld* World, const TSharedPtr<FJsonObject>& Water, FString& Error)
	{
		AWaterZone* Zone = World->SpawnActor<AWaterZone>();
		const FWaterZoneActorDefaults& Defaults = GetDefault<UWaterEditorSettings>()->WaterZoneActorDefaults;
		Zone->GetWaterMeshComponent()->FarDistanceMaterial = Defaults.GetFarDistanceMaterial();
		Zone->GetWaterMeshComponent()->FarDistanceMeshExtent = Defaults.FarDistanceMeshExtent;
		Zone->SetRenderTargetResolution(Defaults.RenderTargetResolution);
		const TSharedPtr<FJsonObject>* ZoneJson = nullptr;
		if (Water->TryGetObjectField(TEXT("zone"), ZoneJson))
		{
			const FVector Extent = ReadVector(*ZoneJson, TEXT("extent"), FVector::ZeroVector);
			if (!Extent.IsNearlyZero())
			{
				Zone->SetZoneExtent(FVector2D(Extent.X, Extent.Y));
			}
			if (!ApplyFields(Zone, *ZoneJson, TEXT("fields"), Error))
			{
				return nullptr;
			}
		}
		return Zone;
	}

	const FWaterBodyDefaults* DefaultsOf(const FString& Type)
	{
		const UWaterEditorSettings* Settings = GetDefault<UWaterEditorSettings>();
		if (Type == TEXT("lake"))
		{
			return &Settings->WaterBodyLakeDefaults;
		}
		return Type == TEXT("river") ? &Settings->WaterBodyRiverDefaults : nullptr;
	}

	UClass* ClassOf(const FString& Type)
	{
		if (Type == TEXT("lake"))
		{
			return AWaterBodyLake::StaticClass();
		}
		return Type == TEXT("river") ? AWaterBodyRiver::StaticClass() : nullptr;
	}

	const UWaterWavesBase* DefaultWavesOf(const FString& Type)
	{
		return Type == TEXT("lake") ? GetDefault<UWaterEditorSettings>()->WaterBodyLakeDefaults.WaterWaves.Get() : nullptr;
	}

	void ApplyDefaults(AWaterBody* Body, const FString& Type)
	{
		UWaterBodyComponent* Component = Body->GetWaterBodyComponent();
		const FWaterBodyDefaults* Defaults = DefaultsOf(Type);
		const FWaterBrushActorDefaults& Brush = Type == TEXT("lake") ? GetDefault<UWaterEditorSettings>()->WaterBodyLakeDefaults.BrushDefaults : GetDefault<UWaterEditorSettings>()->WaterBodyRiverDefaults.BrushDefaults;
		Component->CurveSettings = Brush.CurveSettings;
		Component->WaterHeightmapSettings = Brush.HeightmapSettings;
		Component->LayerWeightmapSettings = Brush.LayerWeightmapSettings;
		Component->SetWaterMaterial(Defaults->GetWaterMaterial());
		Component->SetWaterStaticMeshMaterial(Defaults->GetWaterStaticMeshMaterial());
		Component->SetHLODMaterial(Defaults->GetWaterHLODMaterial());
		Component->SetUnderwaterPostProcessMaterial(Defaults->GetUnderwaterPostProcessMaterial());
		Component->SetWaterInfoMaterial(GetDefault<UWaterRuntimeSettings>()->GetDefaultWaterInfoMaterial());
		Body->GetWaterSpline()->WaterSplineDefaults = Defaults->SplineDefaults;
		if (UWaterBodyRiverComponent* River = Cast<UWaterBodyRiverComponent>(Component))
		{
			const FWaterBodyRiverDefaults& RiverDefaults = GetDefault<UWaterEditorSettings>()->WaterBodyRiverDefaults;
			River->SetLakeTransitionMaterial(RiverDefaults.GetRiverToLakeTransitionMaterial());
			River->SetOceanTransitionMaterial(RiverDefaults.GetRiverToOceanTransitionMaterial());
		}
	}

	bool ApplyWaves(AWaterBody* Body, const FString& Type, const TSharedPtr<FJsonObject>& Json, FString& Error)
	{
		bool bWaves = true;
		Json->TryGetBoolField(TEXT("waves"), bWaves);
		const UWaterWavesBase* Default = bWaves ? DefaultWavesOf(Type) : nullptr;
		if (!Default)
		{
			return true;
		}
		const UWaterWavesBase* Source = Json->HasField(TEXT("waveFields")) && Default->GetWaterWaves() ? Default->GetWaterWaves() : Default;
		UWaterWavesBase* Waves = DuplicateObject(Source, Body, MakeUniqueObjectName(Body, Source->GetClass(), TEXT("WaterWaves")));
		if (Source != Default && !ApplyFields(Waves, Json, TEXT("waveFields"), Error))
		{
			return false;
		}
		Body->SetWaterWaves(Waves);
		return true;
	}

	bool ApplyPoints(AWaterBody* Body, const TSharedPtr<FJsonObject>& Json, FString& Error)
	{
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		if (!Json->TryGetArrayField(TEXT("points"), Items) || Items->IsEmpty())
		{
			Error = TEXT("a water body needs points");
			return false;
		}
		const FVector Origin = Body->GetActorLocation();
		TArray<FVector> Points;
		for (const TSharedPtr<FJsonValue>& Item : *Items)
		{
			Points.Add(ReadVector(Item->AsObject(), TEXT("at"), FVector::ZeroVector) - Origin);
		}
		UWaterSplineComponent* Spline = Body->GetWaterSpline();
		Spline->ResetSpline(Points);
		UWaterSplineMetadata* Metadata = Body->GetWaterSplineMetadata();
		for (int32 Index = 0; Index < Items->Num(); ++Index)
		{
			const TSharedPtr<FJsonObject> Point = (*Items)[Index]->AsObject();
			double Value = 0.0;
			if (Point->TryGetNumberField(TEXT("width"), Value))
			{
				Metadata->RiverWidth.Points[Index].OutVal = static_cast<float>(Value);
			}
			if (Point->TryGetNumberField(TEXT("depth"), Value))
			{
				Metadata->Depth.Points[Index].OutVal = static_cast<float>(Value);
			}
			if (Point->TryGetNumberField(TEXT("velocity"), Value))
			{
				Metadata->WaterVelocityScalar.Points[Index].OutVal = static_cast<float>(Value);
			}
		}
		Spline->SynchronizeWaterProperties();
		return true;
	}

	AWaterBody* SpawnBody(UWorld* World, const TSharedPtr<FJsonObject>& Json, int32 Index, FString& Error)
	{
		const FString Type = Json->GetStringField(TEXT("type"));
		UClass* Class = ClassOf(Type);
		if (!Class)
		{
			Error = FString::Printf(TEXT("body %d: '%s' is not lake or river"), Index, *Type);
			return nullptr;
		}
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		const FVector Origin = Json->TryGetArrayField(TEXT("points"), Items) && !Items->IsEmpty() ? ReadVector((*Items)[0]->AsObject(), TEXT("at"), FVector::ZeroVector) : FVector::ZeroVector;
		AWaterBody* Body = World->SpawnActor<AWaterBody>(Class, FTransform(Origin));
		ApplyDefaults(Body, Type);
		if (!ApplyWaves(Body, Type, Json, Error) || !ApplyPoints(Body, Json, Error) || !ApplyFields(Body->GetWaterBodyComponent(), Json, TEXT("fields"), Error))
		{
			Error = FString::Printf(TEXT("body %d: %s"), Index, *Error);
			return nullptr;
		}
		return Body;
	}
}

bool VgeWater::Spawn(UWorld* World, const TSharedPtr<FJsonObject>& Water, FString& Error)
{
	AWaterZone* Zone = SpawnZone(World, Water, Error);
	if (!Zone)
	{
		return false;
	}
	TArray<AWaterBody*> Bodies;
	const TArray<TSharedPtr<FJsonValue>>& Items = Water->GetArrayField(TEXT("bodies"));
	for (int32 Index = 0; Index < Items.Num(); ++Index)
	{
		AWaterBody* Body = SpawnBody(World, Items[Index]->AsObject(), Index, Error);
		if (!Body)
		{
			return false;
		}
		Bodies.Add(Body);
	}
	for (AWaterBody* Body : Bodies)
	{
		FOnWaterBodyChangedParams Params;
		Params.bShapeOrPositionChanged = true;
		Params.bUserTriggered = true;
		UWaterBodyComponent* Component = Body->GetWaterBodyComponent();
		Component->OnWaterBodyChanged(Params);
		TGuardValue<bool> BuildsLikeCook(PRIVATE_GIsRunningCookCommandlet, true);
		Component->UpdateWaterBodyRenderData();
	}
	Zone->MarkForRebuild(EWaterZoneRebuildFlags::All);
	return true;
}
