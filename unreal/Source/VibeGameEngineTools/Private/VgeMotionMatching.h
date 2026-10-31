#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

namespace VgeMotionMatching
{
	TSharedRef<FJsonObject> Build(const TSharedPtr<FJsonObject>& Request);
}
