import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {screenPaddingX} from "~/shared/design/spacing.js";

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

export default function SearchRoute() {
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    const maxWidth = !isMobile ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="Search"
            withoutDisappearingTitle={true}
            titleJustifyContents="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center"></Box>
        </SpaceRouteScrollView>
    );
}
