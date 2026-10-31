#include "VgeNiagara.h"

#include "Containers/Ticker.h"
#include "FileHelpers.h"
#include "HAL/PlatformProcess.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraGraph.h"
#include "NiagaraNodeFunctionCall.h"
#include "NiagaraScriptSource.h"
#include "ViewModels/Stack/NiagaraParameterHandle.h"
#include "ViewModels/Stack/NiagaraStackGraphUtilities.h"
#include "NiagaraScript.h"
#include "NiagaraSimulationStageBase.h"
#include "NiagaraSystem.h"
#include "NiagaraTypes.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "ToolsetRegistry/ToolsetRegistry.h"
#include "ToolsetRegistry/ToolsetRegistrySubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogVgeNiagara, Log, All);

namespace
{
	FString ToJson(const TSharedPtr<FJsonObject>& Object)
	{
		FString Json;
		FJsonSerializer::Serialize(Object.ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json));
		return Json;
	}

	// A tool's result is JSON text: an object, an array, a string or nothing (a void tool).
	TSharedPtr<FJsonValue> ParseResult(const FString& Text)
	{
		TSharedPtr<FJsonValue> Value;
		if (Text.IsEmpty() || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Value) || !Value.IsValid())
		{
			return MakeShared<FJsonValueString>(Text);
		}
		return Value;
	}

	// The registry hands back a future; the Niagara tools are game-thread UFUNCTIONs that finish inside the call, but a
	// tool that completes later is waited for while the core ticker runs, as the editor's own loop would.
	TValueOrError<FString, FString> Execute(UE::ToolsetRegistry::FToolsetRegistry& Registry, const FString& Tool, const FString& Input)
	{
		TFuture<TValueOrError<FString, FString>> Future = Registry.ExecuteTool(Tool, Input);
		while (!Future.IsReady())
		{
			FTSTicker::GetCoreTicker().Tick(0.01f);
			FPlatformProcess::Sleep(0.01f);
		}
		return Future.Consume();
	}
}

TSharedRef<FJsonObject> VgeNiagara::RunTools(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	auto Subsystem = UToolsetRegistrySubsystem::Get();
	if (Subsystem.HasError())
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no toolset registry: %s"), *Subsystem.GetError()));
		return Result;
	}
	UE::ToolsetRegistry::FToolsetRegistry& Registry = Subsystem.GetValue()->ToolsetRegistry;

	TArray<TSharedPtr<FJsonValue>> Results;
	const TArray<TSharedPtr<FJsonValue>>& Calls = Request->GetArrayField(TEXT("calls"));
	for (int32 Index = 0; Index < Calls.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> Call = Calls[Index]->AsObject();
		const FString Tool = Call->GetStringField(TEXT("tool"));
		const TSharedPtr<FJsonObject>* Input = nullptr;
		const FString InputJson = Call->TryGetObjectField(TEXT("input"), Input) ? ToJson(*Input) : TEXT("{}");
		TValueOrError<FString, FString> Outcome = Execute(Registry, Tool, InputJson);
		if (Outcome.HasError())
		{
			UE_LOGF(LogVgeNiagara, Error, "%ls failed: %ls (input %ls)", *Tool, *Outcome.GetError(), *InputJson);
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s: %s"), *Tool, *Outcome.GetError()));
			Result->SetNumberField(TEXT("failedCall"), Index);
			break;
		}
		Results.Add(ParseResult(Outcome.GetValue()));
	}
	Result->SetArrayField(TEXT("results"), Results);
	return Result;
}

TSharedRef<FJsonObject> VgeNiagara::Schemas()
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	auto Subsystem = UToolsetRegistrySubsystem::Get();
	if (Subsystem.HasError())
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no toolset registry: %s"), *Subsystem.GetError()));
		return Result;
	}
	Result->SetField(TEXT("schemas"), ParseResult(Subsystem.GetValue()->ToolsetRegistry.GetToolsetJsonSchemas()));
	return Result;
}

