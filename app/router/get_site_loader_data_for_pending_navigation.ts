import {isId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";
import {isSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

/**
 * Synthesizes the `siteLoaderData` a pending within-site navigation will resolve
 * with, before the destination route's loader returns.
 *
 * Within-site navigations carry the `cyberworlds-active-site-id` header so the
 * destination loader skips re-fetching the site and publishes `UseActiveSite`. We
 * can predict that answer on the client: the site id comes from the header and the
 * active entity id is reconstructed from the destination route. Attaching the
 * result to the navigation's `LoadingIndicatorLoaderData` lets the space-level
 * `SiteProvider` keep the site active — chrome mounted, destination entity
 * highlighted — while the route shimmer is showing.
 *
 * Returns `undefined` when the navigation doesn't carry the header or doesn't
 * target a route that publishes `siteLoaderData`, mirroring the loaders
 * themselves.
 */
export function getSiteLoaderDataForPendingNavigation({
    routeId,
    request,
    params,
}: {
    routeId: string;
    request: Request;
    params: {readonly [key: string]: string | undefined};
}): SiteLoaderData | undefined {
    const activeSiteId = request.headers.get("cyberworlds-active-site-id")?.trim();
    if (!activeSiteId || !isId<SiteId>(activeSiteId)) return undefined;

    // Peek routes mirror the shape of their non-peek route. The `as` is safe: only
    // `routes/_space.` routes are wrapped with the loading indicator, and unrecognized
    // ids fall through to `default`.
    const spaceRouteId = routeId.replace(".peek.", ".") as AppSpaceRouteId;

    // The site root and navigate routes don't name an entity in their pathname (the
    // root has none; navigate carries it as a search param), so handle them
    // explicitly.
    switch (spaceRouteId) {
        case "routes/_space.site.$siteId._index": {
            // Mirrors the loader: `UseActiveSite` only when the header names this route's
            // site. The site root doesn't render an entity, so no `activeEntityId`.
            if (params.siteId !== activeSiteId) return undefined;
            return {type: "UseActiveSite", siteId: activeSiteId};
        }
        case "routes/_space.site.$siteId.navigate": {
            if (params.siteId !== activeSiteId) return undefined;

            // Mirrors the `activeEntityId` search param handling in the route's loader.
            let activeEntityIdParam = new URL(request.url).searchParams.get("activeEntityId");
            activeEntityIdParam = activeEntityIdParam && decodeURIComponent(activeEntityIdParam);
            return {
                type: "UseActiveSite",
                siteId: activeSiteId,
                activeEntityId:
                    activeEntityIdParam && isSiteItemSearchEntityId(activeEntityIdParam)
                        ? activeEntityIdParam
                        : undefined,
            };
        }
        default:
            break;
    }

    const url = new URL(request.url, "https://alpine.inc");
    const entityId = parseSearchEntityIdFromUrl(url.toString());
    if (entityId === null || !isSiteItemSearchEntityId(entityId)) return undefined;

    return {type: "UseActiveSite", siteId: activeSiteId, activeEntityId: entityId};
}
