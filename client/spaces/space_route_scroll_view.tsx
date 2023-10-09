import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {useScrollbar} from "~/client/design/scrollbar.js";

/**
 * Routes that render under `/s/$spaceId` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export function SpaceRouteScrollView({children}: {children: ReactNode}) {
    return (
        <Box
            ref={useScrollbar()}
            flexGrow="1"
            overflowX="hidden"
            overflowY="auto"
            position="relative"
            zIndex="0"
        >
            <OverlayScopeContextProvider>{children}</OverlayScopeContextProvider>
        </Box>
    );
}
