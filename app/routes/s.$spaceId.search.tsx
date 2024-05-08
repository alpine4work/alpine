import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

// NOCOMMIT: Implement
export default function SearchRoute() {
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="Search"
            withoutDisappearingTitle={true}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box>Search!</Box>
            <Button
                pressErrorTitle="Couldn’t navigate"
                onPress={() =>
                    navigate(`/s/ywcffewdn377x442nkxd5x41r0/documents/5tjtf4b57haftkb1mmmrmfnqyw`)
                }
            >
                Link Maze
            </Button>
        </SpaceRouteScrollView>
    );
}
