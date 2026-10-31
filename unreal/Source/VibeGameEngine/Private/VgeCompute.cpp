#include "VgeCompute.h"

#include "ComputeFramework/ComputeFramework.h"
#include "ComputeFramework/ComputeGraph.h"
#include "ComputeFramework/ShaderParamTypeDefinition.h"
#include "ComputeWorkerInterface.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GenerateMips.h"
#include "PooledRenderTarget.h"
#include "RenderGraphBuilder.h"
#include "RenderGraphUtils.h"
#include "ShaderParameterMetadataBuilder.h"
#include "TextureResource.h"
#include <atomic>

namespace
{
	const TCHAR* const TextureHlsl = TEXT("uint2 {UID}_Size; RWTexture2D<float4> {UID}_Texture;\n")
		TEXT("uint2 Size_{UID}() { return {UID}_Size; }\n")
		TEXT("float4 Load_{UID}(int2 P) { return {UID}_Texture[P]; }\n")
		TEXT("void Store_{UID}(int2 P, float4 V) { {UID}_Texture[P] = V; }\n");

	const TCHAR* const BufferHlsl = TEXT("uint {UID}_Count; RWStructuredBuffer<{TYPE}> {UID}_Buffer;\n")
		TEXT("uint Count_{UID}() { return {UID}_Count; }\n")
		TEXT("{TYPE} Load_{UID}(uint I) { return {UID}_Buffer[I]; }\n")
		TEXT("void Store_{UID}(uint I, {TYPE} V) { {UID}_Buffer[I] = V; }\n");

	const TCHAR* const DispatchHlsl = TEXT("uint3 {UID}_NumThreads;\n")
		TEXT("uint3 ReadNumThreads_{UID}() { return {UID}_NumThreads; }\n");

	FString Fill(const TCHAR* Template, FString const& Uid, FString const& Type = FString())
	{
		return FString(Template).Replace(TEXT("{UID}"), *Uid).Replace(TEXT("{TYPE}"), *Type);
	}

	FShaderValueTypeHandle FloatType(int32 Components)
	{
		return Components <= 1 ? FShaderValueType::Get(EShaderFundamentalType::Float) : FShaderValueType::Get(EShaderFundamentalType::Float, Components);
	}

	FString FloatTypeName(int32 Components)
	{
		return Components <= 1 ? FString(TEXT("float")) : FString::Printf(TEXT("float%d"), Components);
	}

	struct FVgeComputeCounters
	{
		std::atomic<int32> Valid{ 0 };
		std::atomic<int32> Invalid{ 0 };
		std::atomic<int32> Allocated{ 0 };
		std::atomic<int32> Gathered{ 0 };
	};

	FVgeComputeCounters TextureCounters;
	FVgeComputeCounters BufferCounters;
	FVgeComputeCounters ParamsCounters;
	FVgeComputeCounters DispatchCounters;
	std::atomic<int32> Enqueued{ 0 };
	std::atomic<int32> Refused{ 0 };

	bool Count(FVgeComputeCounters& Counters, bool bValid)
	{
		(bValid ? Counters.Valid : Counters.Invalid)++;
		return bValid;
	}

	FString Describe(const TCHAR* Name, const FVgeComputeCounters& Counters)
	{
		return FString::Printf(TEXT("%s valid=%d invalid=%d allocated=%d gathered=%d"), Name, Counters.Valid.load(), Counters.Invalid.load(), Counters.Allocated.load(), Counters.Gathered.load());
	}

	void CallInitialize(UComputeDataProvider* Provider, int32 Index, UObject* Binding)
	{
		if (UVgeComputeComponent* Component = Cast<UVgeComputeComponent>(Binding))
		{
			Component->AddProvider(Provider);
		}
	}
}

BEGIN_SHADER_PARAMETER_STRUCT(FVgeComputeTextureParameters, )
	SHADER_PARAMETER(FUintVector2, Size)
	SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2D<float4>, Texture)
END_SHADER_PARAMETER_STRUCT()

BEGIN_SHADER_PARAMETER_STRUCT(FVgeComputeBufferParameters, )
	SHADER_PARAMETER(uint32, Count)
	SHADER_PARAMETER_RDG_BUFFER_UAV(RWStructuredBuffer<float4>, Buffer)
