import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {createSpaceModelFromItem} from "~/server/spaces/internal/create_space_model_from_item.js";
import {getSpaceItem, getSpaceItemIfExists} from "~/server/spaces/internal/get_space_item.js";
import {ErrorBase} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

/**
 * Get the space with the specified `SpaceId`. Throws an error if the actor
 * doesn't have access to the space or if the space doesn't exist.
 */
export async function getSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
    options?: {consistency?: DynamoCacheReadConsistency; allowInvitePending?: boolean},
): Promise<SpaceModel> {
    const [authorizationResult, spaceItem] = await runAllPromises([
        captureResultPromise(authorizeSpaceAccess(context, spaceId, "Member", options)),
        getSpaceItem(context, spaceId, {consistency: options?.consistency}),
    ]);

    // Prioritize the `NotFoundError` over the `PermissionDeniedError`.
    unwrapResult(authorizationResult);

    return createSpaceModelFromItem(spaceItem);
}

/**
 * Get the space with the specified `SpaceId`. Returns a null if the space
 * doesn't exist and returns a `Result` if the actor doesn't have access to
 * the space.
 */
export async function getSpaceIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<Result<SpaceModel, ErrorBase> | null> {
    const [authorizationResult, spaceItem] = await runAllPromises([
        authorizeSpaceAccessIfPossible(context, spaceId),
        getSpaceItemIfExists(context, spaceId),
    ]);

    if (!spaceItem) return null;
    if (!authorizationResult.ok) return authorizationResult;

    return {
        ok: true,
        value: createSpaceModelFromItem(spaceItem),
    };
}
