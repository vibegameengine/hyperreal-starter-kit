#include "VgeObjects.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "FileHelpers.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "JsonObjectConverter.h"
#include "UObject/Package.h"
#include "UObject/StructOnScope.h"

namespace
{
	UObject* FindOrLoad(const FString& Path)
	{
		UObject* Object = StaticFindObject(UObject::StaticClass(), nullptr, *Path);
		return Object ? Object : LoadObject<UObject>(nullptr, *Path);
	}
}

namespace
{
	bool WriteProperties(UObject* Object, const TSharedPtr<FJsonObject>& Properties, const FString& Path, TSharedRef<FJsonObject>& Result)
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : Properties->Values)
		{
			bool bKnown = false;
			for (TFieldIterator<FProperty> It(Object->GetClass()); It && !bKnown; ++It)
			{
				bKnown = It->GetName().Equals(Entry.Key, ESearchCase::IgnoreCase);
			}
			if (!bKnown)
			{
				Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s (%s) has no property %s"), *Path, *Object->GetClass()->GetName(), *Entry.Key));
				return false;
			}
		}
		Object->Modify();
		FText FailReason;
		if (!FJsonObjectConverter::JsonObjectToUStruct(Properties.ToSharedRef(), Object->GetClass(), Object, 0, 0, /*bStrictMode*/ false, &FailReason))
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s: %s"), *Path, *FailReason.ToString()));
			return false;
		}
		Object->PostEditChange();
		Object->MarkPackageDirty();
		return true;
	}
}

TSharedRef<FJsonObject> VgeObjects::SetProperties(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString Path = Request->GetStringField(TEXT("path"));
	UObject* Object = FindOrLoad(Path);
	const TSharedPtr<FJsonObject>* Properties = nullptr;
	if (!Object)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no object %s"), *Path));
		return Result;
	}
	if (!Request->TryGetObjectField(TEXT("properties"), Properties))
	{
		Result->SetStringField(TEXT("error"), TEXT("set-properties takes 'properties', an object"));
		return Result;
	}
	if (WriteProperties(Object, *Properties, Path, Result))
	{
		Result->SetStringField(TEXT("class"), Object->GetClass()->GetPathName());
	}
	return Result;
}

TSharedRef<FJsonObject> VgeObjects::CreateClass(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString PackagePath = Request->GetStringField(TEXT("path"));
	const FString ParentPath = Request->GetStringField(TEXT("parent"));
	UClass* Parent = LoadObject<UClass>(nullptr, *ParentPath);
	if (!Parent || !FKismetEditorUtilities::CanCreateBlueprintOfClass(Parent))
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no class %s to derive a Blueprint from"), *ParentPath));
		return Result;
	}
	const FString Name = FPackageName::GetLongPackageAssetName(PackagePath);
	UPackage* Package = CreatePackage(*PackagePath);
	UBlueprint* Blueprint = FKismetEditorUtilities::CreateBlueprint(Parent, Package, *Name, BPTYPE_Normal, UBlueprint::StaticClass(), UBlueprintGeneratedClass::StaticClass());
	if (!Blueprint || !Blueprint->GeneratedClass)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("could not create %s"), *PackagePath));
		return Result;
	}
	FAssetRegistryModule::AssetCreated(Blueprint);
	const TSharedPtr<FJsonObject>* Defaults = nullptr;
	if (Request->TryGetObjectField(TEXT("defaults"), Defaults) && !WriteProperties(Blueprint->GeneratedClass->GetDefaultObject(), *Defaults, PackagePath, Result))
	{
		return Result;
	}
	Package->MarkPackageDirty();
	Result->SetStringField(TEXT("class"), Blueprint->GeneratedClass->GetPathName());
	return Result;
}

TSharedRef<FJsonObject> VgeObjects::Save(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	TArray<UPackage*> Packages;
	TArray<FString> Paths;
	Request->TryGetStringArrayField(TEXT("paths"), Paths);
	for (const FString& Path : Paths)
	{
		UObject* Object = FindOrLoad(Path);
		if (!Object)
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no object %s"), *Path));
			return Result;
		}
		Packages.AddUnique(Object->GetPackage());
	}
	Result->SetBoolField(TEXT("saved"), UEditorLoadingAndSavingUtils::SavePackages(Packages, /*bOnlyDirty*/ false));
	return Result;
}

