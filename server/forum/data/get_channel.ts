import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccessIfPossible} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Gets the channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist, returns a `Result` with a `PermissionDeniedError` if
 * access isn't authorized.
 *
 * Sometimes calling code wants to handle these error cases by discarding the
 * channel instead of returning null.
 */
export async function getChannelIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<Result<DynamoGeneralRealtimeItem<ChannelModel>, ErrorBase> | null> {
    const getPromise = ForumRealtimeTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId,
        },
        {consistency},
    );

    const cachedGetPromise = getPromise.then(channel => (channel ? channel.model : null));

    // Make sure errors thrown by this promise aren't treated as uncaught
    // exceptions. We catch them below when we await `getPromise`.
    cachedGetPromise.catch(() => {});

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewItemAuthorizationCache.set(context, consistency, channelId, cachedGetPromise);

    const channel = await getPromise;
    if (!channel) return null;

    const result = await authorizeChannelItemAccessIfPossible(context, channel.model, "View");
    if (!result.ok) return result;

    return {ok: true, value: channel};
}

/**
 * Gets the channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist or throws if you don't have access to the channel.
 */
export async function getChannelIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<ChannelModel> | null> {
    const channel = await getChannelIfPossible(context, channelId, options);
    if (!channel) return null;
    return unwrapResult(channel);
}

/**
 * Gets the channel object with the provided `ChannelId`. Throws if the channel
 * doesn't exist or you don't have access to the channel.
 */
export async function getChannel(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<ChannelModel>> {
    const channel = await getChannelIfExists(context, channelId, options);
    if (!channel) throw createChannelNotFoundError(channelId);
    return channel;
}
