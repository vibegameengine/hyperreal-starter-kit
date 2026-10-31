#include "VgeJsxDeclarations.h"

#include "Components/ActorComponent.h"
#include "Components/SceneComponent.h"
#include "Dom/JsonObject.h"
#include "GameFramework/Actor.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"
#include "Materials/MaterialExpressionCustom.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UObjectIterator.h"

namespace
{
	FString CamelCase(const FString& Name)
	{
		return Name.IsEmpty() ? Name : Name.Left(1).ToLower() + Name.Mid(1);
	}

	// "bHidden" -> "Hidden", the way FTrackInstancePropertyBindings names a bool's setter.
	FString WithoutBoolPrefix(const FProperty* Property)
	{
		const FString Name = Property->GetName();
		return CastField<FBoolProperty>(Property) && Name.Len() > 1 && Name[0] == TEXT('b') && FChar::IsUpper(Name[1]) ? Name.Mid(1) : Name;
	}

	bool IsElementClass(const UClass* Class)
	{
		return Class->HasAnyClassFlags(CLASS_Native) && !Class->HasAnyClassFlags(CLASS_Deprecated | CLASS_NewerVersionExists)
			&& (Class->IsChildOf(AActor::StaticClass()) || Class->IsChildOf(UActorComponent::StaticClass()));
	}

	// Properties Unreal exposes for editing or Blueprint writes, and component pointers (VisibleAnywhere), whose
	// own properties are set through a nested object.
	bool IsComponentPointer(const FProperty* Property)
	{
		const FObjectProperty* Object = CastField<FObjectProperty>(Property);
		return Object && Object->PropertyClass && Object->PropertyClass->IsChildOf(UActorComponent::StaticClass());
	}

	// A scene component's relative transform is the element's location / rotation / scale, set through the
	// transform functions, not three more props.
	bool IsTransform(const FProperty* Property)
	{
		static const TSet<FName> Names = { TEXT("RelativeLocation"), TEXT("RelativeRotation"), TEXT("RelativeScale3D") };
		return Property->GetOwnerClass() == USceneComponent::StaticClass() && Names.Contains(Property->GetFName());
	}

	bool IsProp(const FProperty* Property)
	{
		if (Property->HasAnyPropertyFlags(CPF_Deprecated) || IsTransform(Property))
		{
			return false;
		}
		if (const FMulticastDelegateProperty* Delegate = CastField<FMulticastDelegateProperty>(Property))
		{
			return Property->HasAnyPropertyFlags(CPF_BlueprintAssignable);
		}
		if (IsComponentPointer(Property))
		{
			return Property->HasAnyPropertyFlags(CPF_Edit | CPF_BlueprintVisible);
		}
		const bool bEditable = Property->HasAnyPropertyFlags(CPF_Edit) && !Property->HasAnyPropertyFlags(CPF_EditConst);
		const bool bWritable = Property->HasAnyPropertyFlags(CPF_BlueprintVisible) && !Property->HasAnyPropertyFlags(CPF_BlueprintReadOnly);
		return bEditable || bWritable;
	}

	FString ArrayElement(const FProperty* Inner);

	// The TypeScript type of a value, in the names Puerts gives native types in ue.d.ts; empty when the renderer
	// has no way to write it.
	FString TsType(const FProperty* Property)
	{
		if (CastField<FBoolProperty>(Property))
		{
			return TEXT("boolean");
		}
		if (const FEnumProperty* Enum = CastField<FEnumProperty>(Property))
		{
			return FString::Printf(TEXT("UE.%s"), *Enum->GetEnum()->GetName());
		}
		if (const FByteProperty* Byte = CastField<FByteProperty>(Property); Byte && Byte->Enum)
		{
			return FString::Printf(TEXT("UE.%s"), *Byte->Enum->GetName());
		}
		if (CastField<FNumericProperty>(Property))
		{
			return TEXT("number");
		}
		if (CastField<FStrProperty>(Property) || CastField<FNameProperty>(Property) || CastField<FTextProperty>(Property))
		{
			return TEXT("string");
		}
		if (const FStructProperty* Struct = CastField<FStructProperty>(Property))
		{
			return FString::Printf(TEXT("StructProp<UE.%s>"), *Struct->Struct->GetName());
		}
		if (const FClassProperty* Class = CastField<FClassProperty>(Property))
		{
			return TEXT("UE.Class | string");
		}
		if (const FObjectProperty* Object = CastField<FObjectProperty>(Property))
		{
			return FString::Printf(TEXT("ObjectProp<UE.%s>"), *Object->PropertyClass->GetName());
		}
		if (const FArrayProperty* Array = CastField<FArrayProperty>(Property))
		{
			const FString Inner = TsType(Array->Inner);
			return Inner.IsEmpty() || ArrayElement(Array->Inner).IsEmpty() ? FString() : FString::Printf(TEXT("ReadonlyArray<%s>"), *Inner);
		}
		return FString();
	}

