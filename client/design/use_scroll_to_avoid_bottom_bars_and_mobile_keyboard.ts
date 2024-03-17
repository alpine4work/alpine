import {Memo, RefObject, useEffect} from "react";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {getNavigationBarHeightPxWithoutListening} from "~/client/design/navigation_bar.js";
import {getElementWindowSafeAreaInsetBottomPx} from "~/client/design/safe_area_inset.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    getCurrentBottomBarHeight,
    subscribeToBottomBarFrameChange,
} from "~/client/remix/subscribe_to_bottom_bar_frame_change.js";
import {
    isMobileKeyboardFrameChangeEnabled,
    subscribeToMobileKeyboardFrameChange,
} from "~/client/remix/subscribe_to_mobile_keyboard_frame_change.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

let currentMobileKeyboardHeight = 0;

if (isMobileKeyboardFrameChangeEnabled) {
    subscribeToMobileKeyboardFrameChange(({newKeyboardHeight}) => {
        currentMobileKeyboardHeight = newKeyboardHeight;
    });
}

/**
 * When the virtual keyboard opens on mobile devices, you want to scroll
 * content so whatever the user was interacting with is still visible. this
 * hook helps you implement this behavior. You pick an anchor (with
 * `getAnchorPosition()`) and when the keyboard frame changes the hook will
 * make sure the anchor stays visible.
 *
 * This runs on both desktop and mobile. While desktop doesn't have a mobile
 * keyboard to avoid, we still register bottom bars which change in height and
 * we want the scrollable area to avoid.
 */
// TODO(calebmer): On desktop, we should probably only consider bottom bars
// within the current peek. Bottom bars outside the peek shouldn't effect the
// peek and vice versa.
export function useScrollToAvoidBottomBarsAndMobileKeyboard<
    ScrollableRef extends HTMLElement | VirtualizedScrollViewRef,
