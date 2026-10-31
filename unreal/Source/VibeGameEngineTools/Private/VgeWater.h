#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UWorld;

namespace VgeWater
{
	bool Spawn(UWorld* World, const TSharedPtr<FJsonObject>& Water, FString& Error);
}
