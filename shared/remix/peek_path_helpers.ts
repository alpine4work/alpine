import {Path} from "@remix-run/router";
import {RouteLayout} from "~/shared/design/core/route_layout.js";

const spacePathRegExp = /^(\/s\/[^/]+\/)(?!peek)(.*)$/;
const peekPathRegExp = /^(\/s\/[^/]+)\/peek(\/.*)$/;

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

    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    return {
        ...path,
        pathname: `${pathnamePart1}peek/${pathnamePart2}`,
    };
}

/**
 * Convert a Peek URL to a path within the space you can navigate to. Every peek
 * route should have a corresponding space route.
 *
 * Will return `null` if the provided path is not a peek path.
 */
export function convertPeekPathToSpacePath(
    path: Path,
    options: {routeLayout: RouteLayout},
): Path | null {
    const result = convertPeekPathToSpacePathParts(path.pathname, path.search, options);
    if (!result) return null;

    return {
        ...path,
        pathname: `${result.pathnameParts[0]}${result.pathnameParts[1]}`,
        search: result.search,
    };
}

/**
 * Used to implement `convertPeekPathToSpacePath()`. Returns the `pathname` in two
 * parts. The first is the `/s/:spaceId` part, the second is the part after
 * `/s/:spaceId/peek`. So for example in the route
 * `/s/ywcffewdn377x442nkxd5x41r0/peek/documents/vj1avzsr72fy09qze28vvhy0gg` the
 * two parts would be `/s/ywcffewdn377x442nkxd5x41r0` and
 * `/documents/vj1avzsr72fy09qze28vvhy0gg` (notice how `/peek` was removed).
 *
 * This isn't a pure logic function. We also implement a couple transformations to
 * improve the user experience. If `routeLayout` is `wide` then it means we're
 * expanding this peek route to a full screen route. When `routeLayout` is `wide`
 * we apply the following transforms:
 *
 * 1. `/s/:spaceId/peek/tasks/:taskId/comments` is turned into
 *    `/s/:spaceId/tasks/:taskId?comments=show` so you see the task detail view
 *    next to its comments after expanding.
 *
 * 2. `/s/:spaceId/peek/tasks/:taskId` is turned into
 *    `/s/:spaceId/peek/tasks/:taskId?comments=show` when `localStorage` says the
 *    user had previously opened the comments on this task.
 */
export function convertPeekPathToSpacePathParts(
    pathname: string,
    search: string | URLSearchParams,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    {routeLayout}: {routeLayout: RouteLayout},
): {pathnameParts: [string, string]; search: string} | null {
    const match = pathname.match(peekPathRegExp);
    if (!match) return null;

    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    return {
        pathnameParts: [pathnamePart1, pathnamePart2],
        search: typeof search === "string" ? search : search.toString(),
    };
}
