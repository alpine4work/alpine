import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {fromApiThemeColor} from "~/shared/api/content/closed_source/from_api_theme_color.js";
import {intoApiThemeColor} from "~/shared/api/content/closed_source/into_api_theme_color.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";

type TaskCollectionPatch = ApiSpecification.components["schemas"]["TaskCollectionPatch"];
type ApiTaskCollectionColor = Extract<TaskCollectionPatch, {readonly type: "SetColor"}>["color"];

/**
 * The mutable, API-shaped view of task collection fields we track while folding a
 * PATCH request down into one final intended collection state.
 */
type TaskCollectionPatchState = {
    name: string;
    color: ApiTaskCollectionColor;
};

/**
 * Applies API task collection patches, commits the resulting collection actions,
 * and returns the updated collection model used for the response.
 */
export async function updateTaskCollectionFromApi(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        collectionId,
        actorId,
        patches,
    }: {
        spaceId: SpaceId;
        collectionId: TaskCollectionId;
        actorId?: AccountId;
        patches: ReadonlyArray<TaskCollectionPatch>;
    },
): Promise<TaskCollectionModel> {
    const consistency = "StrongWithinCache" as const;
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const botAccountId = context.actor.getBotAccountId();
    const actor: TaskActor = {
        accountId: actorId ?? botAccountId,
        from: {type: "Bot", accountId: botAccountId},
    };

    const initialCollection = await context.tasks.getCollection(spaceId, collectionId, {
        consistency,
    });

    const initialState = createTaskCollectionPatchState(initialCollection);
    const finalState = applyTaskCollectionPatches(initialState, patches);
    const actions = createTaskCollectionPatchActions({
        collectionId,
        initialState,
        finalState,
        clock,
        actor,
    });

    if (actions.length > 0) {
        await commitTaskActionTransaction(context, spaceId, actions, {
            consistency,
            waitForProcessing: true,
        });
    }

    return applyActionsToTaskCollectionModel(initialCollection, actions);
}

/**
 * Captures the current task collection fields that can be updated through the API
 * patch surface.
 */
function createTaskCollectionPatchState(
    taskCollection: TaskCollectionModel,
): TaskCollectionPatchState {
    const taskCollectionColor = taskCollection.getColor();

    return {
        name: taskCollection.getName(),
        color: taskCollectionColor ? intoApiThemeColor(taskCollectionColor) : null,
    };
}

/**
 * Applies the patch list in request order to compute the final intended task
 * collection state before any collection actions are generated.
 */
function applyTaskCollectionPatches(
    initialState: TaskCollectionPatchState,
    patches: ReadonlyArray<TaskCollectionPatch>,
): TaskCollectionPatchState {
    const state: TaskCollectionPatchState = {...initialState};

    for (const patch of patches) {
        switch (patch.type) {
            case "SetName":
                state.name = patch.name;
                break;
            case "SetColor":
                state.color = patch.color;
                break;
            default:
                throw exhaustive(patch);
        }
    }

    return state;
}

/**
 * Converts the before-and-after patch state into the normalized set of collection
 * actions needed to realize the update.
 */
function createTaskCollectionPatchActions({
    collectionId,
    initialState,
    finalState,
    clock,
    actor,
}: {
    collectionId: TaskCollectionId;
    initialState: TaskCollectionPatchState;
    finalState: TaskCollectionPatchState;
    clock: HybridLogicalClock;
    actor: TaskActor;
}): Array<TaskAction> {
    const actions: Array<TaskAction> = [];

    const pushCollectionAction = (
        collectionAction: Extract<
            TaskAction,
            {readonly type: "UpdateCollection"}
        >["collectionAction"],
    ) => {
        actions.push({
            type: "UpdateCollection",
            time: clock.now(),
            actor,
            collectionId,
            collectionAction,
        });
    };

    if (finalState.name !== initialState.name) {
        pushCollectionAction({
            type: "UpdateName",
            name: finalState.name,
        });
    }

    if (finalState.color !== initialState.color) {
        pushCollectionAction({
            type: "UpdateColor",
            color: finalState.color ? fromApiThemeColor(finalState.color) : null,
        });
    }

    return actions;
}

/**
 * Applies the generated actions to the loaded collection model so the route can
 * build a response without refetching the collection.
 */
function applyActionsToTaskCollectionModel(
    initialCollection: TaskCollectionModel,
    actions: ReadonlyArray<TaskAction>,
): TaskCollectionModel {
    let updatedCollection = initialCollection;

    for (const action of actions) {
        assert(action.type === "UpdateCollection");
        updatedCollection = updatedCollection.applyAction(action);
    }

    return updatedCollection;
}