END_SHADER_PARAMETER_STRUCT()

BEGIN_SHADER_PARAMETER_STRUCT(FVgeComputeParamsParameters, )
	SHADER_PARAMETER_ARRAY(FVector4f, Values, [UVgeComputeParams::MaxValues])
END_SHADER_PARAMETER_STRUCT()

BEGIN_SHADER_PARAMETER_STRUCT(FVgeComputeDispatchParameters, )
	SHADER_PARAMETER(FUintVector3, NumThreads)
END_SHADER_PARAMETER_STRUCT()

class FVgeComputeTextureProxy : public FComputeDataProviderRenderProxy
{
public:
	explicit FVgeComputeTextureProxy(FTextureRenderTargetResource* InResource) : Resource(InResource) {}

	virtual bool IsValid(FValidationData const& InValidationData) const override
	{
		return Count(TextureCounters, InValidationData.ParameterStructSize == sizeof(FVgeComputeTextureParameters) && Resource && Resource->TextureRHI.IsValid());
	}

	virtual void AllocateResources(FRDGBuilder& GraphBuilder, FAllocationData const& InAllocationData) override
	{
		TextureCounters.Allocated++;
		Texture =GraphBuilder.RegisterExternalTexture(CreateRenderTarget(Resource->TextureRHI, TEXT("VgeCompute.Texture")));
		View = GraphBuilder.CreateUAV(FRDGTextureUAVDesc(Texture, 0));
	}

	virtual void GatherDispatchData(FDispatchData const& InDispatchData) override
	{
		TextureCounters.Gathered++;
		const TStridedView<FVgeComputeTextureParameters> Parameters = MakeStridedParameterView<FVgeComputeTextureParameters>(InDispatchData);
		const FIntVector Extent = Texture->Desc.GetSize();
		for (FVgeComputeTextureParameters& Parameter : Parameters)
		{
			Parameter.Size = FUintVector2(Extent.X, Extent.Y);
			Parameter.Texture = View;
		}
	}

	virtual void PostSubmit(FComputeContext& Context) const override
	{
		if (Texture && Texture->Desc.NumMips > 1)
		{
			FGenerateMipsParams Params;
			Params.AddressU = AM_Wrap;
			Params.AddressV = AM_Wrap;
			FGenerateMips::Execute(Context.GraphBuilder, Context.FeatureLevel, Texture, Params);
		}
	}

private:
	FTextureRenderTargetResource* Resource = nullptr;
	FRDGTextureRef Texture = nullptr;
	FRDGTextureUAVRef View = nullptr;
};

class FVgeComputeBufferProxy : public FComputeDataProviderRenderProxy
{
public:
	FVgeComputeBufferProxy(int32 InElements, int32 InComponents, TSharedPtr<FVgeComputeBufferStorage, ESPMode::ThreadSafe> InStorage)
		: Elements(InElements), Components(InComponents), Storage(MoveTemp(InStorage)) {}

	virtual bool IsValid(FValidationData const& InValidationData) const override
	{
		return Count(BufferCounters, InValidationData.ParameterStructSize == sizeof(FVgeComputeBufferParameters) && Elements > 0 && Storage.IsValid());
	}

	virtual void AllocateResources(FRDGBuilder& GraphBuilder, FAllocationData const& InAllocationData) override
	{
		BufferCounters.Allocated++;
		const uint32 Stride = sizeof(float) * Components;
		if (Storage->Buffer.IsValid() && Storage->Buffer->Desc.BytesPerElement == Stride && Storage->Buffer->Desc.NumElements == (uint32)Elements)
		{
			Buffer = GraphBuilder.RegisterExternalBuffer(Storage->Buffer, TEXT("VgeCompute.Buffer"));
		}
		else
		{
			Buffer = GraphBuilder.CreateBuffer(FRDGBufferDesc::CreateStructuredDesc(Stride, Elements), TEXT("VgeCompute.Buffer"));
			AddClearUAVPass(GraphBuilder, GraphBuilder.CreateUAV(Buffer), 0u);
			Storage->Buffer = GraphBuilder.ConvertToExternalBuffer(Buffer);
		}
		View = GraphBuilder.CreateUAV(Buffer);
	}

