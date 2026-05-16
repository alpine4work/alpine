import {ReactElement, ReactNode} from "react";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

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
    // TODO(#sites): We'll use this "hook" to render entities within the site chrome. No-ops for now
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    {entityId}: {entityId: SiteItemSearchEntityId},
    children: Children,
): ReactElement | Children {
    return children;
}
