// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
//                                 IMPORTANT                                 //
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! //
//
// We implement navigation bars in web code but we implement tab bars in native
// code. Tab bars should respond to scroll interactions identically to
// navigation bars. That way they clearly look like they're a part of the
// same app.
//
// Any change to this file you must thoroughly test and port to native code.
// For iOS we implement the tab bar in `RootTabBarController.swift`.
//
// An implication of needing to implement identical behavior in web code and
// native code is you have to be careful about which events contribute to
// navigation bar behavior. We have consistent scroll events across web code
// and native code so we can use that. Touch events are more dicey.

import {AnimationPlaybackControls, animate} from "motion";
import {Memo, MutableRefObject, ReactNode, Ref, useImperativeHandle, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {Box} from "~/client/design/box.js";
import {MenuAction} from "~/client/design/menu.js";
import {
    navigationBarHeight,
    navigationBarHeightRem,
} from "~/client/design/navigation_bar_helpers.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {scrollbarVisibleAfterScrollDurationMs} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    NavigationBarContent,
    NavigationBarContentRef,
} from "~/client/navigation/navigation_bar_content.js";
import {
    NavigationBarRef,
    NavigationBarShareButtonProps,
} from "~/client/navigation/navigation_bar_types.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {
    getRemPxWithoutListening,
    getSpacingScaleWithoutListening,
} from "~/client/remix/spacing_scale_context.js";
import {navigationBarStyles, sprinkles} from "~/client/styles/styles.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {
    RemLength,
    Spacing,
    convertRemLengthToPx,
    isSpacing,
    parseRemLength,
    spacing,
} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * After the user has stopped scrolling then this timeout elapses, we will
 * fully show/hide the navigation bar if it's in a partially occluded state.
 *
 * Should be the same as `scrollbarVisibleAfterScrollDurationMs` so the
 * navigation bar and scrollbar animate to their static states at the
 * same time.
 */
// IMPORTANT: If you change this value, you must also change
// `navigationBarTransitionDebounceScrollTimeoutSeconds` in
// `NavigationBarConstants.swift`.
const navigationBarTransitionDebounceScrollTimeoutMs = 1200;

/**
 * When the user is done scrolling but the navigation bar is partially visible,
 * we need to make a decision to either fully show the navigation bar or fully
 * hide the navigation bar. If more than this height of the navigation bar is
 * visible then we show it, otherwise we hide it.
 */
const navigationBarVisibleHeightThresholdForReveal = "6";
const navigationBarVisibleHeightThresholdForRevealRem = parseRemLength(
    navigationBarVisibleHeightThresholdForReveal,
);

{
    // IMPORTANT: If you change this value, you must also change
    // `navigationBarVisibleHeightThresholdForReveal` in
    // `NavigationBarConstants.swift`.
    //
    // We have an assertion below to make sure this value always equals the
    // navigation bar's pixel height on mobile devices. After converting `Spacing`
    // to an actual value and applying the rem pixel count.
    const mobileNavigationBarVisibleHeightThresholdForReveal = 30;

    assert(
        mobileNavigationBarVisibleHeightThresholdForReveal ===
            navigationBarVisibleHeightThresholdForRevealRem * remPxBySpacingScale.large,
    );
}

/**
 * The speed (in pixels per second) at which the navigation bar hide/show
 * animation moves. The duration of the animation depends on how many pixels we
 * need to move the navigation bar.
 */
// IMPORTANT: If you change this value, you must also change
// `navigationBarRevealOrHideAnimationDurationSeconds` in
// `NavigationBarConstants.swift`.
const navigationBarRevealOrHideAnimationDurationMs = 200;

// Make sure if `scrollbarVisibleAfterScrollDurationMs` changes,
// `navigationBarTransitionDebounceScrollTimeoutMs` also changes. We don't assign
// the scrollbar duration directly to the navigation bar duration because we
// want to clearly document that when the navigation bar duration changes, we
// need to update native mobile code as well.
assert(navigationBarTransitionDebounceScrollTimeoutMs === scrollbarVisibleAfterScrollDurationMs);

type ScrollDirectionState = {
    readonly scrollDirection: "Up" | "Down";
    readonly navigationBarTopOffset: number;
    readonly animateNavigationBar: {
        readonly translateY: number;
        readonly isTitleVisible: boolean;
        readonly lastIsTitleVisible: boolean;
    } | null;
};

const initialScrollDirectionState: ScrollDirectionState = {
    scrollDirection: "Down",
    navigationBarTopOffset: 0,
    animateNavigationBar: null,
};

