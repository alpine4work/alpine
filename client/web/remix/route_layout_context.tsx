import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Get the current `RouteLayout`.
 */
export function useRouteLayout(): RouteLayout {
    const platform = usePlatform();
    const peekContext = usePeekContext();

    return peekContext?.layout ?? getDefaultRouteLayoutForPlatform(platform);
}

/**
 * Get the default `RouteLayout` for the platform. Assuming we're not rendering in
 * a peek.
 */
export function getDefaultRouteLayoutForPlatform(platform: Platform): RouteLayout {
    return platform === "mobile" ? "narrow" : "wide";
}

export type PlatformRouteLayout = "mobileNarrow" | "desktopNarrow" | "desktopWide";

/**
 * Combines `Platform` and `RouteLayout` with knowledge in the type system that we
 * can never have a `wide` `RouteLayout` on a `mobile` platform.
 */
export function getPlatformRouteLayout(
    platform: Platform,
    routeLayout: RouteLayout,
): PlatformRouteLayout {
    switch (platform) {
        case "mobile": {
            assert(routeLayout === "narrow");
            return "mobileNarrow";
        }
        case "desktop": {
            switch (routeLayout) {
                case "narrow":
                    return "desktopNarrow";
                case "wide":
                    return "desktopWide";
                default:
                    throw exhaustive(routeLayout);
            }
        }
        default:
            throw exhaustive(platform);
    }
}
