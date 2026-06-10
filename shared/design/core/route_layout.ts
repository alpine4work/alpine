import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

/**
 * How the current route should be laid out. By default this is derived from the
 * platform: on `desktop` the layout is `wide` and on `mobile` the layout is
 * `narrow`. However, we sometimes override this layout when rendering a peek
 * rendered with `<PeekRemixEmbed>`. For example:
 *
 * - Peeks in the peek stack render with a `narrow` layout.
 * - Peeks in the search modal render with a `narrow` layout.
 * - Peeks in the inbox route render with a `wide` layout.
 *
 * A `wide` layout means there's plenty of horizontal space to render content
 * (e.g. >768px width). Whereas in `narrow` layouts there's limited horizontal
 * space. Typically, `wide` is associated with desktop layouts and `narrow` is
 * associated with mobile layouts. However, we may still render a `narrow` layout
 * on our `desktop` `Platform`.
 *
 * Route layouts are constant for an entire route. The route layout may only change
 * if you're rendering a sub-route.
 */
export type RouteLayout = "narrow" | "wide";

/**
 * All the route layouts.
 */
export const allRouteLayouts = ["narrow", "wide"] as const;

assertEqualTypes<(typeof allRouteLayouts)[number], RouteLayout>();