	// The element type of an array prop as the runtime builds it with UE.NewArray: a class, a struct, or one of
	// Puerts' builtin element types.
	FString ArrayElement(const FProperty* Inner)
	{
		if (const FObjectProperty* Object = CastField<FObjectProperty>(Inner))
		{
			return TEXT("object:") + Object->PropertyClass->GetName();
		}
		if (const FStructProperty* Struct = CastField<FStructProperty>(Inner))
		{
			return TEXT("struct:") + Struct->Struct->GetName();
		}
		if (CastField<FBoolProperty>(Inner))
		{
			return TEXT("BuiltinBool");
		}
		if (CastField<FEnumProperty>(Inner) || CastField<FByteProperty>(Inner))
		{
			return TEXT("BuiltinByte");
		}
		if (CastField<FIntProperty>(Inner))
		{
			return TEXT("BuiltinInt");
		}
		if (CastField<FFloatProperty>(Inner))
		{
			return TEXT("BuiltinFloat");
		}
		if (CastField<FDoubleProperty>(Inner))
		{
			return TEXT("BuiltinDouble");
		}
		if (CastField<FStrProperty>(Inner))
		{
			return TEXT("BuiltinString");
		}
		if (CastField<FNameProperty>(Inner))
		{
			return TEXT("BuiltinName");
		}
		return FString();
	}

	FString Kind(const FProperty* Property)
	{
		if (CastField<FMulticastDelegateProperty>(Property))
		{
			return TEXT("event");
		}
		if (IsComponentPointer(Property))
		{
			return TEXT("component");
		}
		if (const FStructProperty* Struct = CastField<FStructProperty>(Property))
		{
			return TEXT("struct:") + Struct->Struct->GetName();
		}
		if (CastField<FClassProperty>(Property) || CastField<FObjectProperty>(Property))
		{
			return TEXT("object");
		}
		if (const FArrayProperty* Array = CastField<FArrayProperty>(Property))
		{
			return TEXT("array:") + ArrayElement(Array->Inner);
		}
		return TEXT("value");
	}

	FString HandlerType(const FMulticastDelegateProperty* Delegate)
	{
		TArray<FString> Parameters;
		if (const UFunction* Signature = Delegate->SignatureFunction)
		{
			for (TFieldIterator<FProperty> It(Signature); It && It->HasAnyPropertyFlags(CPF_Parm) && !It->HasAnyPropertyFlags(CPF_ReturnParm); ++It)
			{
				const FString Type = TsType(*It);
				Parameters.Add(FString::Printf(TEXT("%s: %s"), *CamelCase(It->GetName()), Type.IsEmpty() ? TEXT("unknown") : *Type));
			}
		}
		return FString::Printf(TEXT("(%s) => void"), *FString::Join(Parameters, TEXT(", ")));
	}

	struct FClassOutput
	{
		FString Declaration;
		TSharedPtr<FJsonObject> Runtime;
	};

	const UClass* ComponentClassOf(const UClass* Owner, const FProperty* Property)
	{
		const FObjectProperty* Object = CastField<FObjectProperty>(Property);
		const UObject* Component = Object && Owner->IsChildOf(Object->GetOwnerClass()) ? Object->GetObjectPropertyValue_InContainer(Owner->GetDefaultObject()) : nullptr;
		return Component ? Component->GetClass() : Object->PropertyClass.Get();
	}

