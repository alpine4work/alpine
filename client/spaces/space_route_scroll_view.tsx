import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {
    NavigationBarProps,
    navigationBarHeight,
    useNavigationBar,
} from "~/client/design/navigation_bar.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";

/**
 * Routes that render under `/s/$spaceId` should may render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Many routes create render their own scroll
 * view like virtualized lists.
 *
 * The scroll view comes with a navigation bar for mobile.
 */
export function SpaceRouteScrollView({
    children,
    ...navigationBarProps
}: {
    children: ReactNode;
} & Omit<NavigationBarProps, "ref">) {
    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar(navigationBarProps);

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexGrow="1"
            overflowX="hidden"
            overflowY="auto"
            position="relative"
            zIndex="0"
        >
            <Box position="relative">
                <OverlayScopeContextProvider>
                    {navigationBar}
                    <Box height="safe-area-inset-top" />
                    <Box height={navigationBarHeight} />
                    {children}
                </OverlayScopeContextProvider>
            </Box>
        </Box>
    );
}
