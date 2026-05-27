import {ReactNode} from "react";
import {SiteTreeForClient} from "~/client/web/sites/context/site_context.js";
import {SiteSideBar} from "~/client/web/sites/site_side_bar.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";

/**
 * Recursively renders site chrome by walking up the parent chain.
 *
 * Each chrome container (SideBar, TopBar) wraps the content in its layout. The
 * recursion continues until we reach the root (parentId === null).
 *
 * Layout examples:
 *
 * - TopBar + SideBar (TopBar parent of SideBar): TopBar on top, SideBar + content
 *   below
 * - Nested SideBars: Multiple sidebars render side by side
 */
export function SiteChrome({
    tree,
    parentId,
    children,
}: {
    tree: SiteTreeForClient;
    parentId: SiteContainerId | null;
    children: ReactNode;
}) {
    if (parentId === null) {
        return <>{children}</>;
    }

    const parent = tree.entryById.get(parentId);
    if (!parent) {
        return <>{children}</>;
    }

    switch (parent.type) {
        case "SideBarSection": {
            // Sections don't add chrome, continue up to find the actual sidebar
            return (
                <SiteChrome tree={tree} parentId={parent.parentId}>
                    {children}
                </SiteChrome>
            );
        }
        case "SideBar": {
            return (
                <SiteChrome tree={tree} parentId={parent.parentId}>
                    <SiteSideBar item={parent}>{children}</SiteSideBar>
                </SiteChrome>
            );
        }
        case "TopBar": {
            throw new UnimplementedError("TopBar is not implemented");
        }
        case "Entity": {
            return <>{children}</>;
        }
        default:
            throw exhaustive(parent);
    }
}