	FClassOutput DescribeClass(const UClass* Class)
	{
		const UClass* Parent = Class->GetSuperClass();
		const bool bRoot = Class == AActor::StaticClass() || Class == UActorComponent::StaticClass();
		const FString Base = bRoot ? (Class == AActor::StaticClass() ? TEXT("ActorElement") : TEXT("ComponentElement"))
			: FString::Printf(TEXT("%sProps"), *Parent->GetName());

		FString Body;
		TSharedPtr<FJsonObject> Props = MakeShared<FJsonObject>();
		TSet<FString> Seen;
		for (TFieldIterator<FProperty> It(Class, EFieldIteratorFlags::ExcludeSuper); It; ++It)
		{
			const FProperty* Property = *It;
			if (!IsProp(Property))
			{
				continue;
			}
			FString PropName;
			FString Type;
			if (const FMulticastDelegateProperty* Delegate = CastField<FMulticastDelegateProperty>(Property))
			{
				const FString Name = Property->GetName();
				PropName = TEXT("on") + (Name.StartsWith(TEXT("On"), ESearchCase::CaseSensitive) ? Name.Mid(2) : Name);
				Type = HandlerType(Delegate);
			}
			else if (IsComponentPointer(Property))
			{
				PropName = CamelCase(Property->GetName());
				Type = FString::Printf(TEXT("Partial<%sProps>"), *ComponentClassOf(Class, Property)->GetName());
			}
			else
			{
				PropName = CamelCase(WithoutBoolPrefix(Property));
				Type = TsType(Property);
			}
			const UFunction* Setter = nullptr;
			if (!CastField<FMulticastDelegateProperty>(Property) && !IsComponentPointer(Property))
			{
				// Sequencer's rule for a property set from outside: a UFunction "Set<Name>" with a parameter.
				Setter = Class->FindFunctionByName(FName(TEXT("Set") + WithoutBoolPrefix(Property)));
				Setter = Setter && Setter->NumParms >= 1 ? Setter : nullptr;
			}
			if (Type.IsEmpty() || Seen.Contains(PropName) || (Property->HasAnyPropertyFlags(CPF_EditorOnly) && !Setter))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: %s;\n"), *PropName, *Type);

			TArray<TSharedPtr<FJsonValue>> Entry = { MakeShared<FJsonValueString>(Property->GetName()), MakeShared<FJsonValueString>(Kind(Property)) };
			if (Setter)
			{
				Entry.Add(MakeShared<FJsonValueString>(Setter->GetName()));
			}
			Props->SetArrayField(PropName, Entry);
		}

		for (TFieldIterator<FProperty> It(Parent); It && !bRoot; ++It)
		{
			const FProperty* Property = *It;
			if (!IsComponentPointer(Property) || !IsProp(Property) || Property->HasAnyPropertyFlags(CPF_EditorOnly))
			{
				continue;
			}
			const UClass* Here = ComponentClassOf(Class, Property);
			const FString PropName = CamelCase(Property->GetName());
			if (Here == ComponentClassOf(Parent, Property) || Seen.Contains(PropName))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: Partial<%sProps>;\n"), *PropName, *Here->GetName());
			Props->SetArrayField(PropName, { MakeShared<FJsonValueString>(Property->GetName()), MakeShared<FJsonValueString>(Kind(Property)) });
		}

		// Settings that live behind a Blueprint setter with no property of their own (SetSimulatePhysics writes into
		// FBodyInstance): a BlueprintCallable "Set<Name>" taking one value is a write-only prop.
		for (TFieldIterator<UFunction> It(Class, EFieldIteratorFlags::ExcludeSuper); It; ++It)
		{
			const UFunction* Function = *It;
			const FString Name = Function->GetName();
			if (!Function->HasAnyFunctionFlags(FUNC_BlueprintCallable) || !Name.StartsWith(TEXT("Set"), ESearchCase::CaseSensitive) || Name.Len() < 4 || !FChar::IsUpper(Name[3]))
			{
				continue;
			}
			const FProperty* Parameter = nullptr;
			int32 Parameters = 0;
			for (TFieldIterator<FProperty> Param(Function); Param && Param->HasAnyPropertyFlags(CPF_Parm); ++Param)
			{
				if (Param->HasAnyPropertyFlags(CPF_ReturnParm))
				{
					continue;
				}
				Parameter = Param->HasAnyPropertyFlags(CPF_OutParm) && !Param->HasAnyPropertyFlags(CPF_ConstParm) ? nullptr : *Param;
				++Parameters;
			}
			const FString PropName = CamelCase(Name.Mid(3));
			const FString Type = Parameter && Parameters == 1 ? TsType(Parameter) : FString();
			if (Type.IsEmpty() || Seen.Contains(PropName) || Class->FindPropertyByName(FName(Name.Mid(3))) || Class->FindPropertyByName(FName(TEXT("b") + Name.Mid(3))))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: %s;\n"), *PropName, *Type);
			Props->SetArrayField(PropName, { MakeShared<FJsonValueString>(Name), MakeShared<FJsonValueString>(TEXT("call:") + Kind(Parameter)), MakeShared<FJsonValueString>(Name) });
		}

		FClassOutput Output;
		Output.Declaration = FString::Printf(TEXT("export interface %sProps extends %s {\n%s}\n"), *Class->GetName(), *Base, *Body);
		Output.Runtime = MakeShared<FJsonObject>();
		if (!bRoot)
		{
			Output.Runtime->SetStringField(TEXT("parent"), Parent->GetName());
		}
		Output.Runtime->SetObjectField(TEXT("props"), Props);
		return Output;
	}