	virtual void GatherDispatchData(FDispatchData const& InDispatchData) override
	{
		BufferCounters.Gathered++;
		for (FVgeComputeBufferParameters& Parameter : MakeStridedParameterView<FVgeComputeBufferParameters>(InDispatchData))
		{
			Parameter.Count = Elements;
			Parameter.Buffer = View;
		}
	}

private:
	int32 Elements = 0;
	int32 Components = 4;
	TSharedPtr<FVgeComputeBufferStorage, ESPMode::ThreadSafe> Storage;
	FRDGBufferRef Buffer = nullptr;
	FRDGBufferUAVRef View = nullptr;
};

class FVgeComputeParamsProxy : public FComputeDataProviderRenderProxy
{
public:
	explicit FVgeComputeParamsProxy(TArray<FVector4f> InValues) : Values(MoveTemp(InValues)) {}

	virtual bool IsValid(FValidationData const& InValidationData) const override
	{
		return Count(ParamsCounters, InValidationData.ParameterStructSize == sizeof(FVgeComputeParamsParameters));
	}

	virtual void GatherDispatchData(FDispatchData const& InDispatchData) override
	{
		ParamsCounters.Gathered++;
		for (FVgeComputeParamsParameters& Parameter : MakeStridedParameterView<FVgeComputeParamsParameters>(InDispatchData))
		{
			for (int32 Index = 0; Index < UVgeComputeParams::MaxValues; Index++)
			{
				Parameter.Values[Index] = Values.IsValidIndex(Index) ? Values[Index] : FVector4f::Zero();
			}
		}
	}

private:
	TArray<FVector4f> Values;
};

class FVgeComputeDispatchProxy : public FComputeDataProviderRenderProxy
{
public:
	explicit FVgeComputeDispatchProxy(FIntVector InThreadCount) : ThreadCount(InThreadCount) {}

	virtual bool IsValid(FValidationData const& InValidationData) const override
	{
		return Count(DispatchCounters, InValidationData.ParameterStructSize == sizeof(FVgeComputeDispatchParameters) && ThreadCount.X > 0 && ThreadCount.Y > 0 && ThreadCount.Z > 0);
	}

	virtual int32 GetDispatchThreadCount(TArray<FIntVector>& InOutThreadCounts) const override
	{
		InOutThreadCounts.Reset();
		InOutThreadCounts.Add(ThreadCount);
		return 1;
	}

	virtual void GatherDispatchData(FDispatchData const& InDispatchData) override
	{
		DispatchCounters.Gathered++;
		for (FVgeComputeDispatchParameters& Parameter : MakeStridedParameterView<FVgeComputeDispatchParameters>(InDispatchData))
		{
			Parameter.NumThreads = FUintVector3(ThreadCount.X, ThreadCount.Y, ThreadCount.Z);
		}
	}

private:
	FIntVector ThreadCount;
};

void UVgeComputeTexture::GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Size")).AddReturnType(EShaderFundamentalType::Uint, 2);
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Load")).AddReturnType(EShaderFundamentalType::Float, 4).AddParam(EShaderFundamentalType::Int, 2);
}

void UVgeComputeTexture::GetSupportedOutputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Store")).AddParam(EShaderFundamentalType::Int, 2).AddParam(EShaderFundamentalType::Float, 4);
}

void UVgeComputeTexture::GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const
{
	InOutBuilder.AddNestedStruct<FVgeComputeTextureParameters>(UID);
}

void UVgeComputeTexture::GetShaderHash(FString& InOutKey) const
{
	InOutKey += TextureHlsl;
}

void UVgeComputeTexture::GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const
{
	OutHLSL += Fill(TextureHlsl, InDataInterfaceName);
}

UComputeDataProvider* UVgeComputeTexture::CreateDataProvider() const
{
	UVgeComputeTextureProvider* Provider = NewObject<UVgeComputeTextureProvider>();
	Provider->ResourceName = ResourceName;
	return Provider;
}

void UVgeComputeTextureProvider::Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask)
{
	CallInitialize(this, InDataInterfaceIndex, InBinding);
}

void UVgeComputeTextureProvider::SetTarget(UTextureRenderTarget2D* InTarget)
{
	Target = InTarget;
	Resource = InTarget ? InTarget->GameThread_GetRenderTargetResource() : nullptr;
}

