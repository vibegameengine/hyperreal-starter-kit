#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace VgeObjects
{
	TSharedRef<FJsonObject> SetProperties(const TSharedPtr<FJsonObject>& Request);
	TSharedRef<FJsonObject> Save(const TSharedPtr<FJsonObject>& Request);
	TSharedRef<FJsonObject> Call(const TSharedPtr<FJsonObject>& Request);
}
