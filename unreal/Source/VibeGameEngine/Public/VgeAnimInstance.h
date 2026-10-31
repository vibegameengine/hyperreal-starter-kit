#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "StructUtils/InstancedStruct.h"
#include "VgeAnimInstance.generated.h"

class FJsonObject;
class FJsonValue;

// An animation graph built at runtime from a description, with no Animation Blueprint: anim nodes held by the proxy
// and handed to it as a custom root (FAnimInstanceProxy::GetCustomRootNode), which then initializes, caches bones,
// updates and evaluates them as it does a compiled graph.
//
// The description is a tree of nodes, each {"id", "type", "props", "children"} (JSON):
//   clip         FAnimNode_SequencePlayer_Standalone    sequence, playRate, loop, startPosition
//   blendSpace   FAnimNode_BlendSpacePlayer_Standalone  blendSpace, x, y, playRate, loop
//   blend        FAnimNode_TwoWayBlend                  alpha; children A and B
//   blendList    FVgeAnimNode_BlendList                 index | active, blendTime, transition, blendType,
//                                                       blendProfile, customCurve, childUpdate; children the poses
//   linkedGraph  FVgeAnimNode_LinkedAnimGraph           instanceClass; children its input poses
//   inertialize  FVgeAnimNode_Inertialization           defaultBlendProfile, filteredCurves, filteredBones,
//                                                       resetOnBecomingRelevant, tag; child the source
//   stateMachine FVgeAnimNode_StateMachine              entry, maxTransitionsPerFrame; children states, transitions
//   state        FVgeAnimNode_State                     name, alwaysResetOnEntry; child the pose
//   transition   FVgeAnimNode_Transition                from, to, when, duration, blend, blendType, blendProfile
//   layered      FVgeAnimNode_LayeredBoneBlend          layers, weights, meshSpaceRotationBlend,
//                                                       rootSpaceRotationBlend, meshSpaceScaleBlend, curveBlend;
//                                                       children the base pose, then one pose per layer
//   slot         FAnimNode_Slot                         name, alwaysUpdateSource; child the source
//   twoBoneIK    FVgeAnimNode_TwoBoneIK                 ikBone, effectorLocation, effectorSpace, effectorBone,
//                                                       jointTargetLocation, jointTargetSpace, jointTargetBone, alpha,
//                                                       allowStretching, startStretchRatio, maxStretchScale,
//                                                       takeRotationFromEffectorSpace, maintainEffectorRelRot,
//                                                       allowTwist; child the source
// Engine nodes are used as they are where they keep their settings in their own fields; the FVgeAnimNode_* ones
// (VgeAnimNodes.h) stand for engine nodes that need an Animation Blueprint class.
// A number prop is a value (bools as true/false) or {"param": name}, bound to a graph variable (SetFloat, SetBool,
// SetInt); so is each element of an array or vector prop. Asset props are paths.

// A node of the graph: one engine or Vge anim node.
struct FVgeAnimGraphNode
{
	FString Id;
	FName Type;
	FInstancedStruct Node;
	TArray<int32> Children;

	FAnimNode_Base* Base();
};

// A node prop (an element of it, for array and vector props) bound to a graph variable, written from it before
// every update.
struct FVgeAnimGraphBinding
{
	int32 Node = INDEX_NONE;
	FString Prop;
	int32 Element = INDEX_NONE;
	FName Variable;
};

class UVgeAnimInstance;

USTRUCT()
struct FVgeAnimInstanceProxy : public FAnimInstanceProxy
{
	GENERATED_BODY()

	FVgeAnimInstanceProxy() = default;
	explicit FVgeAnimInstanceProxy(UAnimInstance* InAnimInstance) : FAnimInstanceProxy(InAnimInstance) {}

	// Replaces the graph. Nodes whose id and type are still in the description are kept (the instance a linked
	// graph runs goes on running); bLive when the instance is running and the new graph must take over at once.
	void SetGraph(const TSharedPtr<FJsonObject>& InRoot, UVgeAnimInstance& InOwner, bool bLive);

