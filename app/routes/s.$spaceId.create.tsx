import {NavigationBarContent} from "~/client/design/navigation_bar.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";

export function meta() {
    return [{title: `Create${metaTitlePostfix}`}];
}

// NOCOMMIT: Implement
export default function CreateRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const isMobile = useIsMobile();
    const withMobileLayout = isMobile || withMobileLayoutProp;

    return (
        <SpaceRouteScrollView>
            <NavigationBarContent withMobileLayout={withMobileLayout} title="Create" />
            Create!
        </SpaceRouteScrollView>
    );
}
