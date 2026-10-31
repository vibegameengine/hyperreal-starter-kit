#include "VgeMaterialBuilder.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Engine/Texture.h"
#include "FileHelpers.h"
#include "MaterialEditingLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"
#include "Materials/MaterialExpressionMaterialFunctionCall.h"
#include "Materials/MaterialFunctionInterface.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Misc/PackageName.h"
#include "SceneTypes.h"
#include "UObject/EnumProperty.h"
#include "UObject/Package.h"
#include "UObject/TextProperty.h"
#include "UObject/UObjectGlobals.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeMaterial, Log, All);

namespace
{
	// Names from TypeScript are camelCase (baseColor, constA, twoSided) and the engine's are PascalCase, some with a
	// prefix (bUsedWithNanite, BLEND_Opaque): both sides compare letters and digits only, in any case.
	FString Normalize(const FString& Name)
	{
		FString Out;
		Out.Reserve(Name.Len());
		for (const TCHAR C : Name)
		{
			if (FChar::IsAlnum(C))
			{
				Out.AppendChar(FChar::ToLower(C));
			}
		}
		return Out;
	}

	FProperty* FindProp(const UStruct* Struct, const FString& Name)
	{
		const FString Wanted = Normalize(Name);
		for (TFieldIterator<FProperty> It(Struct); It; ++It)
		{
			const FString PropName = It->GetName();
			if (Normalize(PropName) == Wanted)
			{
				return *It;
			}
			if (CastField<FBoolProperty>(*It) && PropName.Len() > 1 && PropName[0] == TEXT('b') && FChar::IsUpper(PropName[1]) && Normalize(PropName.Mid(1)) == Wanted)
			{
				return *It;
			}
		}
		return nullptr;
	}

	// An enum value by its name, with or without the prefix before the first underscore (BLEND_Opaque, Opaque).
	int64 FindEnumValue(const UEnum* Enum, const FString& Name)
	{
		const FString Wanted = Normalize(Name);
		for (int32 Index = 0; Index < Enum->NumEnums(); ++Index)
		{
			const FString Full = Enum->GetNameStringByIndex(Index);
			int32 Underscore;
			const FString Short = Full.FindChar(TEXT('_'), Underscore) ? Full.Mid(Underscore + 1) : Full;
			if (Normalize(Full) == Wanted || Normalize(Short) == Wanted)
			{
				return Enum->GetValueByIndex(Index);
			}
		}
		return INDEX_NONE;
	}

	bool SetValue(const FProperty* Property, void* Value, const TSharedPtr<FJsonValue>& Json, FString& Error);

	bool SetEnum(const UEnum* Enum, const FNumericProperty* Underlying, void* Value, const TSharedPtr<FJsonValue>& Json, FString& Error)
	{
		FString Name;
		double Number;
		if (Json->TryGetString(Name))
		{
			const int64 Found = FindEnumValue(Enum, Name);
			if (Found == INDEX_NONE)
			{
				Error = FString::Printf(TEXT("'%s' is not a value of %s"), *Name, *Enum->GetName());
				return false;
			}
			Underlying->SetIntPropertyValue(Value, Found);
			return true;
		}
		if (Json->TryGetNumber(Number))
		{
			Underlying->SetIntPropertyValue(Value, static_cast<int64>(Number));
			return true;
		}
		Error = FString::Printf(TEXT("%s takes a value name"), *Enum->GetName());
		return false;
	}

