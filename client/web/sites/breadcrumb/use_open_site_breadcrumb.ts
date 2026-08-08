import {useCallback} from "react";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";
import {getSearchDynamicEntityPathFromEntityIdObjectWithoutAccount} from "~/shared/search/path/get_search_entity_path.js";
import {parseSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

export function useOpenSiteBreadcrumb() {
    const navigate = useNavigate();
    const routeLayout = useRouteLayout();
    const peekContext = usePeekContext();
    const siteContext = useSiteContextIfExists();

    return useCallback(async () => {
        const context = assertExists(siteContext);
        const activeEntityId = assertExists(context.activeState.activeEntityId);
        const site = context.tree.site;

        if (routeLayout === "narrow") {
            const path = {
                pathname: `/site/${site.id}/navigate`,
                search: `activeEntityId=${encodeURIComponent(activeEntityId)}`,
                hash: "",
            };

            const to = peekContext ? (convertSpacePathToPeekPath(path) ?? path) : path;
            await navigate(to, {
                unstable_headers: {"cyberworlds-active-site-id": site.id},
            });
        } else {
            const idObject = parseSiteItemSearchEntityId(activeEntityId);
            const pathname = getSearchDynamicEntityPathFromEntityIdObjectWithoutAccount(
                idObject,
                routeLayout,
            );
            // If the breadcrumb is currently rendered in a wide layout (e.g. inbox views), we
            // don't want to render the site navigation chrome. Instead, clicking on the
            // breadcrumb should open the site chrome around the current entity.
            const path = {
                pathname,
                search: "",
                hash: "",
            };

            await navigate(path, {
                unstable_headers: {"cyberworlds-active-site-id": site.id},
            });
        }
    }, [siteContext, routeLayout, peekContext, navigate]);
}
