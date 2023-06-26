import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";

/**
 * Routes that render under `/s/$space_id` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export function SpaceRouteScrollView({children}: {children: ReactNode}) {
    return (
        <Box flexGrow="1" overflowX="hidden" overflowY="scroll" position="relative" zIndex="0">
            <OverlayScopeContextProvider>{children}</OverlayScopeContextProvider>
        </Box>
    );
}