FComputeDataProviderRenderProxy* UVgeComputeTextureProvider::GetRenderProxy()
{
	return new FVgeComputeTextureProxy(Resource);
}

void UVgeComputeBuffer::GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Count")).AddReturnType(EShaderFundamentalType::Uint);
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Load")).AddReturnType(FloatType(Components)).AddParam(EShaderFundamentalType::Uint);
}

void UVgeComputeBuffer::GetSupportedOutputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("Store")).AddParam(EShaderFundamentalType::Uint).AddParam(FloatType(Components));
}

void UVgeComputeBuffer::GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const
{
	InOutBuilder.AddNestedStruct<FVgeComputeBufferParameters>(UID);
}

void UVgeComputeBuffer::GetShaderHash(FString& InOutKey) const
{
	InOutKey += Fill(BufferHlsl, TEXT(""), FloatTypeName(Components));
}

void UVgeComputeBuffer::GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const
{
	OutHLSL += Fill(BufferHlsl, InDataInterfaceName, FloatTypeName(Components));
}

UComputeDataProvider* UVgeComputeBuffer::CreateDataProvider() const
{
	UVgeComputeBufferProvider* Provider = NewObject<UVgeComputeBufferProvider>();
	Provider->Elements = Elements;
	Provider->Components = FMath::Clamp(Components, 1, 4);
	return Provider;
}

void UVgeComputeBufferProvider::Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask)
{
	CallInitialize(this, InDataInterfaceIndex, InBinding);
}

FComputeDataProviderRenderProxy* UVgeComputeBufferProvider::GetRenderProxy()
{
	return new FVgeComputeBufferProxy(Elements, Components, Storage);
}

void UVgeComputeParams::GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	for (const FString& Name : Names)
	{
		OutFunctions.AddDefaulted_GetRef().SetName(Name).AddReturnType(EShaderFundamentalType::Float, 4);
	}
}

void UVgeComputeParams::GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const
{
	InOutBuilder.AddNestedStruct<FVgeComputeParamsParameters>(UID);
}

void UVgeComputeParams::GetShaderHash(FString& InOutKey) const
{
	InOutKey += FString::Join(Names, TEXT(","));
}

void UVgeComputeParams::GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const
{
	OutHLSL += FString::Printf(TEXT("float4 %s_Values[%d];\n"), *InDataInterfaceName, MaxValues);
	for (int32 Index = 0; Index < Names.Num(); Index++)
	{
		OutHLSL += FString::Printf(TEXT("float4 %s_%s() { return %s_Values[%d]; }\n"), *Names[Index], *InDataInterfaceName, *InDataInterfaceName, Index);
	}
}

UComputeDataProvider* UVgeComputeParams::CreateDataProvider() const
{
	UVgeComputeParamsProvider* Provider = NewObject<UVgeComputeParamsProvider>();
	Provider->Names = Names;
	Provider->Values.SetNumZeroed(Names.Num());
	return Provider;
}

void UVgeComputeParamsProvider::Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask)
{
	CallInitialize(this, InDataInterfaceIndex, InBinding);
}

FComputeDataProviderRenderProxy* UVgeComputeParamsProvider::GetRenderProxy()
{
	return new FVgeComputeParamsProxy(Values);
}

void UVgeComputeDispatch::GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const
{
	OutFunctions.AddDefaulted_GetRef().SetName(TEXT("ReadNumThreads")).AddReturnType(EShaderFundamentalType::Uint, 3);
}

void UVgeComputeDispatch::GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const
{
	InOutBuilder.AddNestedStruct<FVgeComputeDispatchParameters>(UID);
}

void UVgeComputeDispatch::GetShaderHash(FString& InOutKey) const
{
	InOutKey += DispatchHlsl;
}

void UVgeComputeDispatch::GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const
{
	OutHLSL += Fill(DispatchHlsl, InDataInterfaceName);
}

UComputeDataProvider* UVgeComputeDispatch::CreateDataProvider() const
{
	UVgeComputeDispatchProvider* Provider = NewObject<UVgeComputeDispatchProvider>();
	Provider->ThreadCount = ThreadCount;
	return Provider;
}

void UVgeComputeDispatchProvider::Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask)
{
	CallInitialize(this, InDataInterfaceIndex, InBinding);
}

