import {useCallback, useMemo} from "react";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";

export function useSiteNavigationBarTitleBreadcrumb({accessPolicy}: {accessPolicy: AccessPolicy}) {
    const routeLayout = useRouteLayout();
    const siteContext = useSiteContextIfExists();
    const peekContext = usePeekContext();
    const navigate = useNavigate();

    const openSite = useCallback(async () => {
        const context = assertExists(siteContext);
        const {activeEntityId} = context.activeState;
        assert(activeEntityId);

        const site = context.tree.site;
        const path = {
            pathname: `/site/${site.id}/navigate`,
            search: `?focus=${encodeURIComponent(activeEntityId)}`,
            hash: "",
        };
        const to = peekContext ? (convertSpacePathToPeekPath(path) ?? path) : path;
        await navigate(to, {
            unstable_headers: {"cyberworlds-active-site-id": site.id},
        });
    }, [navigate, peekContext, siteContext]);

    return useMemo(() => {
        if (accessPolicy.type !== "Site" || accessPolicy.siteId !== siteContext?.tree.site.id) {
            return undefined;
        }

        if (routeLayout !== "narrow" || !siteContext) return undefined;

        return {
            title: siteContext.tree.site.name,
            onPress: openSite,
            pressErrorTitle: "Couldn\u2019t open site",
        };
    }, [accessPolicy, openSite, routeLayout, siteContext]);
}