	// ---- Material graph elements (src/shared/material): a material module describes a material as data, which
	// the content service builds (VgeMaterialBuilder.cpp); values are plain JSON, so enums are their names and assets
	// their object paths.

	const UScriptStruct* ExpressionInputStruct()
	{
		static const UScriptStruct* Struct = FindObject<UScriptStruct>(nullptr, TEXT("/Script/Engine.ExpressionInput"));
		return Struct;
	}

	bool IsExpressionInput(const FProperty* Property)
	{
		const FStructProperty* Struct = CastField<FStructProperty>(Property);
		return Struct && ExpressionInputStruct() && Struct->Struct->IsChildOf(ExpressionInputStruct());
	}

	// An enum's values as the builder accepts them: the full name and the name without its prefix (BLEND_Opaque, Opaque).
	FString EnumUnion(const UEnum* Enum)
	{
		TArray<FString> Names;
		const int32 Count = Enum->ContainsExistingMax() ? Enum->NumEnums() - 1 : Enum->NumEnums();
		for (int32 Index = 0; Index < Count; ++Index)
		{
			if (Enum->HasMetaData(TEXT("Hidden"), Index))
			{
				continue;
			}
			const FString Full = Enum->GetNameStringByIndex(Index);
			int32 Underscore;
			Names.AddUnique(FString::Printf(TEXT("'%s'"), *Full));
			if (Full.FindChar(TEXT('_'), Underscore))
			{
				Names.AddUnique(FString::Printf(TEXT("'%s'"), *Full.Mid(Underscore + 1)));
			}
		}
		return Names.IsEmpty() ? TEXT("string") : FString::Join(Names, TEXT(" | "));
	}

