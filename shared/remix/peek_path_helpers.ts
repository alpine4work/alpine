import {Path, To, parsePath} from "history";

const spacePathRegExp = /^(\/s\/[^/]+\/)(?!peek)(.*)$/;
const peekPathRegExp = /^(\/s\/[^/]+)\/peek(\/.*)$/;

/**
 * Is the provided path a peek path?
 */
export function isPeekPath(to: To): boolean {
    const path = typeof to === "string" ? parsePath(to) : to;
    return peekPathRegExp.test(path.pathname ?? "/");
}

/**
 * Converts a path meant to navigate somewhere in a space to instead navigate
 * to a peek URL within the space. Does not guarantee that a peek route
 * actually exists for the URL.
 */
export function convertSpacePathToPeekPath(to: To): Path | null {
    const path = typeof to === "string" ? parsePath(to) : to;
    const match = (path.pathname ?? "/").match(spacePathRegExp);
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
 *
 * Will return `null` if the provided path is not a peek path.
 */
export function convertPeekPathToSpacePath(to: To): Path | null {
    const path = typeof to === "string" ? parsePath(to) : to;
    const match = (path.pathname ?? "/").match(peekPathRegExp);
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
