import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccessIfPossible} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {getChannelPreviewItemForAuthorizationIfExists} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Gets a preview channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist, returns a `Result` with a `PermissionDeniedError` if
 * access isn't authorized.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 */
export async function getChannelPreviewIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<ChannelPreviewModel, ErrorBase> | null> {
    const channelItem = await getChannelPreviewItemForAuthorizationIfExists(
        context,
        channelId,
        options,
    );
    if (!channelItem) return null;

    const result = await authorizeChannelItemAccessIfPossible(
        context,
        channelItem,
        "View",
        options,
    );
    if (!result.ok) return result;

    return {
        ok: true,
        value: new ChannelPreviewModel({
            id: channelId,
            spaceId: channelItem.spaceId,
            createdTime: channelItem.createdTime,
            version:
                "id" in channelItem ? channelItem.version : (channelItem.updateLockVersion ?? 0),
            name: channelItem.name,
            accessPolicy: channelItem.accessPolicy,
        }),
    };
}

/**
 * Gets a preview channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist and throws an error if the channel exists but you don't
 * have access to the channel.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 */
export async function getChannelPreviewIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewModel | null> {
    const channelResult = await getChannelPreviewIfPossible(context, channelId, options);
    if (!channelResult) return null;
    return unwrapResult(channelResult);
}

/**
 * Gets a preview channel object with the provided `ChannelId`. Throws an error if
 * the channel doesn't exist.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 */
export async function getChannelPreview(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewModel> {
    const channel = await getChannelPreviewIfExists(context, channelId, options);
    if (!channel) throw createChannelNotFoundError(channelId);
    return channel;
}
