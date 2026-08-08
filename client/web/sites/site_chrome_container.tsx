import {ReactElement} from "react";
import {Box} from "~/client/web/design/box.js";
import {usePeekContext} from "~/client/web/remix/peek_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {SiteChrome} from "~/client/web/sites/site_chrome.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

/**
 * Renders persistent site chrome (sidebars/topbars) around the route outlet for
 * the active site entity.
 *
 * Mounted once in the space layout _outside_ the route `<Outlet>` (and the
 * loading-indicator shimmer) so the chrome — and its local state, like the
 * sidebar's scroll position — survives navigation between entities in the same
 * site. Navigating only re-renders the chrome with a new active entity; it does
 * not remount the sidebar.
 *
 * The entity to render chrome around comes from the active site context
 * (`activeState.activeEntityId`), which `SiteProvider` keeps pointed at the
 * matched route — including the destination entity during a pending within-site
 * navigation, so the chrome highlights where you're going while the shimmer shows.
 *
 * Renders `children` without chrome when there's no active site, the active entity
 * isn't in the site tree, the layout is narrow, or we're inside a peek (mobile /
 * narrow peeks / wide inbox peeks render a `SiteBreadcrumbChip` instead of
 * persistent chrome).
 */
export function SiteChromeContainer({children}: {children: ReactElement}) {
    const siteContext = useSiteContextIfExists();
    const {space} = useSpaceContext();
    const routeLayout = useRouteLayout();
    const peekContext = usePeekContext();

    // TODO(#sites): Remove this gate once we release sites publically.
    if (process.env.NODE_ENV === "production" && space.id !== alpineCompanyKnownSpaceId) {
        return children;
    }

    if (!siteContext) {
        return children;
    }

    const {tree, activeState} = siteContext;
    const {activeEntityId} = activeState;
    const entityEntry = activeEntityId !== null ? tree.entryById.get(activeEntityId) : undefined;

    if (!entityEntry) {
        return children;
    }

    // Mirror `shouldRenderSiteBreadcrumb`: skip chrome for narrow layouts and for any
    // peek context (including wide inbox peeks). Peeks / mobile use the breadcrumb
    // chip instead; chrome also depends on `<PeekStackContext>` which search-modal
    // peeks lack.
    if (routeLayout === "narrow" || peekContext) {
        return children;
    }

    return (
        <Box
            flexGrow="1"
            position="relative"
            zIndex="0"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            marginLeft="8"
        >
            <SiteChrome tree={tree} parentId={entityEntry.parentId}>
                {children}
            </SiteChrome>
        </Box>
    );
}
