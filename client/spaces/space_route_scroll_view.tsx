import {ReactNode, Ref, forwardRef} from "react";
import {Box} from "~/client/design/box.js";
import {
    NavigationBarProps,
    navigationBarHeight,
    useNavigationBar,
} from "~/client/design/navigation_bar.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";

const SpaceRouteScrollViewForwardRef = forwardRef(SpaceRouteScrollView);
export {SpaceRouteScrollViewForwardRef as SpaceRouteScrollView};

/**
 * Routes that render under `/s/$spaceId` should may render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Many routes create render their own scroll
 * view like virtualized lists.
 *
 * The scroll view comes with a navigation bar for mobile.
 */
function SpaceRouteScrollView(
    {
        children,
        directChildren,
        ...navigationBarProps
    }: {
        children?: ReactNode;
        directChildren?: ReactNode;
    } & Omit<NavigationBarProps, "ref">,
    ref: Ref<HTMLDivElement>,
) {
    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar(navigationBarProps);

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                ref,
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
            {directChildren}
        </Box>
    );
}
