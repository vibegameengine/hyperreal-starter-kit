#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace VgeComputeBuilder
{
	TSharedRef<FJsonObject> Build(const TSharedPtr<FJsonObject>& Request);
}
