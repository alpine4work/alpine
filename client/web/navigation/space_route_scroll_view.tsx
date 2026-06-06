import {ReactNode, Ref, forwardRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {NavigationBarProps} from "~/client/web/navigation/navigation_bar_types.js";

const SpaceRouteScrollViewForwardRef = forwardRef(SpaceRouteScrollView);
export {SpaceRouteScrollViewForwardRef as SpaceRouteScrollView};

/**
 * Routes that render under the `_space` route should may render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for a
 * space route's content area. Many routes create render their own scroll view like
 * virtualized lists.
 *
 * The scroll view comes with a navigation bar for mobile.
 */
function SpaceRouteScrollView(
    {
        children,
        ...navigationBarProps
    }: {
        children?: ReactNode;
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
            <Box position="relative" paddingBottom="safe-area-inset">
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
