#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace VgeTerrain
{
	TSharedRef<FJsonObject> Build(const TSharedPtr<FJsonObject>& Request);
}
