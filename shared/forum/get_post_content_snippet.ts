import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";
import {RouteLayout} from "~/shared/design/core/route_layout.open_source.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";

export function getPostContentSnippet(
    content: PostContent,
    {platform, routeLayout}: {platform: Platform; routeLayout: RouteLayout},
) {
    return getContentSnippet(
        content.resolve(0),
        {linesAbove: 0, linesBelow: routeLayout === "narrow" ? 12 : 16},
        {
            // 1.125x the number of "x"s we can fit in a single line in a peek (64). We want to
            // be slightly more aggressive than the default grapheme count (which counts the
            // "l" character which is narrower) since we render the entire snippet.
            maxLineGraphemeCount: platform === "mobile" ? 42 : 72,
        },
    );
}
