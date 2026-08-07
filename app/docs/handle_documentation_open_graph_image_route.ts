import {getDocumentationOpenGraphImageRoute} from "~/app/docs/get_documentation_open_graph_image_route.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export type HandledDocumentationOpenGraphImageRoute<RouteMatches> = [
    string,
    {
        matches: RouteMatches;
        route: string;
        url: URL;
    },
];

/**
 * Match a nested Open Graph image URL against its internal Remix resource route.
 */
export function handleDocumentationOpenGraphImageRoute<RouteMatches>(
    url: URL,
    matchServerRoutes: (url: URL) => RouteMatches | null,
): HandledDocumentationOpenGraphImageRoute<RouteMatches> | null {
    const openGraphImageRoute = getDocumentationOpenGraphImageRoute(url);
    if (openGraphImageRoute === null) return null;

    const matches = matchServerRoutes(openGraphImageRoute.url);
    assert(matches !== null, "Expected documentation Open Graph image route");

    return [
        openGraphImageRoute.route,
        {
            matches,
            route: openGraphImageRoute.route,
            url: openGraphImageRoute.url,
        },
    ];
}
