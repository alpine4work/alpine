import {Memo, RefObject, useCallback, useEffect} from "react";
import {
    dispatchNavigationBarPrepareSmoothScrollToEventEmitter,
    flushNavigationBarScrollEventEmitter,
    navigationBarHeightRem,
} from "~/client/web/design/navigation_bar_helpers.js";
import {
    getElementSafeAreaInsetTopPx,
    getElementWindowSafeAreaInsetBottomPx,
} from "~/client/web/design/safe_area_inset.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {
    useGetCurrentBottomBarHeight,
    useSubscribeToBottomBarFrameChange,
} from "~/client/web/design/subscribe_to_bottom_bar_frame_change.js";
import {
    isMobileKeyboardFrameChangeEnabled,
    subscribeToMobileKeyboardFrameChange,
} from "~/client/web/design/subscribe_to_mobile_keyboard_frame_change.js";
import {useIsBehindMobileFullScreenModal} from "~/client/web/design/use_is_behind_mobile_full_screen_modal.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {throwIfRendering} from "~/client/web/helpers/lifecycle/throw_if_rendering.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useIsInertNativeMobileRoute} from "~/client/web/remix/use_is_inert_native_mobile_route.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

let currentMobileKeyboardHeight = 0;

if (isMobileKeyboardFrameChangeEnabled) {
    let blurTimeout: Timeout | null = null;

    subscribeToMobileKeyboardFrameChange(({oldKeyboardHeight, newKeyboardHeight}) => {
        // If the same event is emit multiple times, ignore it.
        if (newKeyboardHeight === currentMobileKeyboardHeight) return;

        currentMobileKeyboardHeight = newKeyboardHeight;

        blurTimeout?.clear();
        blurTimeout = null;

        // We've observed that in our native iOS app when
        // `scrollView.keyboardDismissMode = .interactive` is set, when the keyboard
        // closes because the user scrolls down in a scroll view WebKit doesn't unfocus
        // the element that opened the keyboard in the first place. This is likely an
        // oversight on the part of the WebKit developers since they didn't intend for
        // `scrollView.keyboardDismissMode = .interactive` to be enabled in WebKit. Our
        // fix is to detect when the keyboard closes and if a text input is still
        // focused after the text input closes, manually blur it ourselves.
        //
        // We wait half a second before blurring so the keyboard close animation
        // followed by any changes from the blur (e.g. hiding overlays) isn't too
        // jarring.
        if (
            NativeMobileBridge &&
            isMobileWebKit &&
            // If a keyboard substitute is open we're intentionally closing the keyboard
            // while still wanting to maintain focus.
            !NativeMobileBridge.keyboard.isSubstituteOpen() &&
            newKeyboardHeight === 0 &&
            oldKeyboardHeight > 0 &&
            document.activeElement &&
            isTextInputElement(document.activeElement)
        ) {
            const activeElement = document.activeElement;

            blurTimeout = createTimeout(() => {
                blurTimeout = null;
                if (activeElement === document.activeElement) {
                    activeElement.blur();
                }
            }, 500);
        }
    });
}

export function getCurrentMobileKeyboardHeight(): number {
    return currentMobileKeyboardHeight;
}

/**
 * Get the space on our screen covered by safe area, the tab bar, the mobile
 * keyboard, and any bottom bars.
 *
 * The returned function reads mutable state so you may not call it
 * during React renders.
 */