>(
    scrollableRef: RefObject<ScrollableRef>,
    {
        getAnchorPosition,
        isDisabled = false,
        isPinned = false,
        scrollableInsetBottom = 0,
    }: {
        /**
         * Get the position of the content we want to anchor in our scroll view. For
         * documents this is the document selection. For chat views it's the bottom of
         * the messaging view.
         *
         * The position should be in viewport coordinates.
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

        /**
         * Allow the caller to apply some inset to the bottom of the scrollable area.
         * Use this if you have some absolutely positioned element covering your
         * scrollable area so we don't scroll under that element.
         */
        scrollableInsetBottom?: RemLength | number;
    },
) {
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useEffect(() => {
        if (isDisabled) return;

        // Don't scroll when the keyboard opens if we're part of an inert route.
        if (isInertNativeMobileRoute) return;

        const scrollable = assertExists(scrollableRef.current);
        const scrollableElement: HTMLElement =
            "getElement" in scrollable ? scrollable.getElement() : scrollable;

        let lastScrollableRect = scrollableElement.getBoundingClientRect();

        const handleResize = () => {
            // Update our last scrollable rect right before the next paint.
            requestAnimationFrame(() => {
                lastScrollableRect = scrollableElement.getBoundingClientRect();
            });
        };

        addResizeListenerForElement(scrollableElement, handleResize);

        const scroll = ({
            oldMobileKeyboardHeight,
            newMobileKeyboardHeight,
            oldBottomBarHeight,
            newBottomBarHeight,
            isAnimated,
        }: {
            oldMobileKeyboardHeight: number;
            newMobileKeyboardHeight: number;
            oldBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
            newBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
            isAnimated: boolean;
        }) => {
            const remPx = getRemPxWithoutListening();

            const viewportHeight = document.documentElement.getBoundingClientRect().height;

            const currentScrollableRect = scrollableElement.getBoundingClientRect();

            // `scroll()` is sometimes called because a bottom bar resized. Sometimes
            // bottom bar resizing will also resize the scrollable element (like in
            // `<MessagingView>` with `<MessageInput>` that lays out the virtualized scroll
            // view + input with flexbox vertically).
            //
            // `lastScrollableRect` has the dimensions of our scrollable element before the
            // scrollable element resized.
            const {top: oldScrollableTop, bottom: oldOriginalScrollableBottom} = lastScrollableRect;
            const {top: newScrollableTop, bottom: newOriginalScrollableBottom} =
                currentScrollableRect;

            const scrollableInsetBottomPx =
                typeof scrollableInsetBottom === "string"
                    ? convertRemLengthToPx(scrollableInsetBottom, remPx)
                    : scrollableInsetBottom;

            const oldScrollableBottom = oldOriginalScrollableBottom - scrollableInsetBottomPx;
            const newScrollableBottom = newOriginalScrollableBottom - scrollableInsetBottomPx;

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
                Math.max(oldMobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                oldBottomBarHeight[
                    oldMobileKeyboardHeight > 0 ? "visibleMobileKeyboard" : "hiddenMobileKeyboard"
                ];

            const oldCoveredBottom = viewportHeight - oldCoveredHeight;

            const oldVisibleRect = {
                top: Math.min(oldScrollableTop, oldCoveredBottom),
                bottom: Math.min(oldScrollableBottom, oldCoveredBottom),
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
                Math.max(newMobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                newBottomBarHeight[
                    newMobileKeyboardHeight > 0 ? "visibleMobileKeyboard" : "hiddenMobileKeyboard"
                ];

            const newCoveredBottom = viewportHeight - newCoveredHeight;

            const newVisibleRect = {
                top: Math.min(newScrollableTop, newCoveredBottom),
                bottom: Math.min(newScrollableBottom, newCoveredBottom),
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

            const constrainedOldVisibleRect = {
                top: oldVisibleRect.top + anchorPosition.height / 2,
                bottom: oldVisibleRect.bottom - anchorPosition.height / 2,
            };
            constrainedOldVisibleRect.bottom = Math.max(
                constrainedOldVisibleRect.top,
                constrainedOldVisibleRect.bottom,
            );

            // We need to pick a Y position within our anchor to pin. If the anchor is at
            // the top of the visible rect then we want to anchor the top Y position, if
            // the anchor is at the bottom of the visible rect then we want to anchor the
            // bottom Y position, if the anchor is in the middle of the visible rect
            // then we want to anchor the middle Y position, and so on.
            //
            // Compute that anchor position here.
            const anchorPositionY =
                anchorPosition.top +
                anchorPosition.height *
                    clamp(
                        0,
                        (anchorPositionMiddle - constrainedOldVisibleRect.top) /
                            (constrainedOldVisibleRect.bottom - constrainedOldVisibleRect.top),
                        1,
                    );

            const anchorPositionYPercent =
                (anchorPositionY - oldVisibleRect.top) /
                (oldVisibleRect.bottom - oldVisibleRect.top);

            const newAnchorPositionY =
                newVisibleRect.top +
                (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionYPercent;

            // If our visible rect is growing then we need to make sure we scroll at least
            // the same number of pixels as it took to grow the visible rect. Otherwise, if
            // we're at the bottom of the scroll view we may not scroll the entire newly
            // visible safe area offscreen.
            //
            // To test this, play with entering edit mode for `<MessageView>`s near the
            // bottom of the screen.
            const minScrollDelta = oldVisibleRect.bottom - newVisibleRect.bottom;
            let scrollDelta = Math.min(minScrollDelta, anchorPositionY - newAnchorPositionY);

            // If our scrollable element is scrolled to the bottom and our scrollable
            // element grew (e.g. you deleted some text in a `<MessageInput>` shrinking the
            // `<MessageInput>` and causing the corresponding `<VirtualizedScrollView>` to
            // grow) then the browser must automatically subtract from the scroll offset to
            // fill the newly visible space. This avoids breaking the rule that scroll
            // offset must be less than `scrollHeight - clientHeight`.
            //
            // This hook will want to apply the same scroll change the browser already made
            // leaving us in the wrong position. So detect when the browser will
            // automatically adjust the scroll offset and remove from our own scroll delta
            // so we don't apply the same scroll again.
            if (
                currentScrollableRect.height > lastScrollableRect.height &&
                scrollableElement.scrollTop + scrollableElement.clientHeight ===
                    scrollableElement.scrollHeight
            ) {
                scrollDelta += currentScrollableRect.height - lastScrollableRect.height;

                // So mobile WebKit doesn't do the automatic scroll adjustment until the user
                // or JavaScript initiates a scroll. So if our scroll delta is 0 (well between
                // -1 and 1 to support fractions like 0.5) then move our scroll just a smidge
                // so WebKit automatic scroll adjustment kicks in. This seems to work fine on
                // desktop WebKit.
                //
                // To test this, open the keyboard in a chat at the end of messages. Hit
                // return so the message input grows then hit delete so it shrinks back.
                //
                // We use this same trick in `useScrollToNewMessages()`.
                if (isMobileWebKit && -1 < scrollDelta && scrollDelta < 1) {
                    scrollDelta = -0.1;
                }
            }

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
                        newMobileKeyboardHeight,
                        windowSafeAreaInsetBottom + tabBarHeightAfterScroll,
                    ) +
                    newBottomBarHeight[
                        newMobileKeyboardHeight > 0
                            ? "visibleMobileKeyboard"
                            : "hiddenMobileKeyboard"
                    ];

                const newCoveredBottom = viewportHeight - newCoveredHeight;

                const newVisibleRect = {
                    top: Math.min(newScrollableTop, newCoveredBottom),
                    bottom: Math.min(newScrollableBottom, newCoveredBottom),
                };

                const newAnchorPositionY =
                    newVisibleRect.top +
                    (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionYPercent;

                const minScrollDelta = oldVisibleRect.bottom - newVisibleRect.bottom;
                const scrollDelta = Math.min(minScrollDelta, anchorPositionY - newAnchorPositionY);

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
                    oldMobileKeyboardHeight: oldKeyboardHeight,
                    newMobileKeyboardHeight: newKeyboardHeight,
                    oldBottomBarHeight: currentBottomBarHeight,
                    newBottomBarHeight: currentBottomBarHeight,
                    isAnimated,
                });
            },
        );

        const unsubscribe2 = subscribeToBottomBarFrameChange(
            ({oldBottomBarHeight, newBottomBarHeight}) => {
                scroll({
                    oldMobileKeyboardHeight: currentMobileKeyboardHeight,
                    newMobileKeyboardHeight: currentMobileKeyboardHeight,
                    oldBottomBarHeight,
                    newBottomBarHeight,
                    isAnimated: false,
                });
            },
        );

        return () => {
            removeResizeListenerForElement(scrollableElement, handleResize);
            unsubscribe1();
            unsubscribe2();
        };
    }, [
        getAnchorPosition,
        isDisabled,
        isInertNativeMobileRoute,
        isPinned,
        scrollableInsetBottom,
        scrollableRef,
    ]);
}
