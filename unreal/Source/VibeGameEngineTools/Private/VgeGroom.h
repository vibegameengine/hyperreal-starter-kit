#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace VgeGroom
{
	TSharedRef<FJsonObject> Bind(const TSharedPtr<FJsonObject>& Request);
}