	FString MaterialValueType(const FProperty* Property)
	{
		if (CastField<FBoolProperty>(Property))
		{
			return TEXT("boolean");
		}
		if (const FEnumProperty* Enum = CastField<FEnumProperty>(Property))
		{
			return EnumUnion(Enum->GetEnum());
		}
		if (const FByteProperty* Byte = CastField<FByteProperty>(Property); Byte && Byte->Enum)
		{
			return EnumUnion(Byte->Enum);
		}
		if (CastField<FNumericProperty>(Property))
		{
			return TEXT("number");
		}
		if (CastField<FStrProperty>(Property) || CastField<FNameProperty>(Property) || CastField<FTextProperty>(Property) || CastField<FObjectPropertyBase>(Property))
		{
			return TEXT("string");
		}
		if (const FStructProperty* Struct = CastField<FStructProperty>(Property))
		{
			static const TSet<FName> Vectors = { TEXT("LinearColor"), TEXT("Color"), TEXT("Vector"), TEXT("Vector3f"), TEXT("Vector2D"), TEXT("Vector2f"), TEXT("Vector4"), TEXT("Vector4f") };
			return Vectors.Contains(Struct->Struct->GetFName()) ? TEXT("MaterialTuple") : TEXT("Readonly<Record<string, unknown>>");
		}
		if (const FArrayProperty* Array = CastField<FArrayProperty>(Property))
		{
			const FString Inner = MaterialValueType(Array->Inner);
			return Inner.IsEmpty() ? FString() : FString::Printf(TEXT("ReadonlyArray<%s>"), *Inner);
		}
		return FString();
	}

	bool IsMaterialProp(const FProperty* Property)
	{
		return Property->HasAnyPropertyFlags(CPF_Edit) && !Property->HasAnyPropertyFlags(CPF_EditConst | CPF_Deprecated);
	}

	// Declarations of one expression class (its own and inherited props flattened: the classes are leaves) and its
	// runtime entry: the class and the props that are inputs, whose plain values become constants.
	FString DescribeExpression(const UClass* Class, TSharedPtr<FJsonObject>& Runtime)
	{
		FString Body;
		TSet<FString> Seen = { TEXT("output"), TEXT("key") };
		TArray<TSharedPtr<FJsonValue>> Inputs;
		// A Custom expression's inputs, extra outputs and defines are written as objects keyed by name
		// (src/shared/material/describe.ts turns them into its arrays).
		if (Class->GetName() == TEXT("MaterialExpressionCustom"))
		{
			Body += TEXT("  inputs?: Readonly<Record<string, MaterialInput>>;\n");
			Body += FString::Printf(TEXT("  additionalOutputs?: Readonly<Record<string, %s>>;\n"), *EnumUnion(StaticEnum<ECustomMaterialOutputType>()));
			Body += TEXT("  additionalDefines?: Readonly<Record<string, string | number>>;\n");
			Seen.Add(TEXT("inputs"));
			Seen.Add(TEXT("additionalOutputs"));
			Seen.Add(TEXT("additionalDefines"));
		}
		for (TFieldIterator<FProperty> It(Class); It; ++It)
		{
			const FProperty* Property = *It;
			if (Property->HasAnyPropertyFlags(CPF_Deprecated))
			{
				continue;
			}
			FString PropName = CamelCase(WithoutBoolPrefix(Property));
			FString Type;
			if (IsExpressionInput(Property))
			{
				PropName = CamelCase(Property->GetName());
				Type = TEXT("MaterialInput");
			}
			else if (IsMaterialProp(Property))
			{
				Type = MaterialValueType(Property);
			}
			if (Type.IsEmpty() || Seen.Contains(PropName))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: %s;\n"), *PropName, *Type);
			if (Type == TEXT("MaterialInput"))
			{
				Inputs.Add(MakeShared<FJsonValueString>(PropName));
			}
		}
		Runtime = MakeShared<FJsonObject>();
		Runtime->SetStringField(TEXT("class"), Class->GetName());
		Runtime->SetArrayField(TEXT("inputs"), Inputs);
		return FString::Printf(TEXT("export interface %sProps extends MaterialElement {\n%s}\n"), *Class->GetName(), *Body);
	}