TSharedRef<FJsonObject> VgeObjects::Call(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString ClassPath = Request->GetStringField(TEXT("class"));
	const FString FunctionName = Request->GetStringField(TEXT("function"));
	UClass* Class = LoadObject<UClass>(nullptr, *ClassPath);
	UFunction* Function = Class ? Class->FindFunctionByName(*FunctionName) : nullptr;
	if (!Function || !Function->HasAnyFunctionFlags(FUNC_Static))
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s has no static function %s"), *ClassPath, *FunctionName));
		return Result;
	}
	TSharedPtr<FJsonObject> Args = MakeShared<FJsonObject>();
	const TSharedPtr<FJsonObject>* GivenArgs = nullptr;
	if (Request->TryGetObjectField(TEXT("args"), GivenArgs))
	{
		Args = *GivenArgs;
	}
	TArray<FString> Parameters;
	for (TFieldIterator<FProperty> It(Function); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
	{
		if (!It->HasAnyPropertyFlags(CPF_ReturnParm))
		{
			Parameters.Add(It->GetName());
		}
	}
	for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : Args->Values)
	{
		if (!Parameters.ContainsByPredicate([&Entry](const FString& Name) { return Name.Equals(Entry.Key, ESearchCase::IgnoreCase); }))
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s takes %s, not %s"), *FunctionName, *FString::Join(Parameters, TEXT(", ")), *Entry.Key));
			return Result;
		}
	}
	FStructOnScope Frame(Function);
	for (TFieldIterator<FProperty> It(Function); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
	{
		if (It->HasAnyPropertyFlags(CPF_ReturnParm))
		{
			continue;
		}
		void* Address = It->ContainerPtrToValuePtr<void>(Frame.GetStructMemory());
		const TSharedPtr<FJsonValue> Value = Args->TryGetField(It->GetName());
		if (!Value.IsValid())
		{
			const FString Default = Function->GetMetaData(*(TEXT("CPP_Default_") + It->GetName()));
			if (!Default.IsEmpty())
			{
				It->ImportText_Direct(*Default, Address, nullptr, PPF_None);
			}
			else if (!It->HasAnyPropertyFlags(CPF_OutParm) || It->HasAnyPropertyFlags(CPF_ConstParm))
			{
				Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s needs %s"), *FunctionName, *It->GetName()));
				return Result;
			}
			continue;
		}
		if (FObjectPropertyBase* ObjectProperty = CastField<FObjectPropertyBase>(*It))
		{
			const FString Path = Value->Type == EJson::String ? Value->AsString() : FString();
			UObject* Object = Path.IsEmpty() ? nullptr : FindOrLoad(Path);
			if (!Path.IsEmpty() && (!Object || !Object->IsA(ObjectProperty->PropertyClass)))
			{
				Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s: no %s at %s"), *It->GetName(), *ObjectProperty->PropertyClass->GetName(), *Path));
				return Result;
			}
			ObjectProperty->SetObjectPropertyValue(Address, Object);
		}
		else if (!FJsonObjectConverter::JsonValueToUProperty(Value, *It, Address, 0, 0))
		{
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s: %s does not take that value"), *FunctionName, *It->GetName()));
			return Result;
		}
	}
	Class->GetDefaultObject()->ProcessEvent(Function, Frame.GetStructMemory());
	TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
	for (TFieldIterator<FProperty> It(Function); It && It->HasAnyPropertyFlags(CPF_Parm); ++It)
	{
		if (It->HasAnyPropertyFlags(CPF_ReturnParm | CPF_OutParm) && !It->HasAnyPropertyFlags(CPF_ConstParm))
		{
			const TSharedPtr<FJsonValue> Value = FJsonObjectConverter::UPropertyToJsonValue(*It, It->ContainerPtrToValuePtr<void>(Frame.GetStructMemory()));
			if (Value.IsValid())
			{
				Out->SetField(It->HasAnyPropertyFlags(CPF_ReturnParm) ? TEXT("returnValue") : It->GetName(), Value);
			}
		}
	}
	Result->SetObjectField(TEXT("result"), Out);
	return Result;
}
