import {AnimationControls, timeline} from "motion";
import {CaretLeft, DotsThree} from "phosphor-react";
import {
    MutableRefObject,
    ReactNode,
    RefCallback,
    RefObject,
    useCallback,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {scrollbarVisibleAfterScrollDurationMs} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    isSpacing,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {
    FontSize,
    colorSchemeVars,
    navigationBarStyles,
    tasksStyles,
} from "~/shared/styles/styles.js";

const {
    navigationBarHeight,
    navigationBarBackgroundFadeOutAnimationClassName,
    navigationBarTitleFadeOutAnimationClassName,
} = navigationBarStyles;
const {pointerEventsNoneNotInheritedClassName} = tasksStyles;

export {navigationBarHeight};

const navigationBarHeightRem = parseRemLengthNumber(spacing[navigationBarHeight]);

{
    // IMPORTANT: If you change this value, you must also change
    // `navigationBarHeight` in `NavigationBarConstants.swift`.
    //
    // We have an assertion below to make sure this value always equals the
    // navigation bar's pixel height on mobile devices. After converting `Spacing`
    // to an actual value and applying the rem pixel count.
    const mobileNavigationBarHeight = 80;

    assert(mobileNavigationBarHeight === navigationBarHeightRem * remPxByPlatform.mobile);
}

type ScrollDirectionState = {
    readonly scrollDirection: "Up" | "Down";
    readonly navigationBarTopOffset: number;
    readonly animateNavigationBarTranslateY: number;
};

const initialScrollDirectionState: ScrollDirectionState = {
    scrollDirection: "Down",
    navigationBarTopOffset: 0,
    animateNavigationBarTranslateY: 0,
};

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
const navigationBarVisibleHeightThresholdForRevealRem = parseRemLengthNumber(
    spacing[navigationBarVisibleHeightThresholdForReveal],
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
            navigationBarVisibleHeightThresholdForRevealRem * remPxByPlatform.mobile,
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

/**
 * Most content in our product comes with a navigation bar. The navigation bar
 * is a sticky bar at the top of the view which disappears when the user
 * scrolls down and reappears as the user scrolls up. This bar contains
 * navigation controls (like a back button on mobile) and context about the
 * current content (like a document title). It disappears when the user scrolls
 * down so they can focus on the content, if they need its controls they can
 * simply scroll up and it's there for them.
 *
 * When at the top of the scroll view, the navigation bar is displayed but it's
 * flush with other content. So it appears as if there's no sticky bar at all.
 * It's sticky nature is only revealed if the user scrolls down and back up
 * again.
 *
 * The UX idea here is that content is king. We don't want to permanently
 * allocate space for navigation which may distract from the user's main task
 * of reading or editing.
 *
 * Our native mobile apps implement tab bar UI which uses the same logic as our
 * web code navigation bar. As the user scrolls down, the tab bar disappears.
 */
export function useNavigationBar<TitleBoundaryElement extends HTMLElement>({
    title = null,
    titleBoundaryRef,
    menuActions = [],
    desktopControls = null,
    desktopTitleMaxWidth,
    desktopTitleFontSize = "200",
    desktopTitleFontWeight = "semi-bold",
}: {
    /**
     * The title to display in the navigation bar. It will be truncated based
     * on how much room is in the navigation bar.
     *
     * The title will not be displayed when scrolled to the top of the view.
     */
    title?: ReactNode;

    /**
     * The title only displays once the user has scrolled past this element. When
     * crossing this boundary the title animates in/out.
     */
    titleBoundaryRef?: RefObject<TitleBoundaryElement>;

    /**
     * Actions that are made available to the user in a menu button at the right of
     * the navigation bar. These are secondary and tertiary actions where it
     * doesn't make sense to give them their own screen space.
     */
    menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;

    /**
     * Only rendered on desktop (not mobile).
     *
     * Controls at the far left of the navigation bar that renders at the top of
     * our content and moves with the navigation bar. The title goes to the right
     * of these controls.
     *
     * For example, tasks use the status button as a desktop control. So the status
     * button renders at the very top of the task and when the user scrolls it's
     * also a part of the navigation bar.
     */
    desktopControls?: ReactNode;

    /**
     * The amount of space the title can occupy on desktop. This also has the
     * effect of centering the title container (of this width) when set.
     */
    desktopTitleMaxWidth?: Spacing | RemLength;

    /**
     * Font size to use for the title on desktop.
     */
    desktopTitleFontSize?: FontSize;

    /**
     * Font weight to use for the title on desktop.
     */
    desktopTitleFontWeight?: "semi-bold" | "bold";
} = {}): {
    /**
     * (Required) Attach this ref to the scroll view the navigation bar renders
     * on top of.
     */
    scrollViewRef: RefCallback<HTMLElement>;

    /**
     * (Required) This element should be rendered inside a `position: relative`
     * container of all content in the scroll view. It can't be rendered as a
     * direct child of the scroll view.
     *
     * For example, this works:
     *
     * ```
     * <div ref={scrollViewRef} style={{overflowY: "auto"}}>
     *     <div style={{position: "relative"}}>
     *         {navigationBar}
     *         {/* Other children... *\/}
     *     </div>
     * </div>
     * ```
     *
     * This does not work!
     *
     * ```
     * <div ref={scrollViewRef} style={{overflowY: "auto", position: "relative"}}>
     *     {navigationBar}
     *     {/* Other children... *\/}
     * </div>
     * ```
     *
     * `navigationBar` needs to be 100% height of scrollable content. Not 100%
     * height of the scrollable window.
     */
    navigationBar: ReactNode;

    /**
     * (Required) The `insetTop` value to pass to `useScrollbar()`. Otherwise the
     * custom scrollbar may sometimes overlap the header which looks weird. You are
     * expected to pass this to `useScrollbar()`.
     */
    scrollbarInsetTop?: RemLength;
} {
    const navigationBarRef = useRef<{
        initialize: (element: HTMLElement) => void;
        onScroll: (element: HTMLElement) => void;
    } | null>(null);

    const [scrollViewSize, setScrollViewSize] = useState<{height: number; width: number} | null>(
        null,
    );

    const scrollViewRef = useLifecycleRef<HTMLElement>(
        useCallback(element => {
            const handleResize = () => {
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

            const handleScroll = () => {
                assertExists(navigationBarRef.current).onScroll(element);
            };

            // Immediately populate the content rect with our element's dimensions
            // on mount.
            handleResize();

            assertExists(navigationBarRef.current).initialize(element);

            addResizeListenerForElement(element, handleResize);
            element.addEventListener("scroll", handleScroll);

            return () => {
                element.removeEventListener("scroll", handleScroll);
                removeResizeListenerForElement(element, handleResize);
            };
        }, []),
    );

    const navigationBar = (
        <NavigationBar
            handleRef={navigationBarRef}
            scrollViewSize={scrollViewSize}
            title={title}
            titleBoundaryRef={titleBoundaryRef}
            menuActions={menuActions}
            desktopControls={desktopControls}
            desktopTitleMaxWidth={desktopTitleMaxWidth}
            desktopTitleFontSize={desktopTitleFontSize}
            desktopTitleFontWeight={desktopTitleFontWeight}
        />
    );

    return {
        scrollViewRef,
        navigationBar,
        scrollbarInsetTop: spacing[navigationBarHeight],
    };
}

function NavigationBar<TitleBoundaryElement extends HTMLElement>({
    handleRef,
    scrollViewSize,
    title,
    titleBoundaryRef,
    menuActions,
    desktopControls,
    desktopTitleMaxWidth: desktopTitleMaxWidthProp,
    desktopTitleFontSize,
    desktopTitleFontWeight,
}: {
    handleRef: MutableRefObject<{
        initialize: (element: HTMLElement) => void;
        onScroll: (element: HTMLElement) => void;
    } | null>;
    scrollViewSize: {width: number; height: number} | null;
    title: ReactNode;
    titleBoundaryRef: RefObject<TitleBoundaryElement> | undefined;
    menuActions: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
    desktopControls: ReactNode;
    desktopTitleMaxWidth: Spacing | RemLength | undefined;
    desktopTitleFontSize: FontSize;
    desktopTitleFontWeight: "semi-bold" | "bold";
}) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    const navigationBarRef = useRef<HTMLDivElement>(null);
    const navigationBarBackgroundRef = useRef<HTMLDivElement>(null);
    const navigationBarContentRef = useRef<HTMLDivElement>(null);
    const navigationBarTitleRef = useRef<HTMLDivElement>(null);

    const [scrollDirectionState, setScrollDirectionState] = useState<ScrollDirectionState>(
        initialScrollDirectionState,
    );

    const lastScrollOffsetRef = useRef(0);
    const lastScrollHeightRef = useRef(0);
    const lastScrollDirectionRef = useRef(scrollDirectionState.scrollDirection);
    const lastNavigationBarTopOffsetRef = useRef(scrollDirectionState.navigationBarTopOffset);
    const lastIsNavigationBarOpaqueRef = useRef(false);
    const lastIsNavigationBarTitleVisibleRef = useRef(false);

    const animationControlsRef = useRef<Set<AnimationControls> | null>(null);

    useImperativeHandle(
        handleRef,
        () => {
            let scrollDebounceTimeout: Timeout | null = null;

            return {
                initialize: (element: HTMLElement) => {
                    const scrollOffset = Math.max(0, element.scrollTop);

                    lastScrollOffsetRef.current = scrollOffset;
                    lastScrollHeightRef.current = element.scrollHeight;
                    lastScrollDirectionRef.current = "Down";
                    lastNavigationBarTopOffsetRef.current = scrollOffset;

                    scrollDebounceTimeout?.clear();
                    scrollDebounceTimeout = null;
                },
                onScroll: (element: HTMLElement) => {
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

                    const {scrollHeight, clientHeight} = element;

                    // Immediately finish any animations when scrolling begins.
                    if (animationControlsRef.current) {
                        const animationControls = animationControlsRef.current;
                        animationControlsRef.current = null;

                        for (const animationControl of animationControls) {
                            animationControl.finish();
                        }
                    }

                    const remPx = getRemPxWithoutListening();
                    const navigationBarHeight = navigationBarHeightRem * remPx;

                    const lastScrollOffset = lastScrollOffsetRef.current;
                    lastScrollOffsetRef.current = scrollOffset;

                    const lastScrollHeight = lastScrollHeightRef.current;
                    lastScrollHeightRef.current = scrollHeight;

                    // Edge case: If we resized and scrolled down at the same time (and scrolled
                    // the same amount we resized) then we don't want our navigation bar's scroll
                    // offset to change.
                    //
                    // This happens when the typing indicator appears then disappears. Try going to
                    // a chat then typing in another tab to show the typing indicator, wait for it
                    // to disappear, then type again. Do this a couple times. When the typing
                    // indicator appears the view scrolls down to show it. We don't want that
                    // scroll down to hide our tab bar.
                    //
                    // Ideally this logic would run only after a resize and before the resize
                    // paints to the screen, but web code doesn't have a good way to listen for
                    // scroll view content resize. (Whereas in iOS native code we can use KVO to
                    // listen to `contentSize` on `UIScrollView`.)
                    //
                    // NOCOMMIT: Test that this actually works. We may need a `flushSync()` in a
                    // resize observer to make sure this update occurs in the same paint as the
                    // resize. See code d7bd291ec6a9941fadc9c01c279b9da2ca347f1f for a version that
                    // uses `ResizeObserver`.
                    if (
                        scrollOffset > lastScrollOffset &&
                        scrollOffset - lastScrollOffset == scrollHeight - lastScrollHeight
                    ) {
                        const lastNavigationBarScrollOffset = Math.max(
                            0,
                            Math.min(
                                lastScrollOffset - lastNavigationBarTopOffsetRef.current,
                                navigationBarHeight,
                            ),
                        );

                        const navigationBarTopOffset = scrollOffset - lastNavigationBarScrollOffset;
                        lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                        setScrollDirectionState({
                            scrollDirection: lastScrollDirectionRef.current,
                            navigationBarTopOffset,
                            animateNavigationBarTranslateY: 0,
                        });
                    }

                    const scrollDirection = scrollOffset > lastScrollOffset ? "Down" : "Up";
                    const lastScrollDirection = lastScrollDirectionRef.current;
                    lastScrollDirectionRef.current = scrollDirection;

                    const navigationBarScrollOffset = clamp(
                        0,
                        scrollOffset - lastNavigationBarTopOffsetRef.current,
                        navigationBarHeight,
                    );

                    // The following is web code only: Change whether navigation bar is translucent
                    // or opaque based on how far the page has been scrolled.
                    //
                    // The navigation bar is translucent at the top of the screen and rests inline
                    // with the content. As you scroll it becomes an opaque, fixed, navigation bar.
                    // In general, when your scroll offset is 0 the navigation bar is translucent.
                    // If your scroll offset is greater than 0 the navigation bar is opaque. With
                    // an exception for when you scroll down for the first time. Since when
                    // scrolling down for the first time, the navigation bar is not sticky so it
                    // would be weird if it jumped from translucent to opaque.
                    //
                    // Additionally, if we have some safe area at the top of our screen then the
                    // navigation bar content moves into the safe area. We need to decrease the
                    // content opacity to zero so it doesn't conflict with operation system content
                    // in the safe area.
                    {
                        const lastNavigationBarScrollOffset = clamp(
                            0,
                            lastScrollOffset - lastNavigationBarTopOffsetRef.current,
                            navigationBarHeight,
                        );

                        const navigationBarBackgroundElement = assertExists(
                            navigationBarBackgroundRef.current,
                        );
                        const navigationBarContentElement = assertExists(
                            navigationBarContentRef.current,
                        );
                        const navigationBarTitleElement = assertExists(
                            navigationBarTitleRef.current,
                        );

                        const doesNavigationBarHaveSafeAreaInsetTop =
                            navigationBarBackgroundElement.clientHeight >
                            navigationBarContentElement.clientHeight;

                        const lastIsNavigationBarOpaque = lastIsNavigationBarOpaqueRef.current;
                        const lastIsNavigationBarTitleVisible =
                            lastIsNavigationBarTitleVisibleRef.current;

                        const isNavigationBarOpaque = lastIsNavigationBarOpaque
                            ? scrollOffset > 0
                            : scrollOffset > navigationBarHeight;

                        // Compute the title boundary scroll offset...
                        let titleBoundaryOffset: number | null = null;
                        if (titleBoundaryRef?.current) {
                            let titleBoundaryParentElement: HTMLElement = titleBoundaryRef.current;

                            titleBoundaryOffset =
                                titleBoundaryParentElement.offsetTop +
                                titleBoundaryParentElement.clientHeight;
                            while (
                                titleBoundaryParentElement.offsetParent instanceof HTMLElement &&
                                titleBoundaryParentElement.offsetParent !== element
                            ) {
                                titleBoundaryParentElement =
                                    titleBoundaryParentElement.offsetParent;
                                titleBoundaryOffset += titleBoundaryParentElement.offsetTop;
                            }

                            // If the title boundary element is not in our scroll view then consider our
                            // boundary offset to be unset.
                            if (titleBoundaryParentElement.offsetParent !== element) {
                                titleBoundaryOffset = null;
                            }

                            if (titleBoundaryOffset !== null) {
                                // If our scroll view has safe area then don't include the safe area in the
                                // scroll offset. The scroll offset starts below our safe area.
                                if (doesNavigationBarHaveSafeAreaInsetTop) {
                                    titleBoundaryOffset -=
                                        navigationBarBackgroundElement.clientHeight -
                                        navigationBarContentElement.clientHeight;
                                }

                                // Let a bit of the title boundary element show before hiding the title.
                                titleBoundaryOffset -= 0.75 * remPx;
                            }
                        }

                        const isNavigationBarTitleVisible =
                            isNavigationBarOpaque &&
                            (titleBoundaryOffset === null ||
                                scrollOffset >= titleBoundaryOffset - navigationBarHeight);

                        lastIsNavigationBarOpaqueRef.current = isNavigationBarOpaque;
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

                            if (isNavigationBarOpaque) {
                                navigationBarBackgroundElement.style.opacity = "1";
                                navigationBarBackgroundElement.style.pointerEvents = "auto";
                            } else {
                                navigationBarBackgroundElement.style.opacity = `${navigationBarScrollPercentage}`;
                                navigationBarBackgroundElement.style.pointerEvents =
                                    navigationBarScrollPercentage === 0 ? "none" : "auto";
                            }

                            // If we have a fade out animation running, cancel it.
                            navigationBarBackgroundElement.classList.remove(
                                navigationBarBackgroundFadeOutAnimationClassName,
                            );

                            navigationBarContentElement.style.opacity = `${
                                1 - navigationBarScrollPercentage
                            }`;
                        }

                        // Handle the transition from a translucent navigation bar to an opaque
                        // navigation bar.
                        if (lastIsNavigationBarOpaque !== isNavigationBarOpaque) {
                            if (!isNavigationBarOpaque) {
                                navigationBarBackgroundElement.style.opacity = "0";
                                navigationBarBackgroundElement.style.pointerEvents = "none";

                                navigationBarBackgroundElement.classList.add(
                                    navigationBarBackgroundFadeOutAnimationClassName,
                                );
                            } else {
                                navigationBarBackgroundElement.style.opacity = "1";
                                navigationBarBackgroundElement.style.pointerEvents = "auto";

                                navigationBarBackgroundElement.classList.remove(
                                    navigationBarBackgroundFadeOutAnimationClassName,
                                );
                            }
                        }

                        // Handle the transition from a visible navigation bar title to a hidden
                        // navigation bar title.
                        if (lastIsNavigationBarTitleVisible !== isNavigationBarTitleVisible) {
                            if (!isNavigationBarTitleVisible) {
                                navigationBarTitleElement.style.opacity = "0";
                                navigationBarTitleElement.style.pointerEvents = "none";

                                navigationBarTitleElement.classList.add(
                                    navigationBarTitleFadeOutAnimationClassName,
                                );
                            } else {
                                navigationBarTitleElement.style.opacity = "1";
                                navigationBarTitleElement.style.pointerEvents = "auto";

                                navigationBarTitleElement.classList.remove(
                                    navigationBarTitleFadeOutAnimationClassName,
                                );
                            }
                        }
                    }

                    if (scrollDirection !== lastScrollDirection) {
                        const navigationBarTopOffset = scrollOffset - navigationBarScrollOffset;
                        lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset,
                            animateNavigationBarTranslateY: 0,
                        });
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
                            let navigationBarTopOffset: number;
                            if (
                                navigationBarHeight - navigationBarScrollOffset >=
                                    navigationBarVisibleHeightThresholdForRevealRem * remPx ||
                                scrollOffset >= scrollHeight - clientHeight
                            ) {
                                navigationBarTopOffset = scrollOffset;
                            } else {
                                navigationBarTopOffset = Math.max(
                                    0,
                                    scrollOffset - navigationBarHeight,
                                );
                            }

                            const lastNavigationBarTopOffset =
                                lastNavigationBarTopOffsetRef.current;
                            lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                            setScrollDirectionState({
                                scrollDirection,
                                navigationBarTopOffset,
                                animateNavigationBarTranslateY:
                                    navigationBarTopOffset - lastNavigationBarTopOffset,
                            });
                        }, navigationBarTransitionDebounceScrollTimeoutMs);
                    }
                },
            };
        },
        [titleBoundaryRef],
    );

    const lastAnimatedScrollDirectionStateRef = useRef(scrollDirectionState);

    useLayoutEffectWithoutServerSideWarning(() => {
        const navigationBarElement = assertExists(navigationBarRef.current);
        const navigationBarBackgroundElement = assertExists(navigationBarBackgroundRef.current);
        const navigationBarContentElement = assertExists(navigationBarContentRef.current);

        if (lastAnimatedScrollDirectionStateRef.current === scrollDirectionState) return;
        lastAnimatedScrollDirectionStateRef.current = scrollDirectionState;

        if (scrollDirectionState.animateNavigationBarTranslateY === 0) return;

        const doesNavigationBarHaveSafeAreaInsetTop =
            navigationBarBackgroundElement.clientHeight > navigationBarContentElement.clientHeight;

        const timelineDefinition: Parameters<typeof timeline>[0] = [
            [
                navigationBarElement,
                {y: [-scrollDirectionState.animateNavigationBarTranslateY, 0]},
                {easing: "ease-in-out"},
            ],
        ];

        if (doesNavigationBarHaveSafeAreaInsetTop) {
            timelineDefinition.push([
                navigationBarContentElement,
                {
                    opacity: scrollDirectionState.animateNavigationBarTranslateY > 0 ? 1 : 0,
                },
                {at: "<", easing: "ease-in"},
            ]);
        }

        const animationControls = timeline(timelineDefinition, {
            duration: navigationBarRevealOrHideAnimationDurationMs / 1000,
        });

        animationControlsRef.current ??= new Set();
        animationControlsRef.current.add(animationControls);

        animationControls.finished.finally(() => {
            animationControlsRef.current?.delete(animationControls);
            if (animationControlsRef.current && animationControlsRef.current.size === 0) {
                animationControlsRef.current = null;
            }
        });
    }, [scrollDirectionState]);

    const gap = "3";
    const edgeButtonSize = isMobile ? "7" : "6";

    // Allocate enough space on the edge for two buttons.
    const edgeButtonsWidth = addRemLengths(
        spacing[edgeButtonSize],
        spacing[gap],
        spacing[edgeButtonSize],
        spacing[gap],
    );

    const desktopTitleMaxWidth =
        desktopTitleMaxWidthProp !== undefined
            ? isSpacing(desktopTitleMaxWidthProp)
                ? spacing[desktopTitleMaxWidthProp]
                : desktopTitleMaxWidthProp
            : undefined;

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                // Render on top of everything, including overlays.
                zIndex: 80,
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
                    inset: 0,
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
                <div
                    style={{
                        width: "100%",
                        height: scrollDirectionState.navigationBarTopOffset,
                    }}
                />
                <div
                    ref={navigationBarRef}
                    style={{
                        position: "sticky",
                        width: "100%",
                        height: `calc(${
                            scrollViewSize?.height ?? 0
                        }px + ${navigationBarHeightRem}rem)`,
                        ...(scrollDirectionState.scrollDirection === "Down"
                            ? {top: `-${navigationBarHeightRem}rem`}
                            : {bottom: `-${navigationBarHeightRem}rem`}),
                    }}
                >
                    <Box
                        position="relative"
                        zIndex="0"
                        overflow="hidden"
                        style={{paddingTop: "var(--safe-area-inset-top)"}}
                    >
                        <Box
                            ref={navigationBarBackgroundRef}
                            position="absolute"
                            inset="0"
                            // Initial opacity is 0. Our code will update the opacity.
                            opacity="0"
                        >
                            {/* <Box
                                position="absolute"
                                inset="1.5"
                                zIndex="-10"
                                backgroundColor="grey-0"
                                borderRadius="md"
                                boxShadow="elevation-10"
                            />
                            <Box
                                position="absolute"
                                inset="0"
                                bottom="1.5"
                                zIndex="-20"
                                backgroundColor="grey-0"
                            /> */}
                            <Box
                                position="absolute"
                                inset="0"
                                boxShadow="elevation-5"
                                style={{
                                    bottom: 2,
                                    // NOCOMMIT: Color scheme
                                    backgroundColor: "rgba(251, 251, 252, 0.95)",
                                    // background:
                                    //     "linear-gradient(rgba(255, 255, 255, 1), rgba(255, 255, 255, 0.5))",
                                    backdropFilter: "blur(6px)",
                                    WebkitBackdropFilter: "blur(6px)",
                                    transform: "translate3d(0px, 0px, 0px)",
                                }}
                            />
                        </Box>
                        <Box
                            ref={navigationBarContentRef}
                            position="relative"
                            width="full"
                            height={navigationBarHeight}
                            overflow="hidden"
                            display="flex"
                            paddingLeft={isMobile ? gap : "5"}
                            paddingRight={isMobile ? gap : "5"}
                        >
                            {isMobile ? (
                                <Box
                                    flexShrink="0"
                                    height={navigationBarHeight}
                                    style={{width: edgeButtonsWidth}}
                                    display="flex"
                                    justifyContent="flex-start"
                                    alignItems="center"
                                    gap={gap}
                                    // Gives children `pointer-events: initial` so the user can interact with them.
                                    className={pointerEventsNoneNotInheritedClassName}
                                >
                                    <IconButton
                                        size="base"
                                        description="Back"
                                        withoutTooltip={true}
                                        onPress={() => navigate(-1)}
                                    >
                                        <CaretLeft />
                                    </IconButton>
                                </Box>
                            ) : (
                                desktopTitleMaxWidth !== undefined && (
                                    <Box
                                        flexGrow="0"
                                        flexShrink="0"
                                        style={{
                                            width: `max(0px, (100% - ${desktopTitleMaxWidth}) / 2)`,
                                        }}
                                    />
                                )
                            )}
                            <Box
                                flexGrow="1"
                                flexShrink="1"
                                width="full"
                                height={navigationBarHeight}
                                overflow="hidden"
                                display="flex"
                                justifyContent={isMobile ? "center" : "flex-start"}
                                alignItems="center"
                                gap={gap}
                                style={{
                                    maxWidth: desktopTitleMaxWidth,
                                }}
                            >
                                {!isMobile && desktopControls && (
                                    <Box
                                        // Gives children `pointer-events: initial` so the user can interact with them.
                                        className={pointerEventsNoneNotInheritedClassName}
                                    >
                                        {desktopControls}
                                    </Box>
                                )}
                                <Box
                                    ref={navigationBarTitleRef}
                                    // We have less space on mobile so use a smaller font size.
                                    fontSize={isMobile ? "100" : desktopTitleFontSize}
                                    fontStyle={
                                        isMobile
                                            ? "truncate-semi-bold"
                                            : `truncate-${desktopTitleFontWeight}`
                                    }
                                    userSelect={!isMobile ? "text" : undefined}
                                    // Initial opacity is 0. Our code will update the opacity.
                                    opacity="0"
                                >
                                    {title}
                                </Box>
                            </Box>
                            <Box
                                flexGrow={!isMobile ? "1" : undefined}
                                flexShrink="0"
                                height={navigationBarHeight}
                                style={{width: edgeButtonsWidth}}
                                display="flex"
                                justifyContent="flex-end"
                                alignItems="center"
                                gap={gap}
                                // Gives children `pointer-events: initial` so the user can interact with them.
                                className={pointerEventsNoneNotInheritedClassName}
                            >
                                {menuActions.length > 0 && (
                                    <MenuButton actions={menuActions}>
                                        <IconButton
                                            size={isMobile ? "base" : "md"}
                                            description="More"
                                            withoutTooltip={true}
                                        >
                                            <DotsThree
                                            // Vertical dots create better visual balance on mobile because:
                                            //
                                            // 1. On mobile we have a back button on the left and we want this button to
                                            //    look aligned with that
                                            // 2. The title might be truncated with ellipsis which looks like horizontal
                                            //    dots
                                            />
                                        </IconButton>
                                    </MenuButton>
                                )}
                            </Box>
                        </Box>
                    </Box>
                </div>
            </div>
        </div>
    );
}
