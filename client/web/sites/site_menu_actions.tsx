import {Link as LinkIcon} from "phosphor-react";
import {useCallback} from "react";
import {MenuAction} from "~/client/web/design/menu.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useSiteContext} from "~/client/web/sites/context/site_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {cast} from "~/shared/helpers/control/cast.js";

export function useSiteMenuActions({editSiteNameAction}: {editSiteNameAction?: MenuAction}) {
    const {space} = useSpaceContext();
    const siteContext = useSiteContext();
    const site = siteContext.tree.site;

    const handleCopyLink = useCallback(async () => {
        const url = new URL(`/s/${space.id}/sites/${site.id}`, window.location.href);
        await writeTextToClipboard(url.toString());
    }, [space.id, site.id]);

    return cast<Array<Array<MenuAction>>>([
        [
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn\u2019t copy site link",
                onPress: handleCopyLink,
            },
            ...(siteContext.favoriteSiteMenuAction
                ? [siteContext.favoriteSiteMenuAction]
                : emptyArray),
        ],
        ...(editSiteNameAction ? [[editSiteNameAction]] : emptyArray),
    ]);
}
