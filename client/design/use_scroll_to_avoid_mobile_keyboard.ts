import {Memo, RefObject, useEffect} from "react";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";
import {getNavigationBarHeightPxWithoutListening} from "~/client/design/navigation_bar.js";
import {getElementWindowSafeAreaInsetBottomPx} from "~/client/design/safe_area_inset.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    getCurrentBottomBarHeight,
    subscribeToMobileBottomBarFrameChange,
} from "~/client/remix/subscribe_to_mobile_bottom_bar_frame_change.js";
import {
    isMobileKeyboardFrameChangeEnabled,
    subscribeToMobileKeyboardFrameChange,
} from "~/client/remix/subscribe_to_mobile_keyboard_frame_change.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";

let currentKeyboardHeight = 0;

if (isMobileKeyboardFrameChangeEnabled) {
    subscribeToMobileKeyboardFrameChange(({newKeyboardHeight}) => {
        currentKeyboardHeight = newKeyboardHeight;
    });
}

/**
 * When the virtual keyboard opens on mobile devices, you want to scroll
 * content so whatever the user was interacting with is still visible. this
 * hook helps you implement this behavior. You pick an anchor (with
 * `getAnchorPosition()`) and when the keyboard frame changes the hook will
 * make sure the anchor stays visible.
 */
export function useScrollToAvoidMobileKeyboard<
    ScrollableRef extends HTMLElement | VirtualizedScrollViewRef,
