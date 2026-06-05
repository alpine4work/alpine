import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {SiteSideBarContent} from "~/client/web/sites/site_side_bar_content.js";
import {SiteSideBarModel} from "~/shared/sites/site_model.js";

/**
 * Site sidebar chrome component.
 *
 * Provides horizontal flex layout with the sidebar navigation on the left and the
 * entity content on the right.
 */
export function SiteSideBar({
    item,
    children,
    withoutContextMenu = false,
}: {
    item: SiteSideBarModel;
    children: ReactNode;
    withoutContextMenu?: boolean;
}) {
    return (
        <Box display="flex" flexDirection="row" height="full" width="full">
            <SiteSideBarContent item={item} withoutContextMenu={withoutContextMenu} />
            {children}
        </Box>
    );
}
