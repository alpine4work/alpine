import {Path} from "@remix-run/router";
import {RouteLayout} from "~/shared/design/core/route_layout.js";

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    {routeLayout}: {routeLayout: RouteLayout},
): Path | null {
    const match = path.pathname.match(peekPathRegExp);
    if (!match) return null;

    return {
        ...path,
        pathname: match[1] ?? "/",
    };
}
