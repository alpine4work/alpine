import {Path} from "@remix-run/router";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {assertId} from "~/shared/id/id.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {getSearchDynamicEntityPathFromEntityIdObjectWithoutAccount} from "~/shared/search/path/get_search_entity_path.js";
import {parseSiteItemSearchEntityIdIfPossible} from "~/shared/search/site_item_search_entity_id.js";

const spacePathRegExp = /^\/(?!peek(?:\/|$))(.*)$/;
const peekPathRegExp = /^\/peek(\/.*)?$/;

/**
 * Is the provided path a peek path?
 */
export function isPeekPath(path: Path): boolean {
    return peekPathRegExp.test(path.pathname ?? "/");
}

/**
 * Converts a path meant to navigate somewhere in a space to instead navigate to a
 * peek URL within the space. Does not guarantee that a peek route actually exists
 * for the URL.
 */
export function convertSpacePathToPeekPath(path: Path): Path | null {
    const match = path.pathname.match(spacePathRegExp);
    if (!match) return null;

    return {
        ...path,
        pathname: `/peek/${match[1]!}`,
    };
}

/**
 * Convert a Peek URL to a path within the space you can navigate to. Every peek
 * route should have a corresponding space route.
 *
 * Will return `null` if the provided path is not a peek path.
 *
 * This isn't a pure logic function. We also implement a couple transformations to
 * improve the user experience. If `routeLayout` is `wide` then it means we're
 * expanding this peek route to a full screen route. When `routeLayout` is `wide`
 * we apply the following transforms:
 *
 * 1. `/peek/task/:taskId/comments` is turned into `/task/:taskId?comments=show` so
 *    you see the task detail view next to its comments after expanding.
 *
 * 2. `/peek/task/:taskId` is turned into `/peek/task/:taskId?comments=show` when
 *    `localStorage` says the user had previously opened the comments on this task.
 */
export function convertPeekPathToSpacePath(
    path: Path,
    {routeLayout}: {routeLayout: RouteLayout},
): Path | null {
    const match = path.pathname.match(peekPathRegExp);
    if (!match) return null;

    const pathnamePart = match[1] ?? "/";

    const sitePath = convertPeekSiteNavigatePathToSitePathIfNecessary(
        pathnamePart,
        new URLSearchParams(path.search ?? ""),
        {
            routeLayout,
        },
    );

    if (sitePath) return {...path, pathname: sitePath};

    return {
        ...path,
        pathname: pathnamePart,
    };
}

/**
 * In mobile and peek views, we render a site breadcrumb chip when rendering an
 * entity that belongs to a site. Clicking that chip will route the user to the
 * Site navigation bar, which is really only meant to be rendered in peek and
 * mobile views. If a user is expanding that navigation bar, we should open
 * whatever entity is currently focused in a wide route.
 *
 * So we should convert a path like this:
 *
 * ```
 * /site/ejpeq33tbm4ax14xmbps2ke650/navigate?focus=Document%3Abqfnt1js3aed9wdr70d9jjcxhr
 * ```
 *
 * to a path like this:
 *
 * ```
 * /doc/3Abqfnt1js3aed9wdr70d9jjcxhr
 * ```
 */
function convertPeekSiteNavigatePathToSitePathIfNecessary(
    pathname: string,
    searchParams: URLSearchParams,
    {routeLayout}: {routeLayout: RouteLayout},
) {
    if (routeLayout !== "wide") return null;

    const siteNavigatePattern = /^\/site\/([^/]+)\/navigate$/;
    const match = pathname.match(siteNavigatePattern);
    if (!match) return null;
    const siteId = assertId<SiteId>(match[1]!);

    const sitePath = `/site/${siteId}`;

    const activeEntityIdParam = searchParams.get("activeEntityId");
    if (!activeEntityIdParam) return sitePath;

    const activeEntityId = decodeURIComponent(activeEntityIdParam);
    const activeEntityIdObject = parseSiteItemSearchEntityIdIfPossible(activeEntityId);
    if (!activeEntityIdObject) return sitePath;

    return getSearchDynamicEntityPathFromEntityIdObjectWithoutAccount(
        activeEntityIdObject,
        routeLayout,
    );
}
