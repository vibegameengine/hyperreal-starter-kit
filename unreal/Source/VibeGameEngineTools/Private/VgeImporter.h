#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UMaterial;

// Content operations shared by the one-shot VgeImport commandlet and the resident content service.
namespace VgeImporter
{
	// Interchange's master materials and the project's copies that replace them. The masters live in the Interchange
	// plugin's content, which the game does not cook, and lack skeletal, Nanite and instancing usage; imported
	// material instances are moved onto the project copies (VgeMaterialsCommandlet makes them).
	struct FMasterSet
	{
		const TCHAR* SourcePath;
		const TCHAR* ProjectPath;
		TArray<FString> Names;
		// Every usage must take (glTF masters are opaque surfaces); otherwise a master that refuses one, a
		// translucent one refusing Nanite for example, keeps the usages it takes.
		bool bEveryUsage;
	};
	// glTF imports (/InterchangeAssets/gltf) and FBX and other imports (/InterchangeAssets/Materials).
	const TArray<FMasterSet>& MasterSets();

	// The project copy of an Interchange master, or null when Material is not one of them.
	UMaterial* FindProjectMaster(const UMaterial* InterchangeMaster);

	// Imports Source through Interchange into the Dest content path, enables Nanite on every static mesh it
	// produced, moves material instances onto the project's master materials and saves the packages.
	// Returns the report: source, dest, saved, objects[{path, class}].
	TSharedRef<FJsonObject> Import(const FString& Source, const FString& Dest, const TSharedPtr<FJsonObject>& Cloth = nullptr, const TSharedPtr<FJsonObject>& MeshSettings = nullptr);

	struct FImportRequest
	{
		FString Source;
		FString Dest;
		TSharedPtr<FJsonObject> Cloth;
		TSharedPtr<FJsonObject> MeshSettings;
	};

	TArray<TSharedRef<FJsonObject>> ImportMany(const TArray<FImportRequest>& Requests);

	// Imports only the animations of Source onto an existing skeleton (Interchange's "import only
	// animations" with the skeleton set), into Dest. Returns the same report as Import.
	TSharedRef<FJsonObject> ImportAnimations(const FString& Source, const FString& Dest, const FString& SkeletonPath);

	TSharedRef<FJsonObject> ImportSound(const FString& Source, const FString& Dest);

	// Removes every asset under a content path from memory, the asset registry and disk.
	// Returns the number of packages deleted.
	int32 DeleteContentPath(const FString& ContentPath);
}