	// Writes one prop of one node. InLiveOwner is the instance when it is running: a new linked graph class then
	// starts at once, and bones are cached again for props that name bones.
	void SetNodeParam(const FString& InId, const FString& InProp, const TSharedPtr<FJsonValue>& InValue, UAnimInstance* InLiveOwner);

	bool IsRebuildingGraph() const { return bRebuildingGraph; }

	FString DescribeGraph();
	FString DescribeNodeState(const FString& InId);
	UAnimInstance* GetLinkedInstance(const FString& InId);

protected:
	virtual FAnimNode_Base* GetCustomRootNode() override;
	virtual void GetCustomNodes(TArray<FAnimNode_Base*>& OutNodes) override;
	virtual void PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds) override;
	virtual void AddReferencedObjects(UAnimInstance* InAnimInstance, FReferenceCollector& Collector) override;

private:
	int32 AddNode(const TSharedPtr<FJsonObject>& InDescription, TArray<FVgeAnimGraphNode>& Previous, UVgeAnimInstance& InOwner, bool bLive);
	void LinkChildren(int32 InNode, UAnimInstance* InLiveOwner);
	void CollectAssetPlayers(int32 InNode, TArray<struct FAnimNode_AssetPlayerRelevancyBase*>& OutPlayers);
	// Returns true when the prop changed which bones the node reads (bones need caching again).
	bool WriteProp(int32 InNode, const FString& InProp, const TSharedPtr<FJsonValue>& InValue, UAnimInstance* InLiveOwner);
	int32 FindNode(const FString& InId) const;
	FString DescribeNode(int32 InNode);

	TArray<FVgeAnimGraphNode> Nodes;
	TArray<FVgeAnimGraphBinding> Bindings;
	// The owner's graph variables as of this update, for the worker thread (state machine conditions).
	TMap<FName, double> Variables;
	int32 Root = INDEX_NONE;
	bool bRebuildingGraph = false;
};

// The anim instance a skeletal mesh runs a script-built graph with (<animGraph> in the scene renderer).
UCLASS(Transient, NotBlueprintable)
class VIBEGAMEENGINE_API UVgeAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	// Replaces the graph with the one described (see above); an empty string clears it (reference pose).
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	void SetGraph(const FString& Json);

	// Writes one prop of the node with this id: Json is the prop's value as in the description.
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	void SetNodeParam(const FString& NodeId, const FString& Prop, const FString& Json);

	// Graph variables, read by the props bound to them and by state machine conditions before every update.
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	void SetFloat(FName Name, float Value) { Variables.Add(Name, Value); }

	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	void SetBool(FName Name, bool bValue) { Variables.Add(Name, bValue ? 1.0 : 0.0); }

	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	void SetInt(FName Name, int32 Value) { Variables.Add(Name, Value); }

	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	float GetVariable(FName Name) const { return static_cast<float>(Variables.FindRef(Name)); }

	// The running graph, node by node: "type#id[runtime state](child, ...)".
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	FString DescribeGraph();

	// One node's runtime state as JSON: a state machine's current state and weights, a blend list's weights, an
	// inertialization's progress, an asset player's time.
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	FString DescribeNode(const FString& NodeId);

	// The instance a linked graph node runs.
	UFUNCTION(BlueprintCallable, Category = "Vge|Animation")
	UAnimInstance* GetLinkedInstance(const FString& NodeId);

	const TMap<FName, double>& GetVariables() const { return Variables; }

	struct FPendingNodeParam
	{
		FString NodeId;
		FString Prop;
		TSharedPtr<FJsonValue> Value;
	};
	TArray<FPendingNodeParam> TakePendingNodeParams() { return MoveTemp(PendingNodeParams); }

protected:
	virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
	virtual void NativeInitializeAnimation() override;
	virtual void NativeUninitializeAnimation() override;

private:
	TMap<FName, double> Variables;
	TArray<FPendingNodeParam> PendingNodeParams;
	// Between InitializeAnimation and UninitializeAnimation: the proxy runs the graph, so a new one takes over at
	// once; before, it is only kept until initialization picks it up.
	bool bRunning = false;
};