namespace
{
	bool WriteConstant(FNiagaraParameterStore& Store, const FNiagaraVariableWithOffset& Variable, const TSharedPtr<FJsonValue>& Value, FString& Error)
	{
		const FNiagaraTypeDefinition Type = Variable.GetType().IsStatic() ? Variable.GetType().RemoveStaticDef() : Variable.GetType();
		const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
		const bool bArray = Value->TryGetArray(Items);
		auto Component = [&](int32 Index) { return static_cast<float>((*Items)[Index]->AsNumber()); };
		if (Type == FNiagaraTypeDefinition::GetFloatDef() && !bArray)
		{
			return Store.SetParameterValue(static_cast<float>(Value->AsNumber()), Variable);
		}
		if (Type == FNiagaraTypeDefinition::GetIntDef() && !bArray)
		{
			return Store.SetParameterValue(static_cast<int32>(Value->AsNumber()), Variable);
		}
		if (Type == FNiagaraTypeDefinition::GetBoolDef() && !bArray)
		{
			FNiagaraBool Flag;
			Flag.SetValue(Value->AsBool());
			return Store.SetParameterValue(Flag, Variable);
		}
		if (Type.IsEnum() && !bArray)
		{
			const UEnum* Enum = Type.GetEnum();
			FString OptionName;
			if (!Value->TryGetString(OptionName))
			{
				return Store.SetParameterValue(static_cast<int32>(Value->AsNumber()), Variable);
			}
			TArray<FString> Options;
			for (int32 Index = 0; Index < Enum->NumEnums() - 1; ++Index)
			{
				const FString DisplayName = Enum->GetDisplayNameTextByIndex(Index).ToString();
				if (DisplayName == OptionName || Enum->GetNameStringByIndex(Index) == OptionName)
				{
					return Store.SetParameterValue(static_cast<int32>(Enum->GetValueByIndex(Index)), Variable);
				}
				Options.Add(DisplayName);
			}
			Error = FString::Printf(TEXT("%s has no option '%s' (options: %s)"), *Variable.GetName().ToString(), *OptionName, *FString::Join(Options, TEXT(", ")));
			return false;
		}
		if ((Type == FNiagaraTypeDefinition::GetVec3Def() || Type == FNiagaraTypeDefinition::GetPositionDef()) && bArray && Items->Num() == 3)
		{
			return Store.SetParameterValue(FVector3f(Component(0), Component(1), Component(2)), Variable);
		}
		if (Type == FNiagaraTypeDefinition::GetVec2Def() && bArray && Items->Num() == 2)
		{
			return Store.SetParameterValue(FVector2f(Component(0), Component(1)), Variable);
		}
		if (Type == FNiagaraTypeDefinition::GetColorDef() && bArray && Items->Num() == 4)
		{
			return Store.SetParameterValue(FLinearColor(Component(0), Component(1), Component(2), Component(3)), Variable);
		}
		if (Type == FNiagaraTypeDefinition::GetVec4Def() && bArray && Items->Num() == 4)
		{
			return Store.SetParameterValue(FVector4f(Component(0), Component(1), Component(2), Component(3)), Variable);
		}
		Error = FString::Printf(TEXT("%s is a %s; the value does not fit it"), *Variable.GetName().ToString(), *Type.GetName());
		return false;
	}
}

