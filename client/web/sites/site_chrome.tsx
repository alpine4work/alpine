import {ReactElement, ReactNode} from "react";
import {SiteTreeForClient} from "~/client/web/sites/context/site_context.js";
import {SiteSideBar} from "~/client/web/sites/site_side_bar.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteSideBarModel, SiteTopBarModel} from "~/shared/sites/site_model.js";

/**
 * Renders site chrome — sidebars and (in the future) topbars — around `children`
 * for the active entity whose container is `parentId`.
 *
 * The rendered structure is derived **only** from the chain of chrome _containers_
 * (`SideBar`s, and eventually `TopBar`s) between `parentId` and the root; the
 * non-chrome ancestors in between — `SideBarSection`s — are skipped, because they
 * render no chrome. Each container is folded around the content innermost-first
 * (root-most container outermost, any nested container inside it, entity content
 * innermost) and keyed by its stable container id.
 *
 * Today only sidebars render; the `TopBar` case is unimplemented. Topbars will
 * fold into this same structure (a column wrapper stacking the bar above the
 * content, rather than a row beside it), and every reason below applies to them
 * unchanged.
 *
 * ## Why this is a flat fold and not a recursive walk of the ancestor chain
 *
 * This component is mounted _above_ the route `<Outlet>` so the chrome survives
 * navigation between entities in the same site (see `SiteChromeContainer`). That
 * persistence only holds if React keeps the _same_ container instance (e.g. a
 * `<SiteSideBar>`) mounted across navigation, and React decides instance identity
 * by an element's **position in the tree** (its path of parent element types +
 * keys), not by its props. Render the "same" container at a different depth and
 * React unmounts the old one and mounts a fresh one, resetting its scroll position
 * and local state. A `key` can't save you across a depth change – it can only
 * disambiguates siblings under the same parent.
 *
 * The previous implementation recursed over the entity's _full_ ancestor chain,
 * including SiteSideBarSection components as pass-through levels that rendered
 * nothing. Take one sidebar with a section, and two entities under it:
 *
 * ```
 * // Entity A — parent is the sidebar.
 *   <SiteChrome>
 *     <SiteSideBar>{children}</SiteSideBar>
 *   </SiteChrome>
 *
 * // Entity B — parent is a section under the sidebar.
 *   <SiteChrome>
 *     <SiteChrome>
 *       <SiteSideBar>{children}</SiteSideBar>
 *     </SiteChrome>
 *   </SiteChrome>
 * ```
 *
 * Now navigate A → B (same site, same sidebar, the case the PR wants to keep
 * mounted). The top <SiteChrome> is stable, but what it renders shifted: at the
 * slot where A had <SiteSideBar>, B now has <SiteChrome> (the section
 * pass-through). Different element type at that position → React unmounts the
 * sidebar and mounts a new one. That's the remount — and it fired on any
 * navigation that crossed a section boundary, i.e. most of them.
 *
 * Collecting only the chrome containers (non-chrome ancestors filtered out)
 * changes the above example to:
 *
 * ```
 * // Entity A — parent is the sidebar.
 *     <SiteChrome>
 *         <SiteSideBar>{children}</SiteSideBar>
 *     </SiteChrome>
 *
 * // Entity B — parent is a section under the sidebar.
 *     <SiteChrome>
 *         <SiteSideBar>{children}</SiteSideBar>
 *     </SiteChrome>
 * ```
 *
 * Rendering the SiteSideBar at the same depth with the same key allows us to
 * maintain the chrome state across navigations.
 */
export function SiteChrome({
    tree,
    parentId,
    children,
    withoutContextMenu = false,
}: {
    tree: SiteTreeForClient;
    parentId: SiteContainerId | null;
    children: ReactNode;
    withoutContextMenu?: boolean;
}) {
    // Walk up from `parentId`, collecting the `SideBar` ancestors (innermost first)
    // and skipping the `SideBarSection`s in between.
    const siteChrome = collectSiteChrome(tree, parentId);

    // Fold the containers around the content innermost-first, so the root-most one
    // ends up outermost. Keyed by container id so the chrome persists across entity
    // navigation and remounts only when a container's identity at a level changes.
    return siteChrome.reduce<ReactElement>(
        (wrapped, chrome) => {
            if (chrome.type === "TopBar") {
                throw new UnimplementedError("TopBar is not implemented");
            }

            return (
                <SiteSideBar key={chrome.id} item={chrome} withoutContextMenu={withoutContextMenu}>
                    {wrapped}
                </SiteSideBar>
            );
        },
        <>{children}</>,
    );
}

/**
 * Collects the chain of chrome containers from `parentId` up to the root,
 * innermost first. Non-chrome ancestors (`SideBarSection`s) are skipped; reaching
 * an `Entity`, a missing entry, or `null` ends the walk.
 *
 * Only `SideBar`s are collected today — the `TopBar` case is unimplemented. When
 * topbars land they're collected here alongside sidebars (and the caller's fold
 * wraps them in their own chrome).
 */
function collectSiteChrome(
    tree: SiteTreeForClient,
    parentId: SiteContainerId | null,
): ReadonlyArray<SiteSideBarModel | SiteTopBarModel> {
    const chrome: Array<SiteSideBarModel | SiteTopBarModel> = [];

    let currentId: SiteContainerId | null = parentId;
    while (currentId !== null) {
        const entry = tree.entryById.get(currentId);
        if (!entry) break;

        switch (entry.type) {
            case "SideBarSection":
                currentId = entry.parentId;
                break;
            case "SideBar":
                chrome.push(entry);
                currentId = entry.parentId;
                break;
            // Topbars aren't rendered yet. When they are, push the container here (the fold in
            // `SiteChrome` wraps it in a `<SiteTopBar>` column) — the persistence reasoning in
            // `SiteChrome` already covers them.
            case "TopBar":
                throw new UnimplementedError("TopBar is not implemented");
            case "Entity":
                // Entities aren't chrome containers, so there's nothing more to wrap.
                currentId = null;
                break;
            default:
                throw exhaustive(entry);
        }
    }

    return chrome;
}
