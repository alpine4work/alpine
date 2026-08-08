import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {authorizeSiteAccess} from "~/shared/rpc/sites_rpc_definitions.js";

const SiteAccessCache = new ContextCache<SiteId, {spaceId: SpaceId}>({
    whenActorChanges: "SafelyReset",
});

export function authorizeSiteAccessForDurableObject(context: WorkerActionContext, siteId: SiteId) {
    // Authorize site access once per action then cache the result.
    return SiteAccessCache.get(context, siteId, () =>
        authorizeSiteAccess(context, {siteId, expectedAccessLevel: "View"}),
    );
}