FComputeDataProviderRenderProxy* UVgeComputeDispatchProvider::GetRenderProxy()
{
	return new FVgeComputeDispatchProxy(ThreadCount);
}

void UVgeComputeComponent::SetGraph(UComputeGraph* Graph)
{
	if (Graph == ComputeGraph)
	{
		return;
	}
	ComputeGraph = Graph;
	CreateProviders();
}

void UVgeComputeComponent::CreateProviders()
{
	ComputeGraphInstance.DestroyDataProviders();
	Providers.Reset();
	if (!ComputeGraph || !IsRegistered())
	{
		return;
	}
	for (int32 Binding = 0; Binding < ComputeGraph->GetNumBindingObjects(); Binding++)
	{
		ComputeGraphInstance.CreateDataProviders(ComputeGraph, Binding, this);
	}
}

void UVgeComputeComponent::AddProvider(UComputeDataProvider* Provider)
{
	Providers.Add(Provider);
	Apply(Provider);
}

void UVgeComputeComponent::OnRegister()
{
	Super::OnRegister();
	CreateProviders();
}

void UVgeComputeComponent::OnUnregister()
{
	ComputeGraphInstance.DestroyDataProviders();
	Providers.Reset();
	Super::OnUnregister();
}

void UVgeComputeComponent::SendRenderDynamicData_Concurrent()
{
	Super::SendRenderDynamicData_Concurrent();
	if (ComputeGraph && GetScene())
	{
		const bool bEnqueued = ComputeGraphInstance.EnqueueWork(ComputeGraph, GetScene(), ComputeTaskExecutionGroup::EndOfFrameUpdate, GetOwner()->GetFName(), FSimpleDelegate(), this);
		(bEnqueued ? Enqueued : Refused)++;
	}
}

FString UVgeComputeComponent::Describe() const
{
	return FString::Printf(TEXT("graph=%s providers=%d proxy=%d enqueued=%d refused=%d | %s | %s | %s | %s"),
		ComputeGraph ? *ComputeGraph->GetPathName() : TEXT("none"), Providers.Num(), ComputeGraph && ComputeGraph->GetRenderProxy() ? 1 : 0, Enqueued.load(), Refused.load(),
		*::Describe(TEXT("texture"), TextureCounters), *::Describe(TEXT("buffer"), BufferCounters), *::Describe(TEXT("params"), ParamsCounters), *::Describe(TEXT("dispatch"), DispatchCounters));
}

void UVgeComputeComponent::DestroyRenderState_Concurrent()
{
	Super::DestroyRenderState_Concurrent();
	ComputeFramework::AbortWork(GetScene(), this);
}

void UVgeComputeComponent::SetTexture(const FString& Resource, UTextureRenderTarget2D* Target)
{
	Textures.Add(Resource, Target);
	for (UComputeDataProvider* Provider : Providers)
	{
		Apply(Provider);
	}
}

void UVgeComputeComponent::SetParam(const FString& Name, FLinearColor Value)
{
	Params.Add(Name, FVector4f(Value.R, Value.G, Value.B, Value.A));
	for (UComputeDataProvider* Provider : Providers)
	{
		Apply(Provider);
	}
}

void UVgeComputeComponent::Execute()
{
	if (ComputeGraph)
	{
		MarkRenderDynamicDataDirty();
	}
}

void UVgeComputeComponent::SetSortPriority(int32 Priority)
{
	ComputeGraphInstance.SetGraphSortPriority(static_cast<uint8>(FMath::Clamp(Priority, 0, 255)));
}

void UVgeComputeComponent::Apply(UComputeDataProvider* Provider) const
{
	if (UVgeComputeTextureProvider* Texture = Cast<UVgeComputeTextureProvider>(Provider))
	{
		const TObjectPtr<UTextureRenderTarget2D>* Target = Textures.Find(Texture->ResourceName);
		Texture->SetTarget(Target ? Target->Get() : nullptr);
	}
	else if (UVgeComputeParamsProvider* Values = Cast<UVgeComputeParamsProvider>(Provider))
	{
		for (int32 Index = 0; Index < Values->Names.Num(); Index++)
		{
			if (const FVector4f* Value = Params.Find(Values->Names[Index]))
			{
				Values->Values[Index] = *Value;
			}
		}
	}
}
