#include "VgeAssetPreview.h"

#include "InterchangeSourceData.h"

UVgeAssetPreview* UVgeAssetPreview::Import(const FString& File, const FString& ContentPath)
{
	UVgeAssetPreview* Preview = NewObject<UVgeAssetPreview>();
	UInterchangeSourceData* Source = UInterchangeManager::CreateSourceData(File);
	FImportAssetParameters Parameters;
	Parameters.bIsAutomated = true;
	Preview->Result = UInterchangeManager::GetInterchangeManager().ImportAssetWithResult(ContentPath, Source, Parameters);
	return Preview;
}

bool UVgeAssetPreview::IsDone() const
{
	return Result.IsValid() && Result->GetStatus() == UE::Interchange::FImportResult::EStatus::Done;
}

TArray<UObject*> UVgeAssetPreview::Objects()
{
	if (Result.IsValid())
	{
		for (UObject* Object : Result->GetImportedObjects())
		{
			Held.AddUnique(Object);
		}
	}
	TArray<UObject*> Objects;
	for (const TObjectPtr<UObject>& Object : Held)
	{
		Objects.Add(Object);
	}
	return Objects;
}
