import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    ChannelAttributesItem,
    ForumRealtimeTable,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";

export type ChannelPreviewAttributesItem = {
    readonly spaceId: SpaceId;
    readonly createdTime: Date;
    readonly name: string;
    readonly accessPolicy: AccessPolicy;
} & (
    | {readonly id: ChannelId; readonly version: number}
    | {readonly channelId: ChannelId; readonly updateLockVersion?: number}
);

assertAssignableTypes<ChannelAttributesItem, ChannelPreviewAttributesItem>();
assertAssignableTypes<ChannelModel, ChannelPreviewAttributesItem>();

export const ChannelPreviewItemAuthorizationCache = new DynamoContextCache<
    ChannelId,
    ChannelPreviewAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export function getChannelPreviewItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<ChannelPreviewAttributesItem | null> {
    return ChannelPreviewItemAuthorizationCache.get(context, consistency, channelId, consistency =>
        ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Channel",
                sortRangeType: "Attributes",
                channelId,
            },
            {
                consistency,
                attributes: ["spaceId", "createdTime", "name", "accessPolicy", "updateLockVersion"],
            },
        ),
    );
}

export async function getChannelPreviewItemForAuthorization(
    context: ServerMinimalActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewAttributesItem> {
    const channelItem = await getChannelPreviewItemForAuthorizationIfExists(
        context,
        channelId,
        options,
    );

    if (!channelItem) throw createChannelNotFoundError(channelId);

    return channelItem;
}
