import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeChannelItemAccess,
    authorizeChannelItemAccessIfPossible,
} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {getChannelPreviewItemForAuthorization} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Authorize that the current user has access to a channel. Implicitly also
 * authorizes that the current user has access to the space the channel is in.
 */
export async function authorizeChannelAccess(
    context: ServerActionContext,
    channelId: ChannelId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; accessPolicy: AccessPolicy; channelName: string}> {
    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, options);

    await authorizeChannelItemAccess(context, channelItem, expectedAccessLevel, options);

    return {
        spaceId: channelItem.spaceId,
        accessPolicy: channelItem.accessPolicy,
        channelName: channelItem.name,
    };
}

/**
 * Authorize that the current user has access to a channel. Implicitly also
 * authorizes that the current user has access to the space the channel is in.
 *
 * Returns a result instead of throwing an error if the user doesn't have access.
 */
export async function authorizeChannelAccessIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; accessPolicy: AccessPolicy}, ErrorBase>> {
    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, options);

    const result = await authorizeChannelItemAccessIfPossible(
        context,
        channelItem,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

    return {
        ok: true,
        value: {spaceId: channelItem.spaceId, accessPolicy: channelItem.accessPolicy},
    };
}
