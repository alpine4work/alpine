import {Path} from "@remix-run/router";

const spacePathRegExp = /^(\/s\/[^/]+\/)(?!peek)(.*)$/;
const peekPathRegExp = /^(\/s\/[^/]+)\/peek(\/.*)$/;

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
export function convertPeekPathToSpacePath(path: Path): Path | null {
    const match = path.pathname.match(peekPathRegExp);
    if (!match) return null;

    const pathnamePart1 = match[1]!;
    const pathnamePart2 = match[2]!;

    return {
        ...path,
        pathname: `${pathnamePart1}${pathnamePart2}`,
    };
}
