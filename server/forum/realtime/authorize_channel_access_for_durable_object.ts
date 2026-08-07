import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {authorizeChannelAccess} from "~/shared/rpc/forum_rpc_definitions.js";

const ChannelAccessCache = new ContextCache<ChannelId, {spaceId: SpaceId}>({
    whenActorChanges: "SafelyReset",
});

export function authorizeChannelAccessForDurableObject(
    context: WorkerActionContext,
    channelId: ChannelId,
) {
    // Authorize chat access once per action then cache the result.
    return ChannelAccessCache.get(context, channelId, () =>
        authorizeChannelAccess(context, {channelId, expectedAccessLevel: "View"}),
    );
}
