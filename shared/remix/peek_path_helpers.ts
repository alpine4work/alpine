import {Path} from "@remix-run/router";
import {RouteLayout} from "~/shared/design/core/route_layout.js";

const spacePathRegExp = /^(\/s\/[^/]+\/)(?!peek)(.*)$/;
const peekPathRegExp = /^(\/s\/[^/]+)\/peek(\/.*)$/;
const optionalPeekPathWithTasksGroupRegExp =
    /^(\/s\/[^/]+)\/peek((?<taskComments>\/tasks\/[^/]+\/comments)|\/.*)$/;

/**
 * Is the provided path a peek path?
 */
export function isPeekPath(path: Path): boolean {
    return peekPathRegExp.test(path.pathname ?? "/");
}

/**
 * Converts a path meant to navigate somewhere in a space to instead navigate
 * to a peek URL within the space. Does not guarantee that a peek route
 * actually exists for the URL.
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
 * Convert a Peek URL to a path within the space you can navigate to. Every
 * peek route should have a corresponding space route.
 *
 * Will return `null` if the provided path is not a peek path.
 */
export function convertPeekPathToSpacePath(
    path: Path,
    options: {routeLayout: RouteLayout},
): Path | null {
    const parts = convertPeekPathToSpacePathParts(path.pathname, options);
    if (!parts) return null;

    return {
        ...path,
        pathname: `${parts[0]}${parts[1]}`,
    };
}

/**
 * This is a helper function that helps convert a Peek URL to different parts,
 * in order to be used for `convertPeekPathToSpacePath`
 */
export function convertPeekPathToSpacePathParts(
    pathname: string,
    {routeLayout}: {routeLayout: RouteLayout},
): [string, string] | null {
    const match = pathname.match(optionalPeekPathWithTasksGroupRegExp);
    if (!match) return null;

    const pathnamePart1 = match[1]!;
    let pathnamePart2 = match[2]!;

    // On desktop we do not want expanding a peek from task comments to navigate
    // to Task comments route and then redirect to the main Task route. This check
    // allows us to directly navigate to the Task route on desktop.
    if (routeLayout !== "narrow" && match.groups?.taskComments) {
        pathnamePart2 = pathnamePart2.slice(0, -9);
    }

    return [pathnamePart1, pathnamePart2];
}