	bool SetValue(const FProperty* Property, void* Value, const TSharedPtr<FJsonValue>& Json, FString& Error)
	{
		if (const FBoolProperty* Bool = CastField<FBoolProperty>(Property))
		{
			bool B;
			if (!Json->TryGetBool(B))
			{
				Error = TEXT("expects true or false");
				return false;
			}
			Bool->SetPropertyValue(Value, B);
			return true;
		}
		if (const FEnumProperty* Enum = CastField<FEnumProperty>(Property))
		{
			return SetEnum(Enum->GetEnum(), Enum->GetUnderlyingProperty(), Value, Json, Error);
		}
		if (const FByteProperty* Byte = CastField<FByteProperty>(Property); Byte && Byte->Enum)
		{
			return SetEnum(Byte->Enum, Byte, Value, Json, Error);
		}
		if (const FNumericProperty* Numeric = CastField<FNumericProperty>(Property))
		{
			double Number;
			if (!Json->TryGetNumber(Number))
			{
				Error = TEXT("expects a number");
				return false;
			}
			if (Numeric->IsFloatingPoint())
			{
				Numeric->SetFloatingPointPropertyValue(Value, Number);
			}
			else
			{
				Numeric->SetIntPropertyValue(Value, static_cast<int64>(Number));
			}
			return true;
		}
		FString String;
		if (const FStrProperty* Str = CastField<FStrProperty>(Property))
		{
			if (!Json->TryGetString(String))
			{
				Error = TEXT("expects a string");
				return false;
			}
			Str->SetPropertyValue(Value, String);
			return true;
		}
		if (const FNameProperty* Name = CastField<FNameProperty>(Property))
		{
			if (!Json->TryGetString(String))
			{
				Error = TEXT("expects a string");
				return false;
			}
			Name->SetPropertyValue(Value, FName(*String));
			return true;
		}
		if (const FTextProperty* Text = CastField<FTextProperty>(Property))
		{
			if (!Json->TryGetString(String))
			{
				Error = TEXT("expects a string");
				return false;
			}
			Text->SetPropertyValue(Value, FText::FromString(String));
			return true;
		}
		if (const FSoftObjectProperty* Soft = CastField<FSoftObjectProperty>(Property))
		{
			if (!Json->TryGetString(String))
			{
				Error = TEXT("expects an object path");
				return false;
			}
			Soft->SetPropertyValue(Value, FSoftObjectPtr(FSoftObjectPath(String)));
			return true;
		}
		if (const FObjectPropertyBase* Object = CastField<FObjectPropertyBase>(Property))
		{
			if (Json->IsNull())
			{
				Object->SetObjectPropertyValue(Value, nullptr);
				return true;
			}
			if (!Json->TryGetString(String))
			{
				Error = TEXT("expects an object path");
				return false;
			}
			const FClassProperty* ClassProperty = CastField<FClassProperty>(Property);
			UObject* Loaded = ClassProperty ? StaticLoadObject(UClass::StaticClass(), nullptr, *String) : StaticLoadObject(Object->PropertyClass, nullptr, *String);
			if (!Loaded)
			{
				Error = FString::Printf(TEXT("%s is not a loadable %s"), *String, *Object->PropertyClass->GetName());
				return false;
			}
			Object->SetObjectPropertyValue(Value, Loaded);
			return true;
		}
		if (const FStructProperty* Struct = CastField<FStructProperty>(Property))
		{
			// A tuple fills the struct's fields in order ([r, g, b, a] for a FLinearColor), an object by name.
			const TArray<TSharedPtr<FJsonValue>>* Items;
			const TSharedPtr<FJsonObject>* Fields;
			if (Json->TryGetArray(Items))
			{
				int32 Index = 0;
				for (TFieldIterator<FProperty> It(Struct->Struct); It && Index < Items->Num(); ++It, ++Index)
				{
					if (!SetValue(*It, It->ContainerPtrToValuePtr<void>(Value), (*Items)[Index], Error))
					{
						Error = FString::Printf(TEXT("%s.%s %s"), *Struct->Struct->GetName(), *It->GetName(), *Error);
						return false;
					}
				}
				return true;
			}
			if (Json->TryGetObject(Fields))
			{
				for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : (*Fields)->Values)
				{
					const FProperty* Inner = FindProp(Struct->Struct, Field.Key);
					if (!Inner)
					{
						Error = FString::Printf(TEXT("%s has no field '%s'"), *Struct->Struct->GetName(), *Field.Key);
						return false;
					}
					if (!SetValue(Inner, Inner->ContainerPtrToValuePtr<void>(Value), Field.Value, Error))
					{
						Error = FString::Printf(TEXT("%s.%s %s"), *Struct->Struct->GetName(), *Inner->GetName(), *Error);
						return false;
					}
				}
				return true;
			}
			Error = FString::Printf(TEXT("expects a %s as a tuple or an object"), *Struct->Struct->GetName());
			return false;
		}
		if (const FArrayProperty* Array = CastField<FArrayProperty>(Property))
		{
			const TArray<TSharedPtr<FJsonValue>>* Items;
			if (!Json->TryGetArray(Items))
			{
				Error = TEXT("expects an array");
				return false;
			}
			FScriptArrayHelper Helper(Array, Value);
			Helper.EmptyAndAddValues(Items->Num());
			for (int32 Index = 0; Index < Items->Num(); ++Index)
			{
				if (!SetValue(Array->Inner, Helper.GetRawPtr(Index), (*Items)[Index], Error))
				{
					Error = FString::Printf(TEXT("[%d] %s"), Index, *Error);
					return false;
				}
			}
			return true;
		}
		Error = FString::Printf(TEXT("has a type (%s) that cannot be written from a description"), *Property->GetCPPType());
		return false;
	}

	bool SetProps(UObject* Target, const TSharedPtr<FJsonObject>& Props, const TSet<FString>& Skip, FString& Error)
	{
		if (!Props.IsValid())
		{
			return true;
		}
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Prop : Props->Values)
		{
			if (Skip.Contains(Normalize(Prop.Key)))
			{
				continue;
			}
			const FProperty* Property = FindProp(Target->GetClass(), Prop.Key);
			if (!Property)
			{
				Error = FString::Printf(TEXT("%s has no property '%s'"), *Target->GetClass()->GetName(), *Prop.Key);
				return false;
			}
			FString ValueError;
			if (!SetValue(Property, Property->ContainerPtrToValuePtr<void>(Target), Prop.Value, ValueError))
			{
				Error = FString::Printf(TEXT("%s.%s %s"), *Target->GetClass()->GetName(), *Property->GetName(), *ValueError);
				return false;
			}
		}
		return true;
	}

	// An output by its name, or by the channel mask an unnamed output has (R, G, B, A, RGB, RGBA); "" is the first.
	int32 FindOutput(UMaterialExpression* Expression, const FString& Name)
	{
		TArray<FExpressionOutput>& Outputs = Expression->GetOutputs();
		if (Outputs.Num() == 0)
		{
			return INDEX_NONE;
		}
		if (Name.IsEmpty())
		{
			return 0;
		}
		const FString Wanted = Normalize(Name);
		for (int32 Index = 0; Index < Outputs.Num(); ++Index)
		{
			const FExpressionOutput& Output = Outputs[Index];
			if (!Output.OutputName.IsNone())
			{
				if (Normalize(Output.OutputName.ToString()) == Wanted)
				{
					return Index;
				}
				continue;
			}
			FString Mask;
			Mask += Output.MaskR ? TEXT("r") : TEXT("");
			Mask += Output.MaskG ? TEXT("g") : TEXT("");
			Mask += Output.MaskB ? TEXT("b") : TEXT("");
			Mask += Output.MaskA ? TEXT("a") : TEXT("");
			if (Output.Mask && Mask == Wanted)
			{
				return Index;
			}
		}
		return INDEX_NONE;
	}

	FString OutputNames(UMaterialExpression* Expression)
	{
		TArray<FString> Names;
		for (const FExpressionOutput& Output : Expression->GetOutputs())
		{
			Names.Add(Output.OutputName.IsNone() ? FString::Printf(TEXT("%s%s%s%s"), Output.MaskR ? TEXT("R") : TEXT(""), Output.MaskG ? TEXT("G") : TEXT(""), Output.MaskB ? TEXT("B") : TEXT(""), Output.MaskA ? TEXT("A") : TEXT("")) : Output.OutputName.ToString());
		}
		return FString::Join(Names, TEXT(", "));
	}

	// An input by its pin name (what the material editor shows: a Custom expression's input names, a function call's
	// inputs) or by the name of its property (A, Coordinates).
	FExpressionInput* FindInput(UMaterialExpression* Expression, const FString& Name)
	{
		static const UScriptStruct* InputStruct = FindObject<UScriptStruct>(nullptr, TEXT("/Script/Engine.ExpressionInput"));
		const FString Wanted = Normalize(Name);
		UMaterialExpressionMaterialFunctionCall* Call = Cast<UMaterialExpressionMaterialFunctionCall>(Expression);
		for (FExpressionInputIterator It{ Expression }; It; ++It)
		{
			const FName Pin = Call ? Call->GetInputNameWithType(It.Index, false) : Expression->GetInputName(It.Index);
			if (Normalize(Pin.ToString()) == Wanted)
			{
				return It.Input;
			}
		}
		for (TFieldIterator<FStructProperty> Property(Expression->GetClass()); Property; ++Property)
		{
			if (!InputStruct || !Property->Struct->IsChildOf(InputStruct) || Normalize(Property->GetName()) != Wanted)
			{
				continue;
			}
			FExpressionInput* Candidate = Property->ContainerPtrToValuePtr<FExpressionInput>(Expression);
			for (FExpressionInputIterator It{ Expression }; It; ++It)
			{
				if (It.Input == Candidate)
				{
					return Candidate;
				}
			}
		}
		return nullptr;
	}

	FString InputNames(UMaterialExpression* Expression)
	{
		TArray<FString> Names;
		for (FExpressionInputIterator It{ Expression }; It; ++It)
		{
			Names.Add(Expression->GetInputName(It.Index).ToString());
		}
		return FString::Join(Names, TEXT(", "));
	}

	TSharedRef<FJsonObject> Failure(const FString& Error)
	{
		UE_LOGF(LogVgeMaterial, Error, "%ls", *Error);
		TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
		Result->SetStringField(TEXT("error"), Error);
		return Result;
	}

	// "/VgeLive/Materials/Lava_1a2b/Lava" -> its package, and the asset's name. A package left from an earlier build
	// under the same path holds the same description (paths carry its hash): it is replaced all the same, so the asset
	// is always the one this request describes.
	template <typename T>
	T* NewAsset(const FString& Path, FString& Error)
	{
		const FString Name = FPackageName::GetLongPackageAssetName(Path);
		if (!FPackageName::IsValidLongPackageName(Path) || Name.IsEmpty())
		{
			Error = FString::Printf(TEXT("'%s' is not a package path"), *Path);
			return nullptr;
		}
		UPackage* Package = CreatePackage(*Path);
		Package->FullyLoad();
		if (UObject* Existing = StaticFindObject(UObject::StaticClass(), Package, *Name))
		{
			Existing->Rename(nullptr, GetTransientPackage(), REN_DontCreateRedirectors | REN_NonTransactional);
			Existing->ClearFlags(RF_Public | RF_Standalone);
		}
		T* Asset = NewObject<T>(Package, *Name, RF_Public | RF_Standalone | RF_Transactional);
		FAssetRegistryModule::AssetCreated(Asset);
		return Asset;
	}

	TSharedRef<FJsonObject> Save(UObject* Asset)
	{
		Asset->MarkPackageDirty();
		const bool bSaved = UEditorLoadingAndSavingUtils::SavePackages({ Asset->GetPackage() }, false);
		if (!bSaved)
		{
			return Failure(FString::Printf(TEXT("%s could not be saved"), *Asset->GetPathName()));
		}
		TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
		Result->SetStringField(TEXT("path"), Asset->GetPathName());
		Result->SetStringField(TEXT("class"), Asset->GetClass()->GetName());
		Result->SetBoolField(TEXT("saved"), true);
		UE_LOGF(LogVgeMaterial, Display, "Saved %ls", *Asset->GetPathName());
		return Result;
	}

	bool ReadLink(const TSharedPtr<FJsonValue>& Json, const TArray<UMaterialExpression*>& Expressions, UMaterialExpression*& From, int32& OutputIndex, FString& Error)
	{
		const TSharedPtr<FJsonObject>* Link;
		if (!Json->TryGetObject(Link))
		{
			Error = TEXT("a link is { node, output }");
			return false;
		}
		const int32 Node = static_cast<int32>((*Link)->GetNumberField(TEXT("node")));
		if (!Expressions.IsValidIndex(Node))
		{
			Error = FString::Printf(TEXT("a link names node %d, which does not exist"), Node);
			return false;
		}
		From = Expressions[Node];
		FString Output;
		(*Link)->TryGetStringField(TEXT("output"), Output);
		OutputIndex = FindOutput(From, Output);
		if (OutputIndex == INDEX_NONE)
		{
			Error = FString::Printf(TEXT("%s has no output '%s' (outputs: %s)"), *From->GetClass()->GetName(), *Output, *OutputNames(From));
			return false;
		}
		return true;
	}
}

