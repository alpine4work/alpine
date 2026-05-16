import {DynamoGeneralRealtimeQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteOrSiteEntryModel} from "~/shared/sites/site_model.js";

/**
 * Coordinates the "fire site fetch in parallel with the entity load" pattern that
 * every entity route uses. Returned by `createSiteLoaderDataPrefetcher`.
 *
 * Usage:
 *
 * ```ts
 * const sitePrefetcher = createSiteLoaderDataPrefetcher({
 *     request,
 *     fetchSite: siteId => getSite(context, {siteId}),
 * });
 *
 * await getEntity(context, entityId, {
 *     onSiteId: sitePrefetcher.onSiteId,
 * });
 *
 * const siteLoaderData = await sitePrefetcher.get();
 * ```
 */
export type SiteLoaderDataPrefetcher = {
    /**
     * Pass to the entity loader's `onSiteId` slot. Fires when the entity's access
     * policy is known to be `Site`. Reads the cache hint and either records a
     * `UseActiveSite` marker (no fetch) or kicks off the realtime query in the
     * background, recording the in-flight promise.
     */
    readonly onSiteId: (siteId: SiteId) => void;

    /**
     * Call after the parallel loads finish to materialize the `SiteLoaderData` value
     * passed to `jsonWithSchema`. Awaits the in-flight site query if `onSiteId`
     * recorded a `UseNewSite` marker.
     */
    readonly get: () => Promise<SiteLoaderData | undefined>;
};

/**
 * Build a prefetcher for a route loader. The route passes `prefetcher.onSiteId` to
 * its entity loader and that callback fires as soon as the entity's access policy
 * is known. When applicable, it starts the site realtime query in parallel with
 * the rest of the route's loads. After everything settles the route calls
 * `await prefetcher.resolve()` to get the final `SiteLoaderData`.
 *
 * `fetchSite` is supplied by the caller so this helper can stay in `shared/`.
 * Callers typically pass `siteId => gitSite(context, {siteId})`.
 */
export function createSiteLoaderDataPrefetcher({
    request,
    entityId,
    fetchSite,
}: {
    request: Request;
    entityId: SiteItemSearchEntityId;
    fetchSite: (siteId: SiteId) => Promise<DynamoGeneralRealtimeQueryResult<SiteOrSiteEntryModel>>;
}): SiteLoaderDataPrefetcher {
    // Ref-shaped on purpose. A plain `let value: ... | null = null` would get narrowed
    // to `null` by TS's flow analysis, and TS doesn't widen back through closures
    // nested inside object-literal arguments (the way `onSiteId` is typically passed).
    // Property reads on an object aren't subject to that narrowing, so `ref.current`
    // always yields the declared union type.
    const ref: {
        current:
            | {type: "UseActiveSite"; siteId: SiteId; activeEntityId: SiteItemSearchEntityId}
            | {
                  type: "UseNewSite";
                  siteId: SiteId;
                  initialQueryResultPromise: Promise<
                      DynamoGeneralRealtimeQueryResult<SiteOrSiteEntryModel>
                  >;
                  activeEntityId: SiteItemSearchEntityId;
              }
            | null;
    } = {current: null};

    return {
        onSiteId: siteId => {
            const activeSiteId = request.headers.get("cyberworlds-active-site-id")?.trim();

            // If we've already recorded a siteId and potentially started a fetch, don't start
            // another fetch. This might happen if, for example, we are loading task comments
            // and the initial load authorizes the task twice (once in the comment route and
            // once in the root task route).
            if (ref.current) return;

            ref.current =
                activeSiteId === siteId
                    ? {type: "UseActiveSite", siteId, activeEntityId: entityId}
                    : {
                          type: "UseNewSite",
                          siteId,
                          initialQueryResultPromise: fetchSite(siteId),
                          activeEntityId: entityId,
                      };
        },
        get: async () => {
            const value = ref.current;
            if (!value) return undefined;
            if (value.type === "UseActiveSite") return value;

            return {
                type: "UseNewSite",
                siteId: value.siteId,
                initialQueryResult: await value.initialQueryResultPromise,
                activeEntityId: value.activeEntityId,
            };
        },
    };
}
