/**
 * Gets the route string (e.g. `/doc/:documentId`) from the Remix router matches
 * array.
 */
export function getRouteStringFromMatches(
    matches: ReadonlyArray<{readonly route: {readonly id: string; readonly path?: string}}>,
): string {
    let route = "";
    for (const match of matches) {
        if (match.route.id === "root") continue;
        if (match.route.path === undefined) continue;
        route = `${route}/${match.route.path}`;
    }
    return route;
}
