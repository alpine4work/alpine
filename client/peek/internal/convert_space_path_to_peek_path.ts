import {Path, To, parsePath} from "history";

/**
 * Converts a path meant to navigate somewhere in a space to instead navigate
 * to a peek URL within the space. Does not guarantee that a peek route
 * actually exists for the URL.
 */
export function convertSpacePathToPeekPath(to: To): Path | null {
    const path = typeof to === "string" ? parsePath(to) : to;
    const match = (path.pathname ?? "/").match(/^(\/s\/[^/]+\/)(?!peek)(.*)$/);
    if (!match) return null;

    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    return {
        search: "",
        hash: "",
        ...path,
        pathname: `${pathnamePart1}peek/${pathnamePart2}`,
    };
}

/**
 * Convert a Peek URL to a path within the space you can navigate to. Every
 * peek route should have a corresponding space route.
 */
export function convertPeekPathToSpacePath(to: To): Path | null {
    const path = typeof to === "string" ? parsePath(to) : to;
    const match = (path.pathname ?? "/").match(/^(\/s\/[^/]+)\/peek(\/.*)$/);
    if (!match) return null;

    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    return {
        search: "",
        hash: "",
        ...path,
        pathname: `${pathnamePart1}${pathnamePart2}`,
    };
}
