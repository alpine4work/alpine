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
import {ChannelId, SiteId, SpaceId} from "~/shared/id/types/id_types.js";

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

// NOTE(ifitzsimmons, 2026-03-06): When we parse the channel attributes item into
// the model, we turn the access policy into a `AccessPolicyModel`. A channel's
// access policy can either be its own "Local" policy or its inherited policy from
// the site. In DynamoDB, we normalize the site policy by storing only the site ID.
// However, we need the site's access policy to evaluate channel permissions on the
// server and we need to send the site's access policy to the client.
assertAssignableTypes<
    Omit<ChannelModel, "accessPolicy">,
    Omit<ChannelPreviewAttributesItem, "accessPolicy">
>();

export const ChannelPreviewItemAuthorizationCache = new DynamoContextCache<
    ChannelId,
    ChannelPreviewAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export function convertChannelModelToChannelPreviewAttributesItem(
    channel: ChannelModel,
): ChannelPreviewAttributesItem {
    return {
        ...channel,
        // NOTE(ifitzsimmons, 2026-03-06): If this is a site access policy, we cache it on
        // load. Turning it back to a vanilla `AccessPolicy` means that we'll fetch the
        // site access policy from the cache later on when evaluating access.
        accessPolicy: channel.accessPolicy.intoAccessPolicy(),
    };
}

export async function getChannelPreviewItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    channelId: ChannelId,
    {
        consistency = "Eventual",
        onSiteId,
    }: {consistency?: DynamoCacheReadConsistency; onSiteId?: (siteId: SiteId) => void} = {},
): Promise<ChannelPreviewAttributesItem | null> {
    const channelItem = await ChannelPreviewItemAuthorizationCache.get(
        context,
        consistency,
        channelId,
        async consistency =>
            ForumRealtimeTable.getPartialItemIfExists(
                context,
                {
                    partitionType: "Channel",
                    sortRangeType: "Attributes",
                    channelId,
                },
                {
                    consistency,
                    attributes: [
                        "spaceId",
                        "createdTime",
                        "name",
                        "accessPolicy",
                        "updateLockVersion",
                    ],
                },
            ),
    );

    if (channelItem?.accessPolicy.type === "Site") {
        onSiteId?.(channelItem.accessPolicy.siteId);
    }

    return channelItem;
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
