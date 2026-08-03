import {useMemo} from "react";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {shouldRenderSiteBreadcrumb} from "~/client/web/sites/breadcrumb/should_render_site_breadcumb.js";
import {useOpenSiteBreadcrumb} from "~/client/web/sites/breadcrumb/use_open_site_breadcrumb.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function useSiteNavigationBarTitleBreadcrumb({accessPolicy}: {accessPolicy: AccessPolicy}) {
    const routeLayout = useRouteLayout();
    const siteContext = useSiteContextIfExists();
    const openSite = useOpenSiteBreadcrumb();
    const peekContext = usePeekContext();

    return useMemo(() => {
        if (
            !shouldRenderSiteBreadcrumb({
                routeLayout,
                peekContext,
                siteContext,
                accessPolicy,
            })
        ) {
            return undefined;
        }

        assert(siteContext);

        return {
            title: siteContext.tree.site.name,
            onPress: openSite,
            pressErrorTitle: "Couldn\u2019t open site",
        };
    }, [accessPolicy, openSite, routeLayout, siteContext, peekContext]);
}