namespace
{
	FString ReadConstant(const FNiagaraParameterStore& Store, const FNiagaraVariableWithOffset& Variable)
	{
		const FNiagaraTypeDefinition Type = Variable.GetType().IsStatic() ? Variable.GetType().RemoveStaticDef() : Variable.GetType();
		const uint8* Data = Store.GetParameterData(Variable);
		if (!Data)
		{
			return TEXT("?");
		}
		const float* Floats = reinterpret_cast<const float*>(Data);
		const int32 Value = *reinterpret_cast<const int32*>(Data);
		if (Type == FNiagaraTypeDefinition::GetFloatDef())
		{
			return FString::SanitizeFloat(Floats[0]);
		}
		if (Type == FNiagaraTypeDefinition::GetBoolDef())
		{
			return Value != 0 ? TEXT("true") : TEXT("false");
		}
		if (Type.IsEnum())
		{
			return Type.GetEnum()->GetDisplayNameTextByValue(Value).ToString();
		}
		if (Type == FNiagaraTypeDefinition::GetIntDef())
		{
			return FString::FromInt(Value);
		}
		const int32 Count = Type == FNiagaraTypeDefinition::GetVec2Def() ? 2
			: (Type == FNiagaraTypeDefinition::GetVec3Def() || Type == FNiagaraTypeDefinition::GetPositionDef()) ? 3
			: (Type == FNiagaraTypeDefinition::GetVec4Def() || Type == FNiagaraTypeDefinition::GetColorDef()) ? 4 : 0;
		if (Count == 0)
		{
			return Type.GetName();
		}
		TArray<FString> Components;
		for (int32 Index = 0; Index < Count; ++Index)
		{
			Components.Add(FString::SanitizeFloat(Floats[Index]));
		}
		return FString::Printf(TEXT("[%s]"), *FString::Join(Components, TEXT(" ")));
	}
}

namespace
{
	bool LinkInput(UNiagaraSystem& System, FVersionedNiagaraEmitterData& Data, const FString& Key, const FNiagaraTypeDefinition& Type, const FString& LinkName, FString& Error)
	{
		FString ModuleName;
		FString InputName;
		if (!Key.Split(TEXT("."), &ModuleName, &InputName))
		{
			Error = FString::Printf(TEXT("%s: a link takes '<module>.<input>'"), *Key);
			return false;
		}
		const FNiagaraVariableWithOffset* UserVariable = System.GetExposedParameters().ReadParameterVariables().FindByPredicate([&](const FNiagaraVariableWithOffset& Candidate) { return Candidate.GetName().ToString() == LinkName; });
		if (!UserVariable)
		{
			Error = FString::Printf(TEXT("%s links %s, which the system's user parameters do not have"), *Key, *LinkName);
			return false;
		}
		if (UserVariable->GetType() != Type)
		{
			Error = FString::Printf(TEXT("%s is a %s; %s is a %s"), *Key, *Type.GetName(), *LinkName, *UserVariable->GetType().GetName());
			return false;
		}
		UNiagaraScriptSource* Source = Cast<UNiagaraScriptSource>(Data.GraphSource);
		TArray<UNiagaraNodeFunctionCall*> Calls;
		if (Source && Source->NodeGraph)
		{
			Source->NodeGraph->GetNodesOfClass(Calls);
		}
		UNiagaraNodeFunctionCall* const* Call = Calls.FindByPredicate([&](const UNiagaraNodeFunctionCall* Candidate) { return Candidate->GetFunctionName() == ModuleName; });
		if (!Call)
		{
			Error = FString::Printf(TEXT("%s: the emitter graph has no module %s"), *Key, *ModuleName);
			return false;
		}
		Source->NodeGraph->Modify();
		const FNiagaraParameterHandle Aliased = FNiagaraParameterHandle::CreateAliasedModuleParameterHandle(FNiagaraParameterHandle::CreateModuleParameterHandle(*InputName), *Call);
		UEdGraphPin& OverridePin = FNiagaraStackGraphUtilities::GetOrCreateStackFunctionInputOverridePin(**Call, Aliased, Type, FGuid(), FGuid());
		const FNiagaraVariableBase Linked(Type, *LinkName);
		FNiagaraStackGraphUtilities::SetLinkedParameterValueForFunctionInput(OverridePin, Linked, { Linked }, ENiagaraDefaultMode::FailIfPreviouslyNotSet);
		return true;
	}
}

