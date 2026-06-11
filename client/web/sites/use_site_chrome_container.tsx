import {ReactElement, ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {SiteChrome} from "~/client/web/sites/site_chrome.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

/**
 * Hook that wraps entity content with site chrome (sidebars/topbars) based on the
 * entity's position in the site tree hierarchy.
 *
 * This recursively walks up the parent chain from the entity and wraps the content
 * in the appropriate chrome components. SideBarSections are passthrough - they
 * don't add visual chrome, only affect the sidebar's internal navigation display.
 *
 * Site activation is handled by `SiteProvider` via `useMatches` — this hook just
 * reads the already-active site context and renders chrome if the current entity
 * is in the site tree.
 */
export function useSiteChromeContainer<Children extends ReactNode>(
    {entityId}: {entityId: SiteItemSearchEntityId},
    children: Children,
): ReactElement | Children {
    const siteContext = useSiteContextIfExists();
    const {space} = useSpaceContext();
    const routeLayout = useRouteLayout();

    // TODO(#sites): Remove this gate once we release sites publically.
    if (process.env.NODE_ENV === "production" && space.id !== alpineCompanyKnownSpaceId) {
        return children;
    }

    if (!siteContext) {
        return children;
    }

    const {tree} = siteContext;
    const entityEntry = tree.entryById.get(entityId);

    if (!entityEntry) {
        return children;
    }

    if (routeLayout === "narrow") {
        // Narrow layouts (mobile, peeks) don't render persistent site chrome. Each
        // entity's detail view instead renders a `SiteBreadcrumbChip` above its title
        // (matching the file-entity preview), which opens the site's `navigate` route to
        // browse the tree.
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
