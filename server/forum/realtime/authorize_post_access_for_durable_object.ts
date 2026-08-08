import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {authorizePostAccess} from "~/shared/rpc/forum_rpc_definitions.js";

const PostAccessCache = new ContextCache<PostId, {spaceId: SpaceId}>({
    whenActorChanges: "SafelyReset",
});

export function authorizePostAccessForDurableObject(context: WorkerActionContext, postId: PostId) {
    // Authorize chat access once per action then cache the result.
    return PostAccessCache.get(context, postId, () => authorizePostAccess(context, {postId}));
}
