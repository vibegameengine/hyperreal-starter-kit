#pragma once

#include "CoreMinimal.h"
#include "InterchangeManager.h"
#include "UObject/Object.h"
#include "VgeAssetPreview.generated.h"

UCLASS(BlueprintType)
class VIBEGAMEENGINE_API UVgeAssetPreview : public UObject
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Vge")
	static UVgeAssetPreview* Import(const FString& File, const FString& ContentPath);

	UFUNCTION(BlueprintCallable, Category = "Vge")
	bool IsDone() const;

	UFUNCTION(BlueprintCallable, Category = "Vge")
	TArray<UObject*> Objects();

private:
	UE::Interchange::FAssetImportResultPtr Result;

	UPROPERTY()
	TArray<TObjectPtr<UObject>> Held;
};