export function useGetCurrentCoveredHeight(): Memo<() => number> {
    const getBottomBarHeight = useGetCurrentBottomBarHeight();

    return useCallback(() => {
        // We read mutable state (`currentMobileKeyboardHeight` and
        // `getElementWindowSafeAreaInsetBottomPx()`) so this function can't be called
        // during a React render.
        throwIfRendering();

        const mobileKeyboardHeight = currentMobileKeyboardHeight;

        const tabBarHeight =
            NativeMobileBridge && !NativeMobileBridge.tabBar.isHidden()
                ? Math.max(
                      0,
                      NativeMobileBridge.tabBar.height -
                          NativeMobileBridge.tabBar.getDeferredScrollOffset(),
                  )
                : 0;

        const windowSafeAreaInsetBottom = getElementWindowSafeAreaInsetBottomPx(
            document.documentElement,
        );

        const coveredHeight =
            Math.max(mobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
            getBottomBarHeight()[
                mobileKeyboardHeight > 0 ? "visibleMobileKeyboard" : "hiddenMobileKeyboard"
            ];

        return coveredHeight;
    }, [getBottomBarHeight]);
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
export function useScrollToAvoidBottomBarsAndMobileKeyboard<
    ScrollableRef extends HTMLElement | {getElement: () => HTMLElement},
>(
    scrollableRef: RefObject<ScrollableRef | null>,
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
    const routeLayout = useRouteLayout();
    const getCurrentBottomBarHeight = useGetCurrentBottomBarHeight();
    const subscribeToBottomBarFrameChange = useSubscribeToBottomBarFrameChange();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    useEffect(() => {
        if (isDisabled) return;

        // Don't scroll when the keyboard opens if we're part of an inert route.
        if (isInert) return;

        const scrollable = assertExists(scrollableRef.current);
        const scrollableElement: HTMLElement =
            "getElement" in scrollable ? scrollable.getElement() : scrollable;

        let lastScrollableRect = scrollableElement.getBoundingClientRect();

        // If we're performing a navigation animation (e.g. peek is opening) then
        // measure the scrollable rect again after the animation has finished.
        //
        // This fixes a bug where if you open a notification peek from the inbox
        // overlay we'll think `lastScrollableRect` is offscreen ultimately causing
        // `scrollDelta` to be NaN. Try opening a chat peek from the inbox overlay then
        // typing in the message input such that the message input grows. Because
        // `scrollDelta` is NaN this will scroll you to the top of the peek.
        scheduleAfterNavigationAnimation(() => {
            lastScrollableRect = scrollableElement.getBoundingClientRect();
        });

        const handleResize = () => {
            // Update our last scrollable rect right before the next paint.
            requestAnimationFrame(() => {
                lastScrollableRect = scrollableElement.getBoundingClientRect();
            });
        };

        addResizeListenerForElement(scrollableElement, handleResize);

        let previousScrollTop1 = scrollableElement.scrollTop;
        let previousScrollTop2 = scrollableElement.scrollTop;

        let previousScrollTime1: number | null = null;
        let previousScrollTime2: number | null = null;

        const handleScroll = () => {
            previousScrollTime2 = previousScrollTime1;
            previousScrollTime1 = Date.now();

            previousScrollTop2 = previousScrollTop1;
            previousScrollTop1 = scrollableElement.scrollTop;
        };

        // We consider the user to be continuously scrolling if there are at least two
        // scroll events which happened in quick succession.
        const isContinuouslyScrolling = () => {
            if (previousScrollTime1 === null || previousScrollTime2 === null) return false;

            return (
                Date.now() - previousScrollTime1 <= 32 &&
                previousScrollTime1 - previousScrollTime2 <= 32
            );
        };

        scrollableElement.addEventListener("scroll", handleScroll);

        let recoverableScrollDelta: {
            time: number;
            scrollDeltaDifference: number;
        } | null = null;

        const scroll = ({
            isAnimated,
            oldMobileKeyboardHeight,
            newMobileKeyboardHeight,
            oldBottomBarHeight,
            newBottomBarHeight,
            wasBottomBarMounted,
            wasBottomBarUnmounted,
        }: {
            isAnimated: boolean;
            oldMobileKeyboardHeight: number;
            newMobileKeyboardHeight: number;
            oldBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
            newBottomBarHeight: {visibleMobileKeyboard: number; hiddenMobileKeyboard: number};
            wasBottomBarMounted: boolean;
            wasBottomBarUnmounted: boolean;
        }) => {
            // Don't scroll for covered height changes that mounts/unmounts a new bar. If
            // the bottom bar is net new then we'll go from 0 to the bottom bar's height
            // when the component mounts (and vice versa on unmount). The user hasn't seen
            // any content yet so it doesn't make sense to scroll them.
            if (wasBottomBarMounted || wasBottomBarUnmounted) return;

            const spacingScale = getSpacingScaleWithoutListening();
            const navigationBarHeight = navigationBarHeightRem * remPxBySpacingScale[spacingScale];

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

            // In mobile WebKit, when the keyboard opens the document scrolls (even though
            // `overflow: hidden` is set on the document). We reset the scroll back to 0 to
            // keep everything consistent in `useMobileWebKitKeyboardSupport()` but that
            // may not have happened at this point. So adjust by the document scroll
            // position to get the correct scrollable element top.
            const newScrollableTop =
                currentScrollableRect.top +
                (isMobileWebKit ? document.documentElement.scrollTop : 0);
            const newOriginalScrollableBottom =
                currentScrollableRect.bottom +
                (isMobileWebKit ? document.documentElement.scrollTop : 0);

            const scrollableInsetBottomPx =
                typeof scrollableInsetBottom === "string"
                    ? convertRemLengthToPx(scrollableInsetBottom, spacingScale)
                    : scrollableInsetBottom;

            const oldScrollableBottom = oldOriginalScrollableBottom - scrollableInsetBottomPx;
            const newScrollableBottom = newOriginalScrollableBottom - scrollableInsetBottomPx;

            const safeAreaInsetTop = getElementSafeAreaInsetTopPx(document.documentElement);
            const windowSafeAreaInsetBottom = getElementWindowSafeAreaInsetBottomPx(
                document.documentElement,
            );

            const tabBarHeight =
                NativeMobileBridge && !NativeMobileBridge.tabBar.isHidden()
                    ? Math.max(
                          0,
                          NativeMobileBridge.tabBar.height -
                              NativeMobileBridge.tabBar.getDeferredScrollOffset(),
                      )
                    : 0;

            const oldBottomBarResolvedHeight =
                oldBottomBarHeight[
                    oldMobileKeyboardHeight > 0 ? "visibleMobileKeyboard" : "hiddenMobileKeyboard"
                ];

            // Considers:
            //
            // - Keyboard height
            // - Bottom bar height
            // - Safe area height
            // - Tab bar height
            const oldCoveredHeight =
                Math.max(oldMobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                oldBottomBarResolvedHeight;

            const oldCoveredBottom = viewportHeight - oldCoveredHeight;

            const oldVisibleRect = {
                top: Math.min(
                    Math.max(oldScrollableTop, safeAreaInsetTop + navigationBarHeight),
                    oldCoveredBottom,
                ),
                bottom: Math.min(oldScrollableBottom, oldCoveredBottom),
            };

            const newBottomBarResolvedHeight =
                newBottomBarHeight[
                    newMobileKeyboardHeight > 0 ? "visibleMobileKeyboard" : "hiddenMobileKeyboard"
                ];

            // Considers:
            //
            // - Keyboard height
            // - Bottom bar height
            // - Safe area height
            // - Tab bar height
            const newCoveredHeight =
                Math.max(newMobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                newBottomBarResolvedHeight;

            const newCoveredBottom = viewportHeight - newCoveredHeight;

            const newVisibleRect = {
                top: Math.min(
                    Math.max(newScrollableTop, safeAreaInsetTop + navigationBarHeight),
                    newCoveredBottom,
                ),
                bottom: Math.min(newScrollableBottom, newCoveredBottom),
            };
            const originalNewVisibleRect = newVisibleRect;

            const scrollBottom =
                scrollableElement.scrollHeight -
                (scrollableElement.scrollTop + scrollableElement.clientHeight);

            // If we decide to bail out of scrolling we should call this fallback scroll
            // function. It performs one final check to see if we need to scroll since
            // we're at the bottom of the scroll view and some keyboard safe area is about
            // to be removed.
            //
            // Generally this path is only called if `anchorPosition` returns null or
            // `isPinned` is false. If `isPinned` is true keeping the anchor visible should
            // automatically make sure safe area stays offscreen.
            //
            // To test this path go to a task detail view on mobile with one or two
            // subtasks. Tap the first subtask. This will scroll so the subtask stays in
            // view. Then tap "Done". This should scroll back up so the safe area added for
            // the keyboard doesn't remain visible.
            const fallbackScroll = () => {
                // If we've already scrolled to the top (or overscrolled above the top) then
                // we don't need a fallback scroll which would only scroll us up.
                if (scrollableElement.scrollTop <= 0) return;

                // If the user is continuously scrolling up then assume the user will keep
                // scrolling up. On iOS a momentum scroll animation may be running. We don't
                // want to interrupt the continuous scroll with our fallback scroll which also
                // scrolls us up.
                //
                // This happens on iOS when the user scrolls up to dismiss the keyboard. The
                // keyboard may dismissed before the momentum scroll finishes taking the user
                // to the top of the screen. Interrupting the momentum scroll ends up looking
                // janky.
                if (isContinuouslyScrolling() && previousScrollTop1 < previousScrollTop2) return;

                if (originalNewVisibleRect.bottom <= oldVisibleRect.bottom) return;

                // Since our fallback scroll is used to scroll up at the end of our scroll
                // view, we need to include the tab bar height in our calculations. 1) We're
                // scrolling up so the tab bar will be revealed. 2) The goal is for our final
                // scroll position to be the end of the scroll view where the tab bar will
                // always be visible regardless of the tab bar's partial visibility.
                const newCoveredHeight =
                    Math.max(
                        newMobileKeyboardHeight,
                        windowSafeAreaInsetBottom + (NativeMobileBridge?.tabBar.height ?? 0),
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

                // The amount of safe area removed by this keyboard frame change.
                const visibleRectBottomDelta = newVisibleRect.bottom - oldVisibleRect.bottom;

                // Will the scroll bottom seen by the user be invalid after safe area is
                // removed? (Scroll bottom must be greater than 0.) If so then we need to
                // scroll past the safe area.
                const newScrollBottom = scrollBottom - visibleRectBottomDelta;
                if (newScrollBottom >= 0) return;

                const newScrollTop = Math.max(0, scrollableElement.scrollTop + newScrollBottom);

                // Prepare navigation bar scroll direction state for a smooth scroll animation
                // run by the native platform. For example, on mobile WebKit scroll events may
                // be sent to the web thread after a delay as scroll animation performance is
                // prioritized.
                //
                // Example of bug this fixes:
                // https://gist.github.com/calebmer/91334a35af1e9ee8043bea5e1c105728
                if (isAnimated) {
                    dispatchNavigationBarPrepareSmoothScrollToEventEmitter.emit({
                        element: scrollableElement,
                        scrollTop: newScrollTop,
                    });
                }

                scrollableElement.scrollTo({
                    top: newScrollTop,
                    behavior: isAnimated ? "smooth" : "instant",
                });

                if (!isAnimated) {
                    flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                }
            };

            const anchorPosition = getAnchorPosition(oldVisibleRect);
            if (!anchorPosition) {
                fallbackScroll();
                return;
            }

            const wasVisible = areRangesOverlapping(
                oldVisibleRect.top,
                oldVisibleRect.bottom,
                anchorPosition.top,
                anchorPosition.top + anchorPosition.height,
            );

            // If the anchor wasn't previously visible scrolling then scrolling by the
            // keyboard and bottom bar delta won't make it visible now.
            if (!wasVisible) {
                fallbackScroll();
                return;
            }

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
                if (isCompletelyVisible) {
                    fallbackScroll();
                    return;
                }

                const isPartiallyHidden = areRangesOverlapping(
                    anchorPosition.top,
                    anchorPosition.top + anchorPosition.height,
                    newVisibleRect.bottom,
                    Infinity,
                );

                // If our scroll anchor won't be partially hidden by the visible rect changing
                // then don't scroll.
                //
                // A test case: Tap on a `<TaskDateInput>` near the top of the task personal
                // view. Trying to adjust the scroll will cancel out the animated scroll
                // `<TaskDateInput>` starts since this hook tries to make a minor adjustment.
                if (!isPartiallyHidden) {
                    fallbackScroll();
                    return;
                }
            }

            const anchorPositionBottom = anchorPosition.top + anchorPosition.height;
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
            const anchorPositionYRatio = clamp(
                0,
                (anchorPositionMiddle - constrainedOldVisibleRect.top) /
                    (constrainedOldVisibleRect.bottom - constrainedOldVisibleRect.top),
                1,
            );

            // Round so roughly:
            //
            // - `[0, 1/3)` is `0`
            // - `[1/3, 2/3)` is `0.5`
            // - `[2/3, 1]` is `1`
            //
            // Consistent ratios help us scroll consistent amounts for the same element.
            const anchorPositionYRatioRounded =
                Math.floor((Math.ceil(anchorPositionYRatio * 3) / 3) * 2) / 2;

            const anchorPositionY =
                anchorPosition.top + anchorPosition.height * anchorPositionYRatioRounded;

            const anchorPositionYPercent =
                (anchorPositionY - oldVisibleRect.top) /
                (oldVisibleRect.bottom - oldVisibleRect.top);

            const newAnchorPositionY =
                newVisibleRect.top +
                (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionYPercent;

            // Rounding gives us consistent scroll deltas as the keyboard opens and closes.
            let scrollDelta = Math.round(anchorPositionY - newAnchorPositionY);

            const spacing1Px = convertRemLengthToPx("1", spacingScale);

            // If this `scrollDelta` would put the top of our anchor outside the visible rect
            // (into navigation bar space) then set the `scrollDelta` so our anchor is just
            // below the visible rect's top.
            //
            // We don't allow scrolling more than if `anchorPositionYPercent` had been 1.
            //
            // NOTE(calebmer): Added this to make sure `<TaskDateInput>`s calendar is
            // consistently kept onscreen when the keyboard opens. Previously this scroll
            // would push it offscreen.
            if (anchorPosition.top - scrollDelta < newVisibleRect.top + spacing1Px) {
                const minScrollDelta = Math.round(
                    anchorPositionY -
                        (newVisibleRect.top + (newVisibleRect.bottom - newVisibleRect.top)),
                );

                scrollDelta = Math.max(
                    minScrollDelta,
                    anchorPosition.top - (newVisibleRect.top + spacing1Px),
                );
            }

            // Make sure if the bottom of the anchor is offscreen, we scroll enough to
            // bring it into the new visible rect. Even if our original layout calculation
            // undershoots a little. This may happen with large anchors (e.g. task date
            // inputs which include the height of their calendar overlay).
            //
            // NOTE(calebmer): We only apply this scroll delta constraint if the keyboard
            // height changes. Since the bottom bar frame may change right before the
            // keyboard opens (since we mount a keyboard toolbar) I found this logic was
            // causing weirdness when double applied. This whole condition doesn't seem
            // particularly principled.
            if (
                oldMobileKeyboardHeight !== newMobileKeyboardHeight &&
                anchorPositionBottom > newVisibleRect.bottom &&
                // NOTE(calebmer): We don't want to apply this adjustment when anchoring
                // `{top: oldVisibleRect.bottom, height: 0}` (since `anchorPositionBottom`
                // will always be greater than `newVisibleRect.bottom`!). So only apply this
                // adjustment when there's some visible area to scroll to.
                //
                // Again, this whole condition isn't particularly principled. We should review
                // cases where this condition is helpful and maybe require explicit opt-in with
                // a flag.
                anchorPosition.height > 0
            ) {
                scrollDelta = Math.max(
                    scrollDelta,
                    Math.round(anchorPositionBottom - newVisibleRect.bottom + spacing1Px),
                );
            }

            // If our visible rect is growing then we need to make sure we scroll at least
            // the same number of pixels as it took to grow the visible rect. Otherwise, if
            // we're at the bottom of the scroll view we may not scroll the entire newly
            // visible safe area offscreen.
            //
            // To test this, play with entering edit mode or reply mode for
            // `<MessageView>`s near the bottom of the screen. (The second to last message
            // not the last message.)
            const minScrollDelta =
                newVisibleRect.bottom > oldVisibleRect.bottom
                    ? Math.max(0, newVisibleRect.bottom - oldVisibleRect.bottom - scrollBottom)
                    : null;
            if (minScrollDelta !== null) scrollDelta = Math.min(-minScrollDelta, scrollDelta);

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
                const oldBottomBarKeyboardToolbarHeight =
                    oldMobileKeyboardHeight > 0
                        ? oldBottomBarHeight.visibleMobileKeyboard -
                          oldBottomBarHeight.hiddenMobileKeyboard
                        : 0;

                const newBottomBarKeyboardToolbarHeight =
                    newMobileKeyboardHeight > 0
                        ? newBottomBarHeight.visibleMobileKeyboard -
                          newBottomBarHeight.hiddenMobileKeyboard
                        : 0;

                // If some `--safe-area-inset-bottom` was removed then the browser will
                // automatically adjust scroll according to the removed safe area. Ideally we'd
                // be able to compare old safe area to new safe area (like we compare
                // scrollable rects) instead we're making an assumption to guess the safe
                // area difference in some cases.
                //
                // We assume that the keyboard toolbar height corresponds to safe area added to
                // the view. When a keyboard toolbar is visible, there's some safe area and
                // when it's hidden the safe area is removed.
                //
                // This fixes a bug in a mobile web chat view in Safari. Try opening a chat
                // with many messages, scrolling to the bottom, focusing the message input then
                // hitting "Done" in Safari's UI to close the message input. If this is 0 then
                // the scroll will cover some content we expected to be uncovered. [Video of
                // the bug being fixed][1].
                //
                // [1]: https://gist.github.com/calebmer/2d38b89fe933a69071f638bc349f4606
                const bottomBarKeyboardToolbarHeightDifference = Math.max(
                    0,
                    oldBottomBarKeyboardToolbarHeight - newBottomBarKeyboardToolbarHeight,
                );

                scrollDelta +=
                    currentScrollableRect.height -
                    lastScrollableRect.height +
                    bottomBarKeyboardToolbarHeightDifference;

                // NOTE(calebmer, #mobile-webkit-weirdness): So mobile WebKit doesn't do the
                // automatic scroll adjustment until the user or JavaScript initiates a scroll.
                // So if our scroll delta is 0 (well between -1 and 1 to support fractions like
                // 0.5) then move our scroll just a smidge so WebKit automatic scroll
                // adjustment kicks in. This seems to work fine on desktop WebKit.
                //
                // To test this, open the keyboard in a chat at the end of messages. Hit
                // return so the message input grows then hit delete so it shrinks back.
                //
                // We use this same trick in `useScrollToNewMessages()`.
                if (isMobileWebKit && -1 < scrollDelta && scrollDelta < 1) {
                    scrollDelta = -0.1;
                }
            }

            // NOTE(calebmer, 2024-03-18): This `recoveringScrollDelta` business isn't the
            // most principled. I imagine it will need adapting over time. I added it for
            // the swipe to reply to message interaction. Specifically when swiping the
            // last message in the view (which has some safe area margin bottom).
            //
            // When swiping the last message in the view, the bottom bar frame change
            // creates a scroll that pushes down the tab bar (since it scrolls up) so
            // `tabBarHeightAfterScroll !== tabBarHeight` meaning we end up scrolling a
            // smaller `scrollDelta` than we would have if the keyboard was open. But the
            // keyboard then opens immediately afterwards! So in this case we want to apply
            // the scroll delta difference from our previous scroll to our keyboard opening
            // scroll to ultimately land the anchor in the right place.
            let recoveringScrollDelta = null;
            if (
                recoverableScrollDelta &&
                newMobileKeyboardHeight > navigationBarHeight &&
                Date.now() - recoverableScrollDelta.time < perceivedAsInstantLimitMs
            ) {
                scrollDelta += recoverableScrollDelta.scrollDeltaDifference;
                recoveringScrollDelta = recoverableScrollDelta;
                recoverableScrollDelta = null;
            }

            const originalScrollDelta = scrollDelta;

            // If our scroll will cause the tab bar to fully hide or fully reveal then
            // compute a new scroll delta considering the tab bar's new state.
            const tabBarHeightAfterScroll =
                NativeMobileBridge && !NativeMobileBridge.tabBar.isHidden()
                    ? // If we have a bottom bar that's visible even when the keyboard is closed, the
                      // tab bar is always open.
                      newBottomBarHeight.hiddenMobileKeyboard > 0
                        ? tabBarHeight
                        : // Otherwise, check if we scroll enough to reveal/hide the tab bar.
                        -scrollDelta >= navigationBarHeight
                        ? NativeMobileBridge.tabBar.height
                        : scrollDelta >= navigationBarHeight
                        ? 0
                        : tabBarHeight
                    : tabBarHeight;

            if (tabBarHeightAfterScroll === tabBarHeight) {
                if (scrollDelta === 0) return;

                const newScrollTop = scrollableElement.scrollTop + scrollDelta;

                // Prepare navigation bar scroll direction state for a smooth scroll animation
                // run by the native platform. For example, on mobile WebKit scroll events may
                // be sent to the web thread after a delay as scroll animation performance is
                // prioritized.
                //
                // Example of bug this fixes:
                // https://gist.github.com/calebmer/91334a35af1e9ee8043bea5e1c105728
                if (isAnimated) {
                    dispatchNavigationBarPrepareSmoothScrollToEventEmitter.emit({
                        element: scrollableElement,
                        scrollTop: newScrollTop,
                    });
                }

                scrollableElement.scrollTo({
                    top: newScrollTop,
                    behavior: isAnimated ? "smooth" : "instant",
                });

                if (!isAnimated) {
                    flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                }

                const maxScrollTop =
                    scrollableElement.scrollHeight - scrollableElement.clientHeight;

                // If we can't scroll to `newScrollTop` because there's not enough scroll
                // height, then `scheduleMicrotask()` and try again. Since we need the scroll
                // to happen this paint we can't call `requestAnimationFrame()`. This happens
                // on desktop when a `<PostCommentInput>` at the end of a fully scrolled
                // `<PostListView>` resizes while you're typing in it (when there are multiple
                // posts). When the `<PostCommentInput>` resizes, it emits a bottom bar size
                // change event and re-renders `<VirtualizedScrollView>` with the new height.
                // We need to wait for the scroll view to grow after that
                // `<VirtualizedScrollView>` re-render to be able to scroll.
                //
                // [Video of the bug this fixes][1].
                //
                // [1]: https://gist.github.com/calebmer/6fb261ff2288c0c9734968a1256b01b2
                if (!isAnimated && newScrollTop > maxScrollTop) {
                    scheduleMicrotask(() => {
                        scrollableElement.scrollTo({
                            top: newScrollTop,
                            behavior: "instant",
                        });

                        if (!isAnimated) {
                            flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                        }
                    });
                }
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
                    top: originalNewVisibleRect.top,
                    bottom: Math.min(newScrollableBottom, newCoveredBottom),
                };

                const newAnchorPositionY =
                    newVisibleRect.top +
                    (newVisibleRect.bottom - newVisibleRect.top) * anchorPositionYPercent;

                // Rounding gives us consistent scroll deltas as the keyboard opens and closes.
                let scrollDelta = Math.round(anchorPositionY - newAnchorPositionY);

                if (anchorPosition.top - scrollDelta < newVisibleRect.top + spacing1Px) {
                    const minScrollDelta = Math.round(
                        anchorPositionY -
                            (newVisibleRect.top + (newVisibleRect.bottom - newVisibleRect.top)),
                    );

                    scrollDelta = Math.max(
                        minScrollDelta,
                        anchorPosition.top - (newVisibleRect.top + spacing1Px),
                    );
                }

                if (
                    oldMobileKeyboardHeight !== newMobileKeyboardHeight &&
                    anchorPositionBottom > newVisibleRect.bottom &&
                    anchorPosition.height > 0
                ) {
                    scrollDelta = Math.max(
                        scrollDelta,
                        Math.round(anchorPositionBottom - newVisibleRect.bottom + spacing1Px),
                    );
                }

                const minScrollDelta =
                    newVisibleRect.bottom > oldVisibleRect.bottom
                        ? Math.max(0, newVisibleRect.bottom - oldVisibleRect.bottom - scrollBottom)
                        : null;
                if (minScrollDelta !== null) scrollDelta = Math.min(-minScrollDelta, scrollDelta);

                if (recoveringScrollDelta) {
                    scrollDelta += recoveringScrollDelta.scrollDeltaDifference;
                }

                if (scrollDelta === 0) return;

                const newScrollTop = scrollableElement.scrollTop + scrollDelta;

                // Prepare navigation bar scroll direction state for a smooth scroll animation
                // run by the native platform. For example, on mobile WebKit scroll events may
                // be sent to the web thread after a delay as scroll animation performance is
                // prioritized.
                //
                // Example of bug this fixes:
                // https://gist.github.com/calebmer/91334a35af1e9ee8043bea5e1c105728
                if (isAnimated) {
                    dispatchNavigationBarPrepareSmoothScrollToEventEmitter.emit({
                        element: scrollableElement,
                        scrollTop: newScrollTop,
                    });
                }

                scrollableElement.scrollTo({
                    top: newScrollTop,
                    behavior: isAnimated ? "smooth" : "instant",
                });

                if (!isAnimated) {
                    flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                }

                if (scrollDelta < originalScrollDelta) {
                    recoverableScrollDelta = {
                        time: Date.now(),
                        scrollDeltaDifference: originalScrollDelta - scrollDelta,
                    };
                }
            }
        };

        const unsubscribe1 = subscribeToMobileKeyboardFrameChange(
            ({oldKeyboardHeight, newKeyboardHeight, shouldScroll, isAnimated}) => {
                if (!shouldScroll) return;

                // Sometimes, native dispatches a noop keyboard frame change.
                if (oldKeyboardHeight === newKeyboardHeight) return;

                const currentBottomBarHeight = getCurrentBottomBarHeight();

                scroll({
                    isAnimated,
                    oldMobileKeyboardHeight: oldKeyboardHeight,
                    newMobileKeyboardHeight: newKeyboardHeight,
                    oldBottomBarHeight: currentBottomBarHeight,
                    newBottomBarHeight: currentBottomBarHeight,
                    wasBottomBarMounted: false,
                    wasBottomBarUnmounted: false,
                });
            },
        );

        const unsubscribe2 = subscribeToBottomBarFrameChange(
            ({
                oldBottomBarHeight,
                newBottomBarHeight,
                wasBottomBarMounted,
                wasBottomBarUnmounted,
            }) => {
                scroll({
                    isAnimated: false,
                    oldMobileKeyboardHeight: currentMobileKeyboardHeight,
                    newMobileKeyboardHeight: currentMobileKeyboardHeight,
                    oldBottomBarHeight,
                    newBottomBarHeight,
                    wasBottomBarMounted,
                    wasBottomBarUnmounted,
                });
            },
        );

        return () => {
            removeResizeListenerForElement(scrollableElement, handleResize);
            scrollableElement.removeEventListener("scroll", handleScroll);
            unsubscribe1();
            unsubscribe2();
        };
    }, [
        getAnchorPosition,
        getCurrentBottomBarHeight,
        isDisabled,
        isInert,
        isPinned,
        routeLayout,
        scrollableInsetBottom,
        scrollableRef,
        subscribeToBottomBarFrameChange,
    ]);

    return {
        getVisibleRect: useCallback(() => {
            const viewportHeight = document.documentElement.getBoundingClientRect().height;

            const scrollable = assertExists(scrollableRef.current);
            const scrollableElement: HTMLElement =
                "getElement" in scrollable ? scrollable.getElement() : scrollable;

            const spacingScale = getSpacingScaleWithoutListening();
            const navigationBarHeight = navigationBarHeightRem * remPxBySpacingScale[spacingScale];

            const currentScrollableRect = scrollableElement.getBoundingClientRect();
            const currentBottomBarHeight = getCurrentBottomBarHeight();

            const {top: currentScrollableTop, bottom: currentOriginalScrollableBottom} =
                currentScrollableRect;

            const scrollableInsetBottomPx =
                typeof scrollableInsetBottom === "string"
                    ? convertRemLengthToPx(scrollableInsetBottom, spacingScale)
                    : scrollableInsetBottom;

            const currentScrollableBottom =
                currentOriginalScrollableBottom - scrollableInsetBottomPx;

            const windowSafeAreaInsetBottom = getElementWindowSafeAreaInsetBottomPx(
                document.documentElement,
            );

            const safeAreaInsetTop = getElementSafeAreaInsetTopPx(document.documentElement);
            const tabBarHeight =
                NativeMobileBridge && !NativeMobileBridge.tabBar.isHidden()
                    ? Math.max(
                          0,
                          NativeMobileBridge.tabBar.height -
                              NativeMobileBridge.tabBar.getDeferredScrollOffset(),
                      )
                    : 0;

            // Considers:
            //
            // - Keyboard height
            // - Bottom bar height
            // - Safe area height
            // - Tab bar height
            const currentCoveredHeight =
                Math.max(currentMobileKeyboardHeight, windowSafeAreaInsetBottom + tabBarHeight) +
                currentBottomBarHeight[
                    currentMobileKeyboardHeight > 0
                        ? "visibleMobileKeyboard"
                        : "hiddenMobileKeyboard"
                ];

            const currentCoveredBottom = viewportHeight - currentCoveredHeight;

            return {
                top: Math.min(
                    Math.max(currentScrollableTop, safeAreaInsetTop + navigationBarHeight),
                    currentCoveredBottom,
                ),
                bottom: Math.min(currentScrollableBottom, currentCoveredBottom),
            };
        }, [getCurrentBottomBarHeight, scrollableInsetBottom, scrollableRef]),
    };
}