export function NavigationBar({
    handleRef,
    navigationBarRef: externalNavigationBarRef,
    withScrollAway,
    title,
    getTitleBoundaryElement,
    titleBoundaryMarginTop,
    withoutDisappearingTitle,
    subtitle,
    menuActions,
    menuOffset,
    contextMenuActions,
    shareButton,
    withWideRouteLayoutShareMenuItem,
    replaceActions,
    titleJustifyContent,
    desktopControls,
    desktopMaxWidth: desktopMaxWidthProp,
    desktopTitleMaxWidth: desktopTitleMaxWidthProp,
    desktopTitleMaxWidthCenterOffset,
    desktopTitleFontSize,
    desktopTitleFontWeight,
    desktopTitleLeftSlop,
    desktopAdditionalActions,
    withoutMobileBackButton,
    contentCover,
    onMobileClose,
    onMobileCancel,
}: {
    handleRef: MutableRefObject<{
        initialize: (element: HTMLElement) => void;
        onScroll: (element: HTMLElement) => void;
        onResize: (element: HTMLElement) => void;
        onPrepareSmoothScrollTo: (element: HTMLElement, scrollTop: number) => void;
    } | null>;
    navigationBarRef: Ref<NavigationBarRef> | undefined;
    withScrollAway: boolean;
    title: ReactNode;
    getTitleBoundaryElement: Memo<() => HTMLElement> | undefined;
    titleBoundaryMarginTop: Spacing | RemLength | undefined;
    withoutDisappearingTitle: boolean;
    subtitle: ReactNode | undefined;
    menuActions: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
    menuOffset: Spacing | undefined;
    contextMenuActions: ReadonlyArray<ReadonlyArray<MenuAction>>;
    shareButton: NavigationBarShareButtonProps | undefined;
    withWideRouteLayoutShareMenuItem: boolean;
    replaceActions: ReactNode;
    titleJustifyContent: "center" | "flex-start" | undefined;
    desktopControls: ReactNode;
    desktopMaxWidth: Spacing | RemLength | undefined;
    desktopTitleMaxWidth: Spacing | RemLength | undefined;
    desktopTitleMaxWidthCenterOffset: Spacing | RemLength | undefined;
    desktopTitleFontSize: FontSize;
    desktopTitleFontWeight: "semi-bold" | "bold";
    desktopAdditionalActions: ReactNode;
    desktopTitleLeftSlop: Spacing | undefined;
    withoutMobileBackButton: boolean;
    contentCover: ReactNode | undefined;
    onMobileClose: (() => void) | undefined;
    onMobileCancel: (() => void) | undefined;
}) {
    const platform = usePlatform();

    const [scrollViewSize, setScrollViewSize] = useState<{height: number; width: number} | null>(
        null,
    );

    const navigationBarContainerRef = useRef<HTMLDivElement>(null);
    const navigationBarRef = useRef<HTMLDivElement>(null);
    const navigationBarBackgroundRef = useRef<HTMLDivElement>(null);
    const navigationBarContentCoverRef = useRef<HTMLDivElement>(null);
    const navigationBarContentRef = useRef<NavigationBarContentRef>(null);

    const [scrollDirectionStateFromState, setScrollDirectionState] = useState<ScrollDirectionState>(
        initialScrollDirectionState,
    );

    let scrollDirectionState = scrollDirectionStateFromState;
    if (
        !withScrollAway &&
        (scrollDirectionState.scrollDirection !== initialScrollDirectionState.scrollDirection ||
            scrollDirectionState.navigationBarTopOffset !==
                initialScrollDirectionState.navigationBarTopOffset ||
            scrollDirectionState.animateNavigationBar !== null)
    ) {
        scrollDirectionState = initialScrollDirectionState;
        setScrollDirectionState(scrollDirectionState);
    }

    const lastScrollOffsetRef = useRef(0);
    const lastClientHeightRef = useRef(0);
    const lastScrollHeightRef = useRef(0);
    const lastScrollDirectionRef = useRef(scrollDirectionState.scrollDirection);
    const lastNavigationBarTopOffsetRef = useRef(scrollDirectionState.navigationBarTopOffset);
    const lastIsNavigationBarTitleVisibleRef = useRef<boolean | null>(null);

    useImperativeHandle(
        externalNavigationBarRef,
        () => ({
            getVisibleHeight: () => {
                const navigationBarElement = assertExists(navigationBarRef.current);

                const remPx = getRemPxWithoutListening();
                const navigationBarHeight = navigationBarHeightRem * remPx;

                const lastNavigationBarScrollOffset = Math.max(
                    0,
                    Math.min(
                        lastScrollOffsetRef.current - lastNavigationBarTopOffsetRef.current,
                        navigationBarHeight,
                    ),
                );

                return (
                    navigationBarHeight -
                    lastNavigationBarScrollOffset +
                    getElementSafeAreaInsetTopPx(navigationBarElement)
                );
            },
            getMaxVisibleHeight: () => {
                const navigationBarElement = assertExists(navigationBarRef.current);

                const remPx = getRemPxWithoutListening();
                const navigationBarHeight = navigationBarHeightRem * remPx;

                return navigationBarHeight + getElementSafeAreaInsetTopPx(navigationBarElement);
            },
        }),
        [],
    );

    const animationControlsRef = useRef<Set<AnimationPlaybackControls> | null>(null);

    useImperativeHandle(
        handleRef,
        () => {
            let navigationBarContainerElement: HTMLDivElement | undefined;
            let navigationBarBackgroundElement: HTMLDivElement | undefined;
            let navigationBarContent: NavigationBarContentRef | undefined;
            let navigationBarContentElement: HTMLElement | undefined;
            let navigationBarTitleElement: HTMLElement | undefined;
            let safeAreaInsetTopPx: number | undefined;

            let scrollDebounceTimeout: Timeout | null = null;

            const getTitleBoundaryOffset = (
                spacingScale: SpacingScale,
                element: HTMLElement,
            ): number | null => {
                navigationBarBackgroundElement ??= assertExists(navigationBarBackgroundRef.current);
                navigationBarContent ??= assertExists(navigationBarContentRef.current);
                navigationBarContentElement ??= navigationBarContent.getElement();
                safeAreaInsetTopPx ??= getElementSafeAreaInsetTopPx(navigationBarContentElement);

                if (withoutDisappearingTitle) return null;
                if (getTitleBoundaryElement === undefined) return null;

                let titleBoundaryParentElement = getTitleBoundaryElement();

                let titleBoundaryOffset =
                    Math.max(
                        titleBoundaryParentElement.offsetTop,
                        getElementSafeAreaInsetTopPx(titleBoundaryParentElement),
                    ) +
                    (titleBoundaryMarginTop
                        ? convertRemLengthToPx(titleBoundaryMarginTop, spacingScale)
                        : 0);
                while (
                    titleBoundaryParentElement.offsetParent instanceof HTMLElement &&
                    titleBoundaryParentElement.offsetParent !== element
                ) {
                    titleBoundaryParentElement = titleBoundaryParentElement.offsetParent;
                    titleBoundaryOffset += titleBoundaryParentElement.offsetTop;
                }

                // If the title boundary element is not in our scroll view then consider our
                // boundary offset to be unset.
                if (titleBoundaryParentElement.offsetParent !== element) return null;

                // If our scroll view has safe area then don't include the safe area in the
                // scroll offset. The scroll offset starts below our safe area.
                titleBoundaryOffset -= safeAreaInsetTopPx;

                return titleBoundaryOffset;
            };

            const initialize = (element: HTMLElement) => {
                navigationBarBackgroundElement ??= assertExists(navigationBarBackgroundRef.current);
                navigationBarContent ??= assertExists(navigationBarContentRef.current);
                navigationBarContentElement ??= navigationBarContent.getElement();
                navigationBarTitleElement ??= navigationBarContent.getTitleElement();
                safeAreaInsetTopPx ??= getElementSafeAreaInsetTopPx(navigationBarContentElement);

                // Immediately finish any animations when scrolling begins.
                if (animationControlsRef.current) {
                    const animationControls = animationControlsRef.current;
                    animationControlsRef.current = null;

                    for (const animationControl of animationControls) {
                        animationControl.complete();
                    }
                }

                scrollDebounceTimeout?.clear();
                scrollDebounceTimeout = null;

                const spacingScale = getSpacingScaleWithoutListening();
                const remPx = remPxBySpacingScale[spacingScale];
                const navigationBarHeight = navigationBarHeightRem * remPx;

                const scrollOffset = Math.max(0, element.scrollTop);

                const lastScrollDirection = lastScrollDirectionRef.current;
                const lastNavigationBarTopOffset = lastNavigationBarTopOffsetRef.current;
                const lastIsNavigationBarTitleVisible = lastIsNavigationBarTitleVisibleRef.current;

                lastScrollOffsetRef.current = scrollOffset;
                lastClientHeightRef.current = element.clientHeight;
                lastScrollHeightRef.current = element.scrollHeight;
                // Initialize scroll direction to `Up` if the scroll view has initially
                // scrolled since we've observed some janky when immediately scrolling up after
                // initialization.
                const scrollDirection = (lastScrollDirectionRef.current =
                    withScrollAway && scrollOffset > navigationBarHeight ? "Up" : "Down");
                const navigationBarTopOffset = (lastNavigationBarTopOffsetRef.current =
                    withScrollAway ? scrollOffset : 0);

                const navigationBarScrollOffset = !withScrollAway
                    ? 0
                    : clamp(0, scrollOffset - navigationBarTopOffset, navigationBarHeight);

                const titleBoundaryOffset = getTitleBoundaryOffset(spacingScale, element);

                const isNavigationBarTitleVisible =
                    withoutDisappearingTitle ||
                    titleBoundaryOffset === null ||
                    scrollOffset >= titleBoundaryOffset - navigationBarHeight;
                lastIsNavigationBarTitleVisibleRef.current = isNavigationBarTitleVisible;

                if (
                    lastScrollDirection !== scrollDirection ||
                    lastNavigationBarTopOffset !== navigationBarTopOffset
                ) {
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset,
                            animateNavigationBar: null,
                        });
                    });
                }

                if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                    navigationBarTitleElement.style.opacity = isNavigationBarTitleVisible
                        ? "1"
                        : "0";
                    navigationBarTitleElement.style.pointerEvents = isNavigationBarTitleVisible
                        ? "auto"
                        : "none";

                    if (lastIsNavigationBarTitleVisible !== null) {
                        if (isNavigationBarTitleVisible) {
                            navigationBarTitleElement.classList.remove(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.add(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        } else {
                            navigationBarTitleElement.classList.add(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.remove(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        }
                    }
                }

                const isNavigationBarBackgroundVisible =
                    scrollOffset - navigationBarScrollOffset >= 1 && isNavigationBarTitleVisible;

                navigationBarBackgroundElement.style.display = isNavigationBarBackgroundVisible
                    ? "block"
                    : "none";
            };

            const onResize = (element: HTMLElement) => {
                const newScrollViewSize = {
                    height: element.offsetHeight,
                    width: element.offsetWidth,
                };
                setScrollViewSize(scrollViewSize => {
                    return newScrollViewSize.height !== scrollViewSize?.height ||
                        newScrollViewSize.width !== scrollViewSize.width
                        ? newScrollViewSize
                        : scrollViewSize;
                });
            };

            const onScroll = (element: HTMLElement) => {
                navigationBarContainerElement ??= assertExists(navigationBarContainerRef.current);
                navigationBarBackgroundElement ??= assertExists(navigationBarBackgroundRef.current);
                navigationBarContent ??= assertExists(navigationBarContentRef.current);
                navigationBarContentElement ??= navigationBarContent.getElement();
                navigationBarTitleElement ??= navigationBarContent.getTitleElement();
                safeAreaInsetTopPx ??= getElementSafeAreaInsetTopPx(navigationBarContentElement);

                const doesNavigationBarHaveSafeAreaInsetTop = safeAreaInsetTopPx > 0;

                // Web code only: I've observed in mobile Safari if focus changes because the
                // focused element was removed from the DOM a `focusout` event is not
                // dispatched. So we manually check on scroll events if the focused element is
                // still in the DOM.
                //
                // We check on scroll events since the main reason a focused element would
                // unmount is a `<VirtualizedScrollView>` scrolls the element out of the
                // virtualization window.
                navigationBarContent.reconcileFocusedTextInputIfMobile();

                // Clamp scroll offset so it's not affected by overscroll at the top of the
                // scroll view. Overscroll at the bottom of the scroll view is desired! We want
                // the top bar (which should be collapsed) to continue with the scroll window
                // when at the bottom of the view.
                //
                // This also creates a neat effect where when the overscroll bounces back the
                // navigation bar is revealed. If the user is at the end of the scroll view
                // they probably need the navigation bar to navigate out.
                const scrollOffset = Math.max(0, element.scrollTop);

                // Sometimes native code sends us a scroll event twice for the same scroll
                // offset. Since scroll offsets may not be integers (e.g. 574.3333) this may be
                // the fractional part changing but when rounded there's no change. Whatever
                // the reason, ignore scroll events that repeat a scroll offset.
                if (scrollOffset === lastScrollOffsetRef.current) return;

                const {scrollHeight, clientHeight, scrollTop} = element;

                // Immediately finish any animations when scrolling begins.
                if (animationControlsRef.current) {
                    const animationControls = animationControlsRef.current;
                    animationControlsRef.current = null;

                    for (const animationControl of animationControls) {
                        animationControl.complete();
                    }
                }

                const spacingScale = getSpacingScaleWithoutListening();
                const remPx = remPxBySpacingScale[spacingScale];
                const navigationBarHeight = navigationBarHeightRem * remPx;

                const lastScrollOffset = lastScrollOffsetRef.current;
                lastScrollOffsetRef.current = scrollOffset;

                const lastClientHeight = lastClientHeightRef.current;
                lastClientHeightRef.current = clientHeight;

                const lastScrollHeight = lastScrollHeightRef.current;
                lastScrollHeightRef.current = scrollHeight;

                // Since we duplicate the cover onto the nav bar, make sure it scrolls
                // the same distance as the scroll view.
                if (navigationBarContentCoverRef.current) {
                    navigationBarContentCoverRef.current.style.transform = `translateY(${-scrollTop}px)`;
                }

                // - Edge case 1: If our scroll content resized and scrolled down at the same
                //   time (and scrolled the same amount we resized) then we don't want our
                //   navigation bar's scroll offset to change.
                //
                //   This happens when the typing indicator appears then disappears. Try going
                //   to a chat then typing in another tab to show the typing indicator, wait
                //   for it to disappear, then type again. Do this a couple times. When the
                //   typing indicator appears the view scrolls down to show it. We don't want
                //   that scroll down to hide our tab bar.
                //
                // - Edge case 2: If our scroll view resized and scrolled at the same time
                //   (and scrolled the same amount we resized) then we don't want our
                //   navigation bar's scroll offset to change.
                //
                //   This happens when you're typing in the message input and there's a
                //   navigation bar. When the message input grows we want the navigation bar to
                //   stay as it is instead of jumping around.
                //
                // Ideally this logic would run only after a resize and before the resize
                // paints to the screen, but web code doesn't have a good way to listen for
                // scroll view content resize. (Whereas in iOS native code we can use KVO to
                // listen to `contentSize` on `UIScrollView`.)
                if (
                    // Edge case 1
                    (scrollHeight > lastScrollHeight &&
                        scrollOffset > lastScrollOffset &&
                        scrollOffset - lastScrollOffset <= scrollHeight - lastScrollHeight) ||
                    // Edge case 2
                    (clientHeight < lastClientHeight &&
                        scrollOffset > lastScrollOffset &&
                        scrollOffset - lastScrollOffset <= lastClientHeight - clientHeight) ||
                    (clientHeight > lastClientHeight &&
                        scrollOffset < lastScrollOffset &&
                        lastScrollOffset - scrollOffset <= clientHeight - lastClientHeight)
                ) {
                    // Also perform the scroll direction change here.
                    //
                    // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                    const scrollDirection =
                        !withScrollAway || scrollOffset > lastScrollOffset ? "Down" : "Up";
                    lastScrollDirectionRef.current = scrollDirection;

                    // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                    const lastNavigationBarScrollOffset = !withScrollAway
                        ? 0
                        : clamp(
                              0,
                              lastScrollOffset - lastNavigationBarTopOffsetRef.current,
                              navigationBarHeight,
                          );

                    // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                    const navigationBarTopOffset = !withScrollAway
                        ? 0
                        : scrollOffset - lastNavigationBarScrollOffset;
                    lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                    // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                    const navigationBarScrollOffset = !withScrollAway
                        ? 0
                        : clamp(0, scrollOffset - navigationBarTopOffset, navigationBarHeight);

                    const lastIsNavigationBarTitleVisible =
                        lastIsNavigationBarTitleVisibleRef.current;

                    const titleBoundaryOffset = getTitleBoundaryOffset(spacingScale, element);

                    const isNavigationBarTitleVisible =
                        withoutDisappearingTitle ||
                        titleBoundaryOffset === null ||
                        scrollOffset >= titleBoundaryOffset - navigationBarHeight;

                    lastIsNavigationBarTitleVisibleRef.current = isNavigationBarTitleVisible;

                    // Immediately update our sticky positioning CSS to avoid potential jankiness.
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset: Math.max(0, navigationBarTopOffset),
                            animateNavigationBar: null,
                        });
                    });

                    if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                        navigationBarTitleElement.style.opacity = isNavigationBarTitleVisible
                            ? "1"
                            : "0";
                        navigationBarTitleElement.style.pointerEvents = isNavigationBarTitleVisible
                            ? "auto"
                            : "none";

                        if (isNavigationBarTitleVisible) {
                            navigationBarTitleElement.classList.remove(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.add(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        } else {
                            navigationBarTitleElement.classList.add(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.remove(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        }
                    }

                    const lastIsNavigationBarBackgroundVisible =
                        lastScrollOffset - lastNavigationBarScrollOffset >= 1 &&
                        lastIsNavigationBarTitleVisible;
                    const isNavigationBarBackgroundVisible =
                        scrollOffset - navigationBarScrollOffset >= 1 &&
                        isNavigationBarTitleVisible;

                    if (lastIsNavigationBarBackgroundVisible !== isNavigationBarBackgroundVisible) {
                        navigationBarBackgroundElement.style.display =
                            isNavigationBarBackgroundVisible ? "block" : "none";
                    }
                }

                // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                const scrollDirection =
                    !withScrollAway || scrollOffset > lastScrollOffset ? "Down" : "Up";
                const lastScrollDirection = lastScrollDirectionRef.current;
                lastScrollDirectionRef.current = scrollDirection;

                const lastNavigationBarTopOffset = lastNavigationBarTopOffsetRef.current;
                let navigationBarTopOffset = lastNavigationBarTopOffset;

                // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                const lastNavigationBarScrollOffset = !withScrollAway
                    ? 0
                    : clamp(0, lastScrollOffset - lastNavigationBarTopOffset, navigationBarHeight);

                if (scrollDirection !== lastScrollDirection) {
                    // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                    navigationBarTopOffset = !withScrollAway
                        ? 0
                        : lastScrollOffset - lastNavigationBarScrollOffset;
                    lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                    // Immediately update our sticky positioning CSS to avoid potential jankiness.
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset: Math.max(0, navigationBarTopOffset),
                            animateNavigationBar: null,
                        });
                    });
                }

                // Web code only: Scroll away behavior is disabled when `!withScrollAway`.
                const navigationBarScrollOffset = !withScrollAway
                    ? 0
                    : clamp(0, scrollOffset - navigationBarTopOffset, navigationBarHeight);

                // The following is web code only: Change the opacity of the navigation bar's
                // title. The title is transparent at the top of the screen (unless
                // `withoutDisappearingTitle` is set).
                //
                // Additionally, if we have some safe area at the top of our screen then the
                // navigation bar content moves into the safe area. We need to decrease the
                // content opacity to zero so it doesn't conflict with operation system content
                // in the safe area.
                {
                    const lastIsNavigationBarTitleVisible =
                        lastIsNavigationBarTitleVisibleRef.current;

                    const titleBoundaryOffset = getTitleBoundaryOffset(spacingScale, element);

                    const isNavigationBarTitleVisible =
                        withoutDisappearingTitle ||
                        ((titleBoundaryOffset === null ||
                            scrollOffset >= titleBoundaryOffset - navigationBarHeight) &&
                            (!withScrollAway ||
                                navigationBarScrollOffset >= navigationBarHeight ||
                                lastIsNavigationBarTitleVisible));

                    lastIsNavigationBarTitleVisibleRef.current = isNavigationBarTitleVisible;

                    // If our navigation bar includes some safe area inset then as we scroll up we
                    // want to decrease the opacity of content in the navigation bar so it doesn't
                    // conflict with operating system content in the safe area.
                    if (
                        doesNavigationBarHaveSafeAreaInsetTop &&
                        navigationBarScrollOffset !== lastNavigationBarScrollOffset
                    ) {
                        const navigationBarScrollPercentage =
                            navigationBarScrollOffset / navigationBarHeight;

                        // NOTE(calebmer): I'm seeing some issues in mobile Safari when using
                        // `scrollTo({behavior: "smooth"})` which is an animation driven by iOS's UI
                        // thread and not the web thread. This causes some jankiness as JavaScript is
                        // behind native so opacity may not be updated in a timely manner.
                        //
                        // I'd love to move this opacity update to [CSS scroll-driven animations][1]
                        // when they're available in WebKit.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations
                        navigationBarContentElement.style.opacity = `${
                            1 - Math.min(1, navigationBarScrollPercentage * 2)
                        }`;
                    }

                    // Handle the transition from a visible navigation bar title to a hidden
                    // navigation bar title.
                    if (lastIsNavigationBarTitleVisible !== isNavigationBarTitleVisible) {
                        if (!isNavigationBarTitleVisible) {
                            navigationBarTitleElement.style.opacity = "0";
                            navigationBarTitleElement.style.pointerEvents = "none";

                            navigationBarTitleElement.classList.add(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.remove(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        } else {
                            navigationBarTitleElement.style.opacity = "1";
                            navigationBarTitleElement.style.pointerEvents = "auto";

                            navigationBarTitleElement.classList.remove(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement.classList.add(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        }
                    }

                    const lastIsNavigationBarBackgroundVisible =
                        lastScrollOffset - lastNavigationBarScrollOffset >= 1 &&
                        lastIsNavigationBarTitleVisible;
                    const isNavigationBarBackgroundVisible =
                        scrollOffset - navigationBarScrollOffset >= 1 &&
                        isNavigationBarTitleVisible;

                    if (lastIsNavigationBarBackgroundVisible !== isNavigationBarBackgroundVisible) {
                        navigationBarBackgroundElement.style.display =
                            isNavigationBarBackgroundVisible ? "block" : "none";
                    }
                }

                scrollDebounceTimeout?.clear();
                scrollDebounceTimeout = null;

                // We only need a timeout to run our reveal/hide animation if the navigation
                // bar:
                //
                // - Isn't completely scrolled in or completely scrolled out; OR
                // - Is completely scrolled to the bottom (native mobile app only)
                if (
                    navigationBarScrollOffset !== 0 &&
                    (navigationBarScrollOffset !== navigationBarHeight ||
                        (NativeMobileBridge && scrollOffset >= scrollHeight - clientHeight))
                ) {
                    scrollDebounceTimeout = createTimeout(() => {
                        // Precaution: Make sure native runs its timeout at the same time as we run ours
                        // so our animations are synced.
                        NativeMobileBridge?.navigationBar.runScrollDebounceTimeout();

                        const remPx = getRemPxWithoutListening();

                        // Assert is ok since this ref should be initialized by the `initialize()`
                        // function.
                        const lastIsNavigationBarTitleVisible = assertExists(
                            lastIsNavigationBarTitleVisibleRef.current,
                        );

                        // Reveal the navigation bar if:
                        //
                        // - We pass the visible height threshold; OR
                        // - We've completely scrolled to the bottom (native mobile app only)
                        //
                        // We always show the navigation bar at the bottom since we assume the user has
                        // completed reading the page and they're ready to take action. The only scroll
                        // action they could make is to scroll up which would reveal the tab bar. This
                        // also means, in our native mobile app, we're not showing extra safe area at
                        // the bottom of the page.
                        let nextNavigationBarTopOffset: number;
                        if (
                            navigationBarHeight - navigationBarScrollOffset >=
                                navigationBarVisibleHeightThresholdForRevealRem * remPx ||
                            scrollOffset >= scrollHeight - clientHeight
                        ) {
                            nextNavigationBarTopOffset = scrollOffset;
                        } else {
                            nextNavigationBarTopOffset = Math.max(
                                0,
                                scrollOffset - navigationBarHeight,
                            );
                        }

                        const titleBoundaryOffset = getTitleBoundaryOffset(spacingScale, element);

                        const nextIsNavigationBarTitleVisible =
                            withoutDisappearingTitle ||
                            titleBoundaryOffset === null ||
                            scrollOffset >= titleBoundaryOffset - navigationBarHeight;

                        const lastNavigationBarTopOffset =
                            scrollOffset >= scrollHeight - clientHeight
                                ? // If we're at the bottom of the screen, the last navigation bar top offset may
                                  // be many pixels above us (where the last scroll direction change happened).
                                  // This happens when you perfectly scroll to the end of the scroll view and
                                  // don't overscroll (hard to do with a finger gesture on iOS).
                                  //
                                  // We saw an issue here on iOS when `<DocumentContentEditor>` calls
                                  // `scrollTo()` when the keyboard opens scrolling to the bottom of the view.
                                  // The navigation bar animation appeared a little glitchy because it was
                                  // animating from a much higher position in the scroll view.
                                  Math.max(
                                      lastNavigationBarTopOffsetRef.current,
                                      scrollHeight - clientHeight - navigationBarHeight,
                                  )
                                : lastNavigationBarTopOffsetRef.current;

                        lastNavigationBarTopOffsetRef.current = nextNavigationBarTopOffset;
                        lastIsNavigationBarTitleVisibleRef.current =
                            nextIsNavigationBarTitleVisible;

                        // We'll animate the navigation bar title's opacity with `motion` in our effect
                        // after the state update but update these non-animatable properties
                        // immediately.
                        if (nextIsNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                            navigationBarTitleElement!.style.pointerEvents =
                                nextIsNavigationBarTitleVisible ? "auto" : "none";
                            navigationBarTitleElement!.classList.remove(
                                navigationBarStyles.titleFadeOutAnimationClassName,
                            );
                            if (!withScrollAway && !withoutDisappearingTitle) {
                                navigationBarTitleElement!.classList.add(
                                    navigationBarStyles.titleFadeInAnimationClassName,
                                );
                            }
                        }

                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset: Math.max(0, nextNavigationBarTopOffset),
                            animateNavigationBar: {
                                translateY: nextNavigationBarTopOffset - lastNavigationBarTopOffset,
                                isTitleVisible: nextIsNavigationBarTitleVisible,
                                lastIsTitleVisible: lastIsNavigationBarTitleVisible,
                            },
                        });
                    }, navigationBarTransitionDebounceScrollTimeoutMs);
                }
            };

            const onPrepareSmoothScrollTo = (element: HTMLElement, nextScrollOffset: number) => {
                const scrollOffset = lastScrollOffsetRef.current;
                const scrollDirection = nextScrollOffset > scrollOffset ? "Down" : "Up";

                // If the `scrollTo()` is going to scroll in a different direction than what we
                // currently have for `scrollDirection`, then update our state so that our
                // sticky positioning CSS is ready for the scroll.
                if (scrollDirection !== lastScrollDirectionRef.current) {
                    lastScrollDirectionRef.current = scrollDirection;

                    const remPx = getRemPxWithoutListening();
                    const navigationBarHeight = navigationBarHeightRem * remPx;

                    const lastNavigationBarTopOffset = lastNavigationBarTopOffsetRef.current;

                    const navigationBarScrollOffset = clamp(
                        0,
                        scrollOffset - lastNavigationBarTopOffset,
                        navigationBarHeight,
                    );

                    const navigationBarTopOffset = scrollOffset - navigationBarScrollOffset;
                    lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                    // Immediately update our sticky positioning CSS to avoid potential jankiness.
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset,
                            animateNavigationBar: null,
                        });
                    });
                }
            };

            return {
                initialize,
                onResize,
                onScroll,
                onPrepareSmoothScrollTo,
            };
        },
        [getTitleBoundaryElement, titleBoundaryMarginTop, withScrollAway, withoutDisappearingTitle],
    );

    const lastAnimatedScrollDirectionStateRef = useRef(scrollDirectionState);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastAnimatedScrollDirectionStateRef.current === scrollDirectionState) return;
        lastAnimatedScrollDirectionStateRef.current = scrollDirectionState;

        if (!scrollDirectionState.animateNavigationBar) return;

        const navigationBarElement = assertExists(navigationBarRef.current);
        const navigationBarContent = assertExists(navigationBarContentRef.current);
        const navigationBarContentElement = navigationBarContent.getElement();
        const navigationBarTitleElement = navigationBarContent.getTitleElement();

        const {
            translateY,
            isTitleVisible: isNavigationBarTitleVisible,
            lastIsTitleVisible: lastIsNavigationBarTitleVisible,
        } = scrollDirectionState.animateNavigationBar;

        const doesNavigationBarHaveSafeAreaInsetTop =
            getElementSafeAreaInsetTopPx(navigationBarContentElement) > 0;

        const timelineDefinition: Array<{}> = [
            [navigationBarElement, {y: [-translateY, 0]}, {ease: "easeInOut"}],
        ];

        if (doesNavigationBarHaveSafeAreaInsetTop) {
            timelineDefinition.push([
                navigationBarContentElement,
                {opacity: translateY > 0 ? 1 : 0},
                {at: "<", ease: "easeIn"},
            ]);
        }

        if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
            timelineDefinition.push([
                navigationBarTitleElement,
                {opacity: isNavigationBarTitleVisible ? 1 : 0},
                {at: "<", ease: "easeIn"},
            ]);
        }

        const animationControls = animate(timelineDefinition, {
            duration: navigationBarRevealOrHideAnimationDurationMs / 1000,
        });

        animationControlsRef.current ??= new Set();
        animationControlsRef.current.add(animationControls);

        void animationControls.finished.finally(() => {
            animationControlsRef.current?.delete(animationControls);
            if (animationControlsRef.current && animationControlsRef.current.size === 0) {
                animationControlsRef.current = null;
            }
        });
    }, [scrollDirectionState]);

    const desktopMaxWidth =
        desktopMaxWidthProp !== undefined
            ? isSpacing(desktopMaxWidthProp)
                ? spacing[desktopMaxWidthProp]
                : desktopMaxWidthProp
            : undefined;

    const desktopTitleMaxWidth =
        desktopTitleMaxWidthProp !== undefined
            ? isSpacing(desktopTitleMaxWidthProp)
                ? spacing[desktopTitleMaxWidthProp]
                : desktopTitleMaxWidthProp
            : undefined;

    const backgroundBorderMaxWidth =
        platform === "desktop" ? desktopMaxWidth ?? desktopTitleMaxWidth : undefined;

    return (
        <div
            ref={navigationBarContainerRef}
            className={sprinkles({zIndex: "80"})}
            style={{
                position: "absolute",
                inset: 0,
                // The children of this element may be bigger than our container but we don't
                // want our children to grow the container. We can't use `overflow: hidden`
                // since that creates a new scroll context and breaks the `position: sticky`
                // inside this element. `contain: paint` is another way to hide content outside
                // the bounds of this element without introducing a new scroll context.
                contain: "paint",
                // Don't let the cover consume pointer events. Only the navigation bar should
                // get pointer events.
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    // Extend the space our `position: sticky` element can scroll in. This way in
                    // Safari for iOS or MacOS, if the user overscrolls at the bottom of the
                    // element, the sticky element will travel with the overscroll. Instead of being
                    // locked to the bottom of the scroll content.
                    //
                    // To test, go to our native mobile iOS app (on a device which has some
                    // `--safe-area-inset-top`) then scroll to the bottom and overscroll. You'll
                    // notice the header should still cover the top safe area inset as you
                    // overscroll. If you remove this it won't.
                    bottom: "-100vh",
                }}
            >
                {withScrollAway && (
                    <div
                        style={{
                            width: "100%",
                            height: scrollDirectionState.navigationBarTopOffset,
                        }}
                    />
                )}
                <div
                    ref={navigationBarRef}
                    style={{
                        position: "sticky",
                        width: "100%",
                        height: !withScrollAway
                            ? `${navigationBarHeightRem}rem`
                            : `calc(${
                                  scrollViewSize?.height ?? 0
                              }px + ${navigationBarHeightRem}rem)`,
                        ...(!withScrollAway
                            ? {top: "0"}
                            : scrollDirectionState.scrollDirection === "Down"
                            ? {top: `-${navigationBarHeightRem}rem`}
                            : {bottom: `-${navigationBarHeightRem}rem`}),
                    }}
                >
                    <Box position="relative" zIndex="0" paddingTop="safe-area-inset">
                        <Box
                            ref={navigationBarBackgroundRef}
                            // Start with `display: none`. `onScroll` will change it to `display: block`
                            // when we scroll.
                            display="none"
                            position="absolute"
                            zIndex="-10"
                            top="0"
                            left="0"
                            right="0"
                            backgroundColor="grey-0"
                            style={{
                                height: `calc(${spacing[navigationBarHeight]} + var(--safe-area-inset-top, 0px))`,
                            }}
                        >
                            {contentCover && (
                                <Box width="full" height="full" overflow="hidden">
                                    <Box ref={navigationBarContentCoverRef} position="relative">
                                        {contentCover}
                                    </Box>
                                </Box>
                            )}
                            <Box
                                position="absolute"
                                height="border"
                                // It's subtle, but `grey-5-translucent` ends up looking a lot nicer
                                // than if we used `grey-5` directly. This is because the border operates more
                                // like a shadow. When rendered over some other content (e.g. an image) the
                                // image's colors show through the border but a little darker.
                                backgroundColor="grey-5-translucent"
                                style={{
                                    bottom: -1,
                                    left:
                                        backgroundBorderMaxWidth !== undefined
                                            ? `max(-${spacing["3"]}, (100% - ${backgroundBorderMaxWidth}) / 2 - ${spacing["3"]})`
                                            : 0,
                                    right:
                                        backgroundBorderMaxWidth !== undefined
                                            ? `max(-${spacing["3"]}, (100% - ${backgroundBorderMaxWidth}) / 2 - ${spacing["3"]})`
                                            : 0,
                                    maskImage:
                                        backgroundBorderMaxWidth !== undefined
                                            ? `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`
                                            : undefined,
                                }}
                            />
                        </Box>
                        <NavigationBarContent
                            ref={navigationBarContentRef}
                            title={title}
                            withDisappearingTitle={!withoutDisappearingTitle}
                            subtitle={subtitle}
                            menuActions={menuActions}
                            menuOffset={menuOffset}
                            contextMenuActions={contextMenuActions}
                            shareButton={shareButton}
                            withWideRouteLayoutShareMenuItem={withWideRouteLayoutShareMenuItem}
                            replaceActions={replaceActions}
                            titleJustifyContent={titleJustifyContent}
                            desktopControls={desktopControls}
                            desktopMaxWidth={desktopMaxWidthProp}
                            desktopTitleMaxWidth={desktopTitleMaxWidthProp}
                            desktopTitleMaxWidthCenterOffset={desktopTitleMaxWidthCenterOffset}
                            desktopTitleFontSize={desktopTitleFontSize}
                            desktopTitleFontWeight={desktopTitleFontWeight}
                            desktopTitleLeftSlop={desktopTitleLeftSlop}
                            desktopAdditionalActions={desktopAdditionalActions}
                            withoutMobileBackButton={withoutMobileBackButton}
                            onMobileClose={onMobileClose}
                            onMobileCancel={onMobileCancel}
                        />
                    </Box>
                </div>
            </div>
        </div>
    );
}