TSharedRef<FJsonObject> VgeNiagara::SetConstants(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString Path = Request->GetStringField(TEXT("path"));
	const FString EmitterName = Request->GetStringField(TEXT("emitter"));
	UNiagaraSystem* System = LoadObject<UNiagaraSystem>(nullptr, *Path);
	if (!System)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no Niagara system %s"), *Path));
		return Result;
	}
	const FNiagaraEmitterHandle* Handle = System->GetEmitterHandles().FindByPredicate([&](const FNiagaraEmitterHandle& Candidate) { return Candidate.GetName().ToString() == EmitterName; });
	FVersionedNiagaraEmitterData* Data = Handle ? Handle->GetEmitterData() : nullptr;
	if (!Data)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s has no emitter %s"), *Path, *EmitterName));
		return Result;
	}
	const FString Prefix = FString::Printf(TEXT("Constants.%s."), *Handle->GetUniqueInstanceName());
	TArray<UNiagaraScript*> Scripts;
	Data->GetScripts(Scripts, false, false);

	TMap<FString, TArray<TPair<UNiagaraScript*, FNiagaraVariableWithOffset>>> Constants;
	for (UNiagaraScript* Script : Scripts)
	{
		for (const FNiagaraVariableWithOffset& Variable : Script->RapidIterationParameters.ReadParameterVariables())
		{
			const FString Name = Variable.GetName().ToString();
			if (Name.StartsWith(Prefix))
			{
				Constants.FindOrAdd(Name.RightChop(Prefix.Len())).Add({ Script, Variable });
			}
		}
	}

	const TSharedPtr<FJsonObject>* Values = nullptr;
	if (!Request->TryGetObjectField(TEXT("values"), Values))
	{
		TArray<FString> Names;
		Constants.GetKeys(Names);
		Names.Sort();
		Result->SetStringField(TEXT("constants"), FString::Join(Names, TEXT(", ")));
		return Result;
	}
	System->Modify();
	int32 Written = 0;
	FNiagaraUserRedirectionParameterStore& UserStore = System->GetExposedParameters();
	for (const TPair<FString, TSharedPtr<FJsonValue>>& Entry : (*Values)->Values)
	{
		if (Entry.Key.StartsWith(TEXT("User.")))
		{
			const FNiagaraVariableWithOffset* UserVariable = UserStore.ReadParameterVariables().FindByPredicate([&](const FNiagaraVariableWithOffset& Candidate) { return Candidate.GetName().ToString() == Entry.Key; });
			FString Error;
			if (!UserVariable || !WriteConstant(UserStore, *UserVariable, Entry.Value, Error))
			{
				TArray<FString> Names;
				for (const FNiagaraVariableWithOffset& Candidate : UserStore.ReadParameterVariables())
				{
					Names.Add(FString::Printf(TEXT("%s (%s)"), *Candidate.GetName().ToString(), *Candidate.GetType().GetName()));
				}
				Result->SetStringField(TEXT("error"), UserVariable ? Error : FString::Printf(TEXT("the system has no %s (user parameters: %s)"), *Entry.Key, *FString::Join(Names, TEXT(", "))));
				return Result;
			}
			++Written;
			continue;
		}
		if (Entry.Key.StartsWith(TEXT("Stage.")))
		{
			const FName StageName(*Entry.Key.RightChop(6));
			UNiagaraSimulationStageBase* const* Stage = Data->GetSimulationStages().FindByPredicate([&](const UNiagaraSimulationStageBase* Candidate) { return Candidate && Candidate->SimulationStageName == StageName; });
			bool bEnabled = false;
			if (!Stage || !Entry.Value->TryGetBool(bEnabled))
			{
				TArray<FString> Stages;
				for (const UNiagaraSimulationStageBase* Candidate : Data->GetSimulationStages())
				{
					Stages.Add(Candidate ? Candidate->SimulationStageName.ToString() : TEXT("?"));
				}
				Result->SetStringField(TEXT("error"), Stage ? FString::Printf(TEXT("%s takes true or false"), *Entry.Key) : FString::Printf(TEXT("%s has no simulation stage %s (stages: %s)"), *EmitterName, *StageName.ToString(), *FString::Join(Stages, TEXT(", "))));
				return Result;
			}
			(*Stage)->SetEnabled(bEnabled);
			++Written;
			continue;
		}
		const TArray<TPair<UNiagaraScript*, FNiagaraVariableWithOffset>>* Targets = Constants.Find(Entry.Key);
		if (!Targets)
		{
			TArray<FString> Names;
			for (const UNiagaraSimulationStageBase* Stage : Data->GetSimulationStages())
			{
				if (Stage)
				{
					Names.Add(FString::Printf(TEXT("Stage.%s=%s"), *Stage->SimulationStageName.ToString(), Stage->bEnabled ? TEXT("true") : TEXT("false")));
				}
			}
			for (const TPair<FString, TArray<TPair<UNiagaraScript*, FNiagaraVariableWithOffset>>>& Constant : Constants)
			{
				const TPair<UNiagaraScript*, FNiagaraVariableWithOffset>& First = Constant.Value[0];
				Names.Add(FString::Printf(TEXT("%s=%s"), *Constant.Key, *ReadConstant(First.Key->RapidIterationParameters, First.Value)));
			}
			Names.Sort();
			Result->SetStringField(TEXT("error"), FString::Printf(TEXT("%s has no constant %s (constants: %s)"), *EmitterName, *Entry.Key, *FString::Join(Names, TEXT(", "))));
			return Result;
		}
		const TSharedPtr<FJsonObject>* LinkObject = nullptr;
		FString LinkName;
		if (Entry.Value->TryGetObject(LinkObject) && (*LinkObject)->TryGetStringField(TEXT("link"), LinkName))
		{
			const FNiagaraVariableWithOffset& First = (*Targets)[0].Value;
			const FNiagaraTypeDefinition Type = First.GetType().IsStatic() ? First.GetType().RemoveStaticDef() : First.GetType();
			FString Error;
			if (!LinkInput(*System, *Data, Entry.Key, Type, LinkName, Error))
			{
				Result->SetStringField(TEXT("error"), Error);
				return Result;
			}
			++Written;
			continue;
		}
		for (const TPair<UNiagaraScript*, FNiagaraVariableWithOffset>& Target : *Targets)
		{
			FString Error;
			Target.Key->Modify();
			if (!WriteConstant(Target.Key->RapidIterationParameters, Target.Value, Entry.Value, Error))
			{
				Result->SetStringField(TEXT("error"), Error.IsEmpty() ? FString::Printf(TEXT("could not set %s"), *Entry.Key) : Error);
				return Result;
			}
			++Written;
		}
	}
	Result->SetNumberField(TEXT("written"), Written);
	return Result;
}

TSharedRef<FJsonObject> VgeNiagara::Save(const TSharedPtr<FJsonObject>& Request)
{
	TSharedRef<FJsonObject> Result = MakeShared<FJsonObject>();
	const FString Path = Request->GetStringField(TEXT("path"));
	UNiagaraSystem* System = LoadObject<UNiagaraSystem>(nullptr, *Path);
	if (!System)
	{
		Result->SetStringField(TEXT("error"), FString::Printf(TEXT("no Niagara system %s"), *Path));
		return Result;
	}
	System->RequestCompile(/*bForce*/ false);
	System->WaitForCompilationComplete(/*bIncludingGPUShaders*/ false, /*bShowProgress*/ false);
	Result->SetBoolField(TEXT("compiled"), System->IsReadyToRun());
	Result->SetBoolField(TEXT("saved"), UEditorLoadingAndSavingUtils::SavePackages({ System->GetPackage() }, /*bOnlyDirty*/ false));
	return Result;
}
