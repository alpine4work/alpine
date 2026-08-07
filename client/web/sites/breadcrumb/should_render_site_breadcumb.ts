import {PeekContext} from "~/client/web/remix/peek_context_types.js";
import {SiteDataContextValue} from "~/client/web/sites/context/site_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {RouteLayout} from "~/shared/design/core/route_layout.open_source.js";

export function shouldRenderSiteBreadcrumb({
    routeLayout,
    peekContext,
    siteContext,
    accessPolicy,
}: {
    routeLayout: RouteLayout;
    peekContext: PeekContext | null;
    siteContext: SiteDataContextValue | null;
    accessPolicy: AccessPolicy | null;
}) {
    if (accessPolicy?.type !== "Site") return false;
    if (accessPolicy.siteId !== siteContext?.tree.site.id) return false;
    if (siteContext === null) return false;

    if (routeLayout === "narrow") return true;

    // If wide and peek context, we're not rendering site chrome so show the breadcrumb
    if (peekContext) return true;

    return false;
}
