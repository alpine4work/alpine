import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/forum/forum_error_messages.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";

export async function authorizeChannelItemAccess(
    context: ServerActionContext,
    channelItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & (
        | {id: ChannelId}
        | {channelId: ChannelId}
    ),
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    unwrapResult(
        await authorizeChannelItemAccessIfPossible(
            context,
            channelItem,
            expectedAccessLevel,
            options,
        ),
    );
}

export async function authorizeChannelItemAccessIfPossible(
    context: ServerActionContext,
    channelItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & (
        | {id: ChannelId}
        | {channelId: ChannelId}
    ),
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        channelItem.spaceId,
        channelItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: channelItem.spaceId,
            expectedAccessLevel,
            aggregateDedupeKey: "id" in channelItem ? channelItem.id : channelItem.channelId,
            displayMessages: channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}