TSharedRef<FJsonObject> VgeMaterialBuilder::BuildMaterial(const TSharedPtr<FJsonObject>& Request)
{
	FString Error;
	const FString Path = Request->GetStringField(TEXT("path"));
	UMaterial* Material = NewAsset<UMaterial>(Path, Error);
	if (!Material)
	{
		return Failure(Error);
	}

	// Settings: the material's own properties; the shading model through its setter, which keeps the shading model
	// field in step.
	const TSharedPtr<FJsonObject>* Settings = nullptr;
	if (Request->TryGetObjectField(TEXT("settings"), Settings))
	{
		FString ShadingModel;
		if ((*Settings)->TryGetStringField(TEXT("shadingModel"), ShadingModel))
		{
			const int64 Model = FindEnumValue(StaticEnum<EMaterialShadingModel>(), ShadingModel);
			if (Model == INDEX_NONE)
			{
				return Failure(FString::Printf(TEXT("%s: '%s' is not a shading model"), *Path, *ShadingModel));
			}
			Material->SetShadingModel(static_cast<EMaterialShadingModel>(Model));
		}
		if (!SetProps(Material, *Settings, { TEXT("shadingmodel") }, Error))
		{
			return Failure(FString::Printf(TEXT("%s: %s"), *Path, *Error));
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* Usages;
	if (Request->TryGetArrayField(TEXT("usage"), Usages))
	{
		for (const TSharedPtr<FJsonValue>& Usage : *Usages)
		{
			const int64 Value = FindEnumValue(StaticEnum<EMaterialUsage>(), Usage->AsString());
			if (Value == INDEX_NONE)
			{
				return Failure(FString::Printf(TEXT("%s: '%s' is not a material usage"), *Path, *Usage->AsString()));
			}
			bool bNeedsRecompile = false;
			if (!UMaterialEditingLibrary::SetMaterialUsage(Material, static_cast<EMaterialUsage>(Value), bNeedsRecompile))
			{
				return Failure(FString::Printf(TEXT("%s refused usage %s"), *Path, *Usage->AsString()));
			}
		}
		bool bNeedsRecompile = false;
		if (Material->GetUsageByFlag(MATUSAGE_SkeletalMesh) && !UMaterialEditingLibrary::SetMaterialUsage(Material, MATUSAGE_Clothing, bNeedsRecompile))
		{
			return Failure(FString::Printf(TEXT("%s refused usage Clothing, which every skeletal mesh material gets"), *Path));
		}
	}

	// The expressions, then their links: a node may link to any other node of the description.
	const TArray<TSharedPtr<FJsonValue>>& Nodes = Request->GetArrayField(TEXT("nodes"));
	TArray<UMaterialExpression*> Expressions;
	for (int32 Index = 0; Index < Nodes.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> Node = Nodes[Index]->AsObject();
		const FString ClassName = Node->GetStringField(TEXT("class"));
		UClass* Class = FindFirstObject<UClass>(*ClassName, EFindFirstObjectOptions::ExactClass);
		if (!Class || !Class->IsChildOf(UMaterialExpression::StaticClass()) || Class->HasAnyClassFlags(CLASS_Abstract))
		{
			return Failure(FString::Printf(TEXT("%s: node %d: %s is not a material expression class"), *Path, Index, *ClassName));
		}
		UMaterialExpression* Expression = UMaterialEditingLibrary::CreateMaterialExpression(Material, Class, -300 * (Nodes.Num() - Index), 0);
		if (!Expression)
		{
			return Failure(FString::Printf(TEXT("%s: node %d: %s could not be created"), *Path, Index, *ClassName));
		}
		const TSharedPtr<FJsonObject>* Props = nullptr;
		Node->TryGetObjectField(TEXT("props"), Props);
		// A function call builds its pins from the function, so the function goes through its setter first.
		FString Function;
		if (UMaterialExpressionMaterialFunctionCall* Call = Cast<UMaterialExpressionMaterialFunctionCall>(Expression); Call && Props && (*Props)->TryGetStringField(TEXT("materialFunction"), Function))
		{
			UMaterialFunctionInterface* Loaded = LoadObject<UMaterialFunctionInterface>(nullptr, *Function);
			if (!Loaded || !Call->SetMaterialFunction(Loaded))
			{
				return Failure(FString::Printf(TEXT("%s: node %d: %s is not a loadable material function"), *Path, Index, *Function));
			}
		}
		if (Props && !SetProps(Expression, *Props, { TEXT("materialfunction") }, Error))
		{
			return Failure(FString::Printf(TEXT("%s: node %d: %s"), *Path, Index, *Error));
		}
		// As after an edit in the material editor: a Custom expression rebuilds its outputs, a parameter its id.
		Expression->PostEditChange();
		Expressions.Add(Expression);
	}

	for (int32 Index = 0; Index < Nodes.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject>* Inputs = nullptr;
		if (!Nodes[Index]->AsObject()->TryGetObjectField(TEXT("inputs"), Inputs))
		{
			continue;
		}
		UMaterialExpression* To = Expressions[Index];
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Input : (*Inputs)->Values)
		{
			FExpressionInput* Target = FindInput(To, Input.Key);
			if (!Target)
			{
				return Failure(FString::Printf(TEXT("%s: node %d: %s has no input '%s' (inputs: %s)"), *Path, Index, *To->GetClass()->GetName(), *Input.Key, *InputNames(To)));
			}
			UMaterialExpression* From = nullptr;
			int32 OutputIndex = 0;
			if (!ReadLink(Input.Value, Expressions, From, OutputIndex, Error))
			{
				return Failure(FString::Printf(TEXT("%s: node %d input %s: %s"), *Path, Index, *Input.Key, *Error));
			}
			From->ConnectExpression(Target, OutputIndex);
		}
	}

	const TSharedPtr<FJsonObject>* Outputs = nullptr;
	if (Request->TryGetObjectField(TEXT("outputs"), Outputs))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Output : (*Outputs)->Values)
		{
			const int64 Property = FindEnumValue(StaticEnum<EMaterialProperty>(), Output.Key);
			FExpressionInput* Target = Property == INDEX_NONE ? nullptr : Material->GetExpressionInputForProperty(static_cast<EMaterialProperty>(Property));
			if (!Target)
			{
				return Failure(FString::Printf(TEXT("%s: '%s' is not a material input"), *Path, *Output.Key));
			}
			UMaterialExpression* From = nullptr;
			int32 OutputIndex = 0;
			if (!ReadLink(Output.Value, Expressions, From, OutputIndex, Error))
			{
				return Failure(FString::Printf(TEXT("%s: %s: %s"), *Path, *Output.Key, *Error));
			}
			From->ConnectExpression(Target, OutputIndex);
		}
	}

	// The editor's own finish of an edited material: recompiles where shaders are compiled (nowhere in this -nullrhi
	// service: the cook compiles them for the target) and refreshes its parameter and expression caches.
	UMaterialEditingLibrary::RecompileMaterial(Material);
	return Save(Material);
}