	// The <material> root: the material's editable settings, its usages, and its inputs (EMaterialProperty).
	FString DescribeMaterialRoot(TSharedPtr<FJsonObject>& Runtime)
	{
		FString Body;
		TSet<FString> Seen = { TEXT("key"), TEXT("name"), TEXT("usage") };
		TArray<FString> Usages;
		const UEnum* UsageEnum = StaticEnum<EMaterialUsage>();
		for (int32 Index = 0; Index < UsageEnum->NumEnums() - 1; ++Index)
		{
			FString Name = UsageEnum->GetNameStringByIndex(Index);
			Name.RemoveFromStart(TEXT("MATUSAGE_"));
			Usages.Add(FString::Printf(TEXT("'%s'"), *CamelCase(Name)));
		}
		Body += FString::Printf(TEXT("  usage?: ReadonlyArray<%s>;\n"), *FString::Join(Usages, TEXT(" | ")));

		TArray<TSharedPtr<FJsonValue>> Inputs;
		const UEnum* PropertyEnum = StaticEnum<EMaterialProperty>();
		for (int32 Index = 0; Index < PropertyEnum->NumEnums(); ++Index)
		{
			FString Name = PropertyEnum->GetNameStringByIndex(Index);
			// Every input the material editor shows (customData0/1 are clear coat, customizedUVs0..7, pixelDepthOffset,
			// displacement), not what only the engine computes (diffuse and specular colour) nor the enum's aliases.
			static const TSet<FString> NotInputs = { TEXT("MAX"), TEXT("DiffuseColor"), TEXT("SpecularColor"), TEXT("CustomOutput"), TEXT("LastCustomizedUVs"), TEXT("NumCustomizedUVs") };
			if (!Name.RemoveFromStart(TEXT("MP_")) || NotInputs.Contains(Name) || Name.EndsWith(TEXT("_DEPRECATED")))
			{
				continue;
			}
			const FString PropName = CamelCase(Name);
			// A setting of the same name wins (shadingModel is the material's shading model, not its input).
			const FProperty* Setting = UMaterial::StaticClass()->FindPropertyByName(FName(*Name));
			if (Seen.Contains(PropName) || (Setting && IsMaterialProp(Setting) && !MaterialValueType(Setting).IsEmpty() && !CastField<FStructProperty>(Setting)))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: MaterialInput;\n"), *PropName);
			Inputs.Add(MakeShared<FJsonValueString>(PropName));
		}
		for (TFieldIterator<FProperty> It(UMaterial::StaticClass()); It; ++It)
		{
			const FProperty* Property = *It;
			const FString PropName = CamelCase(WithoutBoolPrefix(Property));
			const FString Type = IsMaterialProp(Property) ? MaterialValueType(Property) : FString();
			if (Type.IsEmpty() || Seen.Contains(PropName))
			{
				continue;
			}
			Seen.Add(PropName);
			Body += FString::Printf(TEXT("  %s?: %s;\n"), *PropName, *Type);
		}
		Runtime = MakeShared<FJsonObject>();
		Runtime->SetStringField(TEXT("class"), TEXT("Material"));
		Runtime->SetArrayField(TEXT("inputs"), Inputs);
		return FString::Printf(TEXT("export interface MaterialProps extends MaterialRootElement {\n%s}\n"), *Body);
	}

