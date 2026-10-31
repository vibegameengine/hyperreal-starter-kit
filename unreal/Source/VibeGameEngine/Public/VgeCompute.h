#pragma once

#include "CoreMinimal.h"
#include "ComputeFramework/ComputeDataInterface.h"
#include "ComputeFramework/ComputeDataProvider.h"
#include "Components/ActorComponent.h"
#include "ComputeFramework/ComputeGraphInstance.h"
#include "RenderGraphResources.h"
#include "VgeCompute.generated.h"

class UComputeGraph;
class UTextureRenderTarget2D;

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeTexture : public UComputeDataInterface
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FString ResourceName;

	virtual TCHAR const* GetClassName() const override { return TEXT("VgeTexture"); }
	virtual void GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetSupportedOutputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const override;
	virtual void GetShaderHash(FString& InOutKey) const override;
	virtual void GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const override;
	virtual bool GetRequiresPostSubmitCall() const override { return true; }
	virtual UComputeDataProvider* CreateDataProvider() const override;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeTextureProvider : public UComputeDataProvider
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FString ResourceName;

	UPROPERTY(Transient)
	TObjectPtr<UTextureRenderTarget2D> Target;

	void SetTarget(UTextureRenderTarget2D* InTarget);

	virtual void Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask) override;
	virtual FComputeDataProviderRenderProxy* GetRenderProxy() override;

private:
	FTextureRenderTargetResource* Resource = nullptr;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeBuffer : public UComputeDataInterface
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FString ResourceName;

	UPROPERTY()
	int32 Elements = 1;

	UPROPERTY()
	int32 Components = 4;

	virtual TCHAR const* GetClassName() const override { return TEXT("VgeBuffer"); }
	virtual void GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetSupportedOutputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const override;
	virtual void GetShaderHash(FString& InOutKey) const override;
	virtual void GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const override;
	virtual UComputeDataProvider* CreateDataProvider() const override;
};

struct FVgeComputeBufferStorage
{
	TRefCountPtr<FRDGPooledBuffer> Buffer;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeBufferProvider : public UComputeDataProvider
{
	GENERATED_BODY()

public:
	int32 Elements = 1;
	int32 Components = 4;
	TSharedPtr<FVgeComputeBufferStorage, ESPMode::ThreadSafe> Storage = MakeShared<FVgeComputeBufferStorage, ESPMode::ThreadSafe>();

	virtual void Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask) override;
	virtual FComputeDataProviderRenderProxy* GetRenderProxy() override;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeParams : public UComputeDataInterface
{
	GENERATED_BODY()

public:
	static constexpr int32 MaxValues = 32;

	UPROPERTY()
	TArray<FString> Names;

	virtual TCHAR const* GetClassName() const override { return TEXT("VgeParams"); }
	virtual void GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const override;
	virtual void GetShaderHash(FString& InOutKey) const override;
	virtual void GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const override;
	virtual UComputeDataProvider* CreateDataProvider() const override;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeParamsProvider : public UComputeDataProvider
{
	GENERATED_BODY()

public:
	UPROPERTY()
	TArray<FString> Names;

	TArray<FVector4f> Values;

	virtual void Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask) override;
	virtual FComputeDataProviderRenderProxy* GetRenderProxy() override;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeDispatch : public UComputeDataInterface
{
	GENERATED_BODY()

public:
	UPROPERTY()
	FIntVector ThreadCount = FIntVector(1, 1, 1);

	virtual TCHAR const* GetClassName() const override { return TEXT("VgeDispatch"); }
	virtual bool IsExecutionInterface() const override { return true; }
	virtual void GetSupportedInputs(TArray<FShaderFunctionDefinition>& OutFunctions) const override;
	virtual void GetShaderParameters(TCHAR const* UID, FShaderParametersMetadataBuilder& InOutBuilder, FShaderParametersMetadataAllocations& InOutAllocations) const override;
	virtual void GetShaderHash(FString& InOutKey) const override;
	virtual void GetHLSL(FString& OutHLSL, FString const& InDataInterfaceName) const override;
	virtual UComputeDataProvider* CreateDataProvider() const override;
};

UCLASS()
class VIBEGAMEENGINE_API UVgeComputeDispatchProvider : public UComputeDataProvider
{
	GENERATED_BODY()

public:
	FIntVector ThreadCount = FIntVector(1, 1, 1);

	virtual void Initialize(int32 InDataInterfaceIndex, UComputeDataInterface const* InDataInterface, UObject* InBinding, uint64 InInputMask, uint64 InOutputMask) override;
	virtual FComputeDataProviderRenderProxy* GetRenderProxy() override;
};

UCLASS(ClassGroup = Vge, meta = (BlueprintSpawnableComponent))
class VIBEGAMEENGINE_API UVgeComputeComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	void SetGraph(UComputeGraph* Graph);

	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	void SetTexture(const FString& Resource, UTextureRenderTarget2D* Target);

	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	void SetParam(const FString& Name, FLinearColor Value);

	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	void Execute();

	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	void SetSortPriority(int32 Priority);

	UFUNCTION(BlueprintCallable, Category = "Vge|Compute")
	FString Describe() const;

	void AddProvider(UComputeDataProvider* Provider);

protected:
	virtual void OnRegister() override;
	virtual void OnUnregister() override;
	virtual void SendRenderDynamicData_Concurrent() override;
	virtual void DestroyRenderState_Concurrent() override;
	virtual bool ShouldCreateRenderState() const override { return true; }

private:
	void CreateProviders();
	void Apply(UComputeDataProvider* Provider) const;

	UPROPERTY(Transient)
	TObjectPtr<UComputeGraph> ComputeGraph;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UComputeDataProvider>> Providers;

	FComputeGraphInstance ComputeGraphInstance;

	UPROPERTY(Transient)
	TMap<FString, TObjectPtr<UTextureRenderTarget2D>> Textures;

	TMap<FString, FVector4f> Params;
};