TSharedRef<FJsonObject> VgeMaterialBuilder::BuildMaterialInstance(const TSharedPtr<FJsonObject>& Request)
{
	FString Error;
	const FString Path = Request->GetStringField(TEXT("path"));
	const FString ParentPath = Request->GetStringField(TEXT("parent"));
	UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, *ParentPath);
	if (!Parent)
	{
		return Failure(FString::Printf(TEXT("%s: parent %s is not a loadable material"), *Path, *ParentPath));
	}
	UMaterialInstanceConstant* Instance = NewAsset<UMaterialInstanceConstant>(Path, Error);
	if (!Instance)
	{
		return Failure(Error);
	}
	UMaterialEditingLibrary::SetMaterialInstanceParent(Instance, Parent);

	auto ParameterNames = [Parent](EMaterialParameterType Type)
	{
		TArray<FMaterialParameterInfo> Infos;
		TArray<FGuid> Ids;
		Parent->GetAllParameterInfoOfType(Type, Infos, Ids);
		TSet<FName> Names;
		for (const FMaterialParameterInfo& Info : Infos)
		{
			Names.Add(Info.Name);
		}
		return Names;
	};
	auto Check = [&](EMaterialParameterType Type, const FString& Name, const TCHAR* Kind) -> bool
	{
		const TSet<FName> Names = ParameterNames(Type);
		if (!Names.Contains(FName(*Name)))
		{
			TArray<FString> Known;
			for (const FName& Known_ : Names)
			{
				Known.Add(Known_.ToString());
			}
			Known.Sort();
			Error = FString::Printf(TEXT("%s: %s has no %s parameter '%s' (%s parameters: %s)"), *Path, *ParentPath, Kind, *Name, Kind, *FString::Join(Known, TEXT(", ")));
			return false;
		}
		return true;
	};

	const TSharedPtr<FJsonObject>* Values = nullptr;
	if (Request->TryGetObjectField(TEXT("scalar"), Values))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Value : (*Values)->Values)
		{
			if (!Check(EMaterialParameterType::Scalar, Value.Key, TEXT("scalar")))
			{
				return Failure(Error);
			}
			UMaterialEditingLibrary::SetMaterialInstanceScalarParameterValue(Instance, FName(*Value.Key), static_cast<float>(Value.Value->AsNumber()));
		}
	}
	if (Request->TryGetObjectField(TEXT("vector"), Values))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Value : (*Values)->Values)
		{
			if (!Check(EMaterialParameterType::Vector, Value.Key, TEXT("vector")))
			{
				return Failure(Error);
			}
			const TArray<TSharedPtr<FJsonValue>> Channels = Value.Value->AsArray();
			const FLinearColor Color(Channels.Num() > 0 ? Channels[0]->AsNumber() : 0.0, Channels.Num() > 1 ? Channels[1]->AsNumber() : 0.0, Channels.Num() > 2 ? Channels[2]->AsNumber() : 0.0, Channels.Num() > 3 ? Channels[3]->AsNumber() : 1.0);
			UMaterialEditingLibrary::SetMaterialInstanceVectorParameterValue(Instance, FName(*Value.Key), Color);
		}
	}
	if (Request->TryGetObjectField(TEXT("texture"), Values))
	{
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Value : (*Values)->Values)
		{
			if (!Check(EMaterialParameterType::Texture, Value.Key, TEXT("texture")))
			{
				return Failure(Error);
			}
			UTexture* Texture = LoadObject<UTexture>(nullptr, *Value.Value->AsString());
			if (!Texture)
			{
				return Failure(FString::Printf(TEXT("%s: %s is not a loadable texture"), *Path, *Value.Value->AsString()));
			}
			UMaterialEditingLibrary::SetMaterialInstanceTextureParameterValue(Instance, FName(*Value.Key), Texture);
		}
	}
	Instance->PostEditChange();
	return Save(Instance);
}