	bool WriteMaterialElements(const FString& TypingDir, const TSet<FString>& TakenElements)
	{
		TArray<UClass*> Classes;
		for (TObjectIterator<UClass> It; It; ++It)
		{
			if (It->IsChildOf(UMaterialExpression::StaticClass()) && It->HasAnyClassFlags(CLASS_Native) && !It->HasAnyClassFlags(CLASS_Abstract | CLASS_Deprecated | CLASS_NewerVersionExists))
			{
				Classes.Add(*It);
			}
		}
		Classes.Sort([](const UClass& A, const UClass& B) { return A.GetName() < B.GetName(); });

		FString Declarations = TEXT("// Generated by VgeGenTypings from Unreal reflection (VgeJsxDeclarations.cpp). Do not edit.\n")
			TEXT("import type { MaterialElement, MaterialInput, MaterialRootElement, MaterialTuple } from '../../../src/shared/material/types';\n\n");
		FString Intrinsics;
		TSharedRef<FJsonObject> Elements = MakeShared<FJsonObject>();
		int32 Count = 0;
		for (const UClass* Class : Classes)
		{
			FString Short = Class->GetName();
			Short.RemoveFromStart(TEXT("MaterialExpression"));
			const FString Element = CamelCase(Short);
			// An element name is one namespace with the scene's actors and components (ue-jsx.d.ts).
			if (Element.IsEmpty() || Element == TEXT("material") || TakenElements.Contains(Element))
			{
				UE_LOGF(LogTemp, Display, "VgeJsxDeclarations: material expression %ls has no element ('%ls' is taken)", *Class->GetName(), *Element);
				continue;
			}
			TSharedPtr<FJsonObject> Runtime;
			Declarations += DescribeExpression(Class, Runtime);
			Elements->SetObjectField(Element, Runtime);
			Intrinsics += FString::Printf(TEXT("  %s: %sProps;\n"), *Element, *Class->GetName());
			++Count;
		}
		TSharedPtr<FJsonObject> RootRuntime;
		Declarations += DescribeMaterialRoot(RootRuntime);
		Elements->SetObjectField(TEXT("material"), RootRuntime);
		Intrinsics += TEXT("  material: MaterialProps;\n");
		Declarations += TEXT("\nexport interface MaterialIntrinsicElements {\n") + Intrinsics + TEXT("}\n");

		FString Json;
		FJsonSerializer::Serialize(Elements, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));
		UE_LOGF(LogTemp, Display, "VgeJsxDeclarations: %d material expression elements -> %ls", Count, *TypingDir);
		return FFileHelper::SaveStringToFile(Declarations, *(TypingDir / TEXT("ue-material-jsx.d.ts")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM)
			&& FFileHelper::SaveStringToFile(Json, *(TypingDir / TEXT("ue-material-jsx.json")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	}
}

bool VgeJsxDeclarations::Write(const FString& TypingDir)
{
	TArray<UClass*> Classes;
	for (TObjectIterator<UClass> It; It; ++It)
	{
		if (IsElementClass(*It))
		{
			Classes.Add(*It);
		}
	}
	Classes.Sort([](const UClass& A, const UClass& B) { return A.GetName() < B.GetName(); });

	FString Declarations = TEXT("// Generated by VgeGenTypings from Unreal reflection (VgeJsxDeclarations.cpp). Do not edit.\n")
		TEXT("import type * as UE from 'ue';\n")
		TEXT("import type { ActorElement, ComponentElement, ElementRef, ObjectProp, StructProp } from '../../../src/shared/react/props';\n\n");
	FString Intrinsics;
	TSharedRef<FJsonObject> Runtime = MakeShared<FJsonObject>();
	int32 Elements = 0;
	TSet<FString> ElementNames;
	for (const UClass* Class : Classes)
	{
		const FClassOutput Output = DescribeClass(Class);
		Declarations += Output.Declaration;
		Runtime->SetObjectField(Class->GetName(), Output.Runtime);
		if (!Class->HasAnyClassFlags(CLASS_Abstract))
		{
			Intrinsics += FString::Printf(TEXT("  %s: %sProps & ElementRef<UE.%s>;\n"), *CamelCase(Class->GetName()), *Class->GetName(), *Class->GetName());
			ElementNames.Add(CamelCase(Class->GetName()));
			++Elements;
		}
	}
	if (!WriteMaterialElements(TypingDir, ElementNames))
	{
		return false;
	}
	// React's JSX namespace is extended from src/shared/react/jsx.d.ts: 'react' does not resolve from Typing/.
	Declarations += TEXT("\nexport interface UeIntrinsicElements {\n") + Intrinsics + TEXT("}\n");

	FString Json;
	FJsonSerializer::Serialize(Runtime, TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));

	const bool bWritten = FFileHelper::SaveStringToFile(Declarations, *(TypingDir / TEXT("ue-jsx.d.ts")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM)
		&& FFileHelper::SaveStringToFile(Json, *(TypingDir / TEXT("ue-jsx.json")), FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	UE_LOGF(LogTemp, Display, "VgeJsxDeclarations: %d classes, %d elements -> %ls", Classes.Num(), Elements, *TypingDir);
	return bWritten;
}