>(
    scrollableRef: RefObject<ScrollableRef>,
    {
        getAnchorPosition,
        isDisabled = false,
        isPinned = false,
    }: {
        /**
         * Get the position of the content we want to anchor in our scroll view. For
         * documents this is the document selection. For chat views it's the bottom of
         * the messaging view.
         */
        getAnchorPosition: Memo<
            (oldVisibleRect: {top: number; bottom: number}) => {top: number; height: number} | null
        >;

        /**
         * Disable scrolling when the keyboard frame changes. Defaults to false.
         */
        isDisabled?: boolean;

        /**
         * By default, the objective of this hook is to make sure the anchor content
         * stays visible. This means if after a keyboard frame change the anchor stays
         * completely visible then we don't scroll.
         *
         * However, instead you may want the anchor to maintain its relative position
         * in the visible area. So it scrolls up when the keyboard opens and back down
         * when the keyboard closes. To get this behavior set `isPinned` to true.
         *
         * Defaults to false.
         */
        isPinned?: boolean;
    },
) {
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useEffect(() => {
        if (isDisabled) return;

        // Don't scroll when the keyboard opens if we're part of an inert route.
        if (isInertNativeMobileRoute) return;

        const scroll = ({
            oldKeyboardHeight,
            newKeyboardHeight,
            oldBottomBarHeight,
            newBottomBarHeight,
            isAnimated,
        }: {
            oldKeyboardHeight: number;
            newKeyboardHeight: number;
            oldBottomBarHeight: {visibleKeyboard: number; hiddenKeyboard: number};
            newBottomBarHeight: {visibleKeyboard: number; hiddenKeyboard: number};
            isAnimated: boolean;
        }) => {
            const scrollable = assertExists(scrollableRef.current);
            const scrollableElement: HTMLElement =
                "getElement" in scrollable ? scrollable.getElement() : scrollable;

            const viewportHeight = document.documentElement.getBoundingClientRect().height;
            const scrollableRect = scrollableElement.getBoundingClientRect();

            const windowSafeAreaInsetBottom = getElementWindowSafeAreaInsetBottomPx(
                document.documentElement,
            );

            const tabBarHeight =
                NativeMobileBridge && !NativeMobileBridge.tabBar.isDisabled()
                    ? NativeMobileBridge.tabBar.height -
                      NativeMobileBridge.tabBar.getDeferredScrollOffset()
                    : 0;

            // Considers:
            //
            // - Keyboard height
            // - Bottom bar height
            // - Safe area height
            // - Tab bar height
            const oldCoveredHeight =
                Math.max(oldKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                oldBottomBarHeight[oldKeyboardHeight > 0 ? "visibleKeyboard" : "hiddenKeyboard"];

            const oldCoveredBottom = viewportHeight - oldCoveredHeight;

            const oldVisibleRect = {
                top: Math.min(scrollableRect.top, oldCoveredBottom),
                bottom: Math.min(scrollableRect.bottom, oldCoveredBottom),
            };

            const anchorPosition = getAnchorPosition(oldVisibleRect);
            if (!anchorPosition) return;

            const wasVisible = areRangesOverlapping(
                oldVisibleRect.top,
                oldVisibleRect.bottom,
                anchorPosition.top,
                anchorPosition.top + anchorPosition.height,
            );

            // If the anchor wasn't previously visible scrolling then scrolling by the
            // keyboard and bottom bar delta won't make it visible now.
            if (!wasVisible) return;

            // Considers:
            //
            // - Keyboard height
            // - Bottom bar height
            // - Safe area height
            // - Tab bar height
            const newCoveredHeight =
                Math.max(newKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                newBottomBarHeight[newKeyboardHeight > 0 ? "visibleKeyboard" : "hiddenKeyboard"];

            const newCoveredBottom = viewportHeight - newCoveredHeight;

            const newVisibleRect = {
                top: Math.min(scrollableRect.top, newCoveredBottom),
                bottom: Math.min(scrollableRect.bottom, newCoveredBottom),
            };

            // By default, we only care about making sure the anchor stays visible. So when
            // the keyboard closes (revealing more area) it follows that our anchor would
            // stay visible. However, the user could choose to "pin" this anchor which
            // maintains the anchor's relative position onscreen whether the keyboard is
            // opened or closed.
            //
            // Also, if the keyboard opens and our anchor is in the top half of the content
            // (so not covered) we don't scroll by default. But setting `isPinned` to true,
            // again, attempts to maintain the relative position of the anchor in the
            // visible space.
            if (!isPinned) {
                const isCompletelyVisible = isRangeContained(
                    newVisibleRect.top,
                    newVisibleRect.bottom,
                    anchorPosition.top,
                    anchorPosition.top + anchorPosition.height,
                );

                // If our anchor is completely visible after the keyboard or bottom bar change
                // then we don't need to scroll to make it visible again.
                if (isCompletelyVisible) return;
            }

            const anchorPositionMiddle = anchorPosition.top + anchorPosition.height / 2;

            const anchorPositionMiddlePercent =
                (anchorPositionMiddle - oldVisibleRect.top) /
                (oldVisibleRect.bottom - oldVisibleRect.top);

            const newAnchorPositionMiddle =
                newVisibleRect.top +
                (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionMiddlePercent;

            const scrollDelta = anchorPositionMiddle - newAnchorPositionMiddle;

            const navigationBarHeight = getNavigationBarHeightPxWithoutListening();

            // If our scroll will cause the tab bar to fully hide or fully reveal then
            // compute a new scroll delta considering the tab bar's new state.
            const tabBarHeightAfterScroll =
                NativeMobileBridge && !NativeMobileBridge.tabBar.isDisabled()
                    ? -scrollDelta >= navigationBarHeight
                        ? NativeMobileBridge.tabBar.height
                        : scrollDelta >= navigationBarHeight
                        ? 0
                        : tabBarHeight
                    : tabBarHeight;

            if (tabBarHeightAfterScroll === tabBarHeight) {
                scrollableElement.scrollTo({
                    top: scrollableElement.scrollTop + scrollDelta,
                    behavior: isAnimated ? "smooth" : "instant",
                });
            } else {
                const newCoveredHeight =
                    Math.max(
                        newKeyboardHeight,
                        windowSafeAreaInsetBottom + tabBarHeightAfterScroll,
                    ) +
                    newBottomBarHeight[
                        newKeyboardHeight > 0 ? "visibleKeyboard" : "hiddenKeyboard"
                    ];

                const newCoveredBottom = viewportHeight - newCoveredHeight;

                const newVisibleRect = {
                    top: Math.min(scrollableRect.top, newCoveredBottom),
                    bottom: Math.min(scrollableRect.bottom, newCoveredBottom),
                };

                const newAnchorPositionMiddle =
                    newVisibleRect.top +
                    (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionMiddlePercent;

                const scrollDelta = anchorPositionMiddle - newAnchorPositionMiddle;

                scrollableElement.scrollTo({
                    top: scrollableElement.scrollTop + scrollDelta,
                    behavior: isAnimated ? "smooth" : "instant",
                });
            }
        };

        const unsubscribe1 = subscribeToMobileKeyboardFrameChange(
            ({oldKeyboardHeight, newKeyboardHeight, shouldScroll, isAnimated}) => {
                if (!shouldScroll) return;

                const currentBottomBarHeight = getCurrentBottomBarHeight();

                scroll({
                    oldKeyboardHeight,
                    newKeyboardHeight,
                    oldBottomBarHeight: currentBottomBarHeight,
                    newBottomBarHeight: currentBottomBarHeight,
                    isAnimated,
                });
            },
        );

        const unsubscribe2 = subscribeToMobileBottomBarFrameChange(
            ({oldBottomBarHeight, newBottomBarHeight}) => {
                scroll({
                    oldKeyboardHeight: currentKeyboardHeight,
                    newKeyboardHeight: currentKeyboardHeight,
                    oldBottomBarHeight,
                    newBottomBarHeight,
                    isAnimated: false,
                });
            },
        );

        return () => {
            unsubscribe1();
            unsubscribe2();
        };
    }, [getAnchorPosition, isDisabled, isInertNativeMobileRoute, isPinned, scrollableRef]);
}
