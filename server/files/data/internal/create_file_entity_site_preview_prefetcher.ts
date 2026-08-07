import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {getSitePreviewIfPossible} from "~/server/sites/data/get_site_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Coordinates the "fire site preview fetch in parallel with the entity load"
 * pattern used by file entity loaders. Mirrors
 * `shared/remix/create_site_loader_data_prefetcher.ts` but loads only a
 * `SitePreviewModel` (not the full realtime site query) and stays server-side
 * since it's only consumed by server file entity loaders.
 *
 * Typical usage from a file entity loader:
 *
 * ```ts
 * const sitePreviewPrefetcher = createFileEntitySitePreviewPrefetcher(context, {
 *     siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded,
 * });
 *
 * await getEntityAndMetadata(context, {
 *     ...,
 *     onSiteId: sitePreviewPrefetcher.onSiteId,
 * });
 *
 * const site = await sitePreviewPrefetcher.get();
 * ```
 *
 * If the underlying entity loader doesn't expose an `onSiteId` hook, the caller
 * can read the access policy from the loaded entity and call `onSiteId(siteId)`
 * directly before `get()`. The prefetcher works the same in both cases.
 */
export type FileEntitySitePreviewPrefetcher = {
    /**
     * Fires when the entity's access policy is known to be `Site`. Either
     * short-circuits to `siteIfAlreadyLoaded` (when the ids match) or starts
     * `getSitePreviewIfPossible` in the background. No-ops on subsequent calls so it's
     * safe to wire to query streams that may invoke it more than once.
     */
    readonly onSiteId: (siteId: SiteId) => void;

    /**
     * Resolves to the site preview, or `null` if `onSiteId` was never called (entity
     * isn't in a site) or the site preview couldn't be loaded (e.g. permission
     * denied). Safe to call before `onSiteId` has fired — after the awaiting code path
     * settles, `onSiteId` no-ops.
     */
    readonly get: () => Promise<SitePreviewModel | null>;
};

export function createFileEntitySitePreviewPrefetcher(
    context: ServerMinimalActionContext,
    options: {siteIfAlreadyLoaded: SitePreviewModel | undefined},
): FileEntitySitePreviewPrefetcher {
    const resolver = createPromiseResolver<SitePreviewModel | null>();

    return {
        onSiteId: siteId => {
            if (resolver.isSettled()) return;
            if (options.siteIfAlreadyLoaded?.id === siteId) {
                resolver.resolve(options.siteIfAlreadyLoaded);
            } else {
                resolver.resolve(
                    getSitePreviewIfPossible(context, siteId).then(result => {
                        if (!result || !result.ok) return null;
                        return result.value;
                    }),
                );
            }
        },
        get: async () => {
            if (!resolver.isSettled()) resolver.resolve(null);
            return await resolver.promise;
        },
    };
}
