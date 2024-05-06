import {AnimationControls, timeline} from "motion";
import {ArrowLeft, DotsThreeVertical} from "phosphor-react";
import {
    MutableRefObject,
    ReactElement,
    ReactNode,
    Ref,
    RefCallback,
    RefObject,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {
    ScrollbarInsetDynamic,
    scrollbarVisibleAfterScrollDurationMs,
} from "~/client/design/scrollbar.js";
import {ShareButton, createShareMenuItem} from "~/client/design/share_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {useIsTextInputFocused} from "~/client/design/use_is_text_input_focused.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {getIsMobileWithoutListening, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    isSpacing,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {
    FontSize,
    navigationBarStyles,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

const {
    desktopNavigationBarHeight,
    mobileNavigationBarHeight,
    navigationBarBackgroundFadeOutAnimationClassName,
    navigationBarTitleFadeOutAnimationClassName,
} = navigationBarStyles;

export {desktopNavigationBarHeight, mobileNavigationBarHeight};

export const navigationBarHeight = {
    desktop: desktopNavigationBarHeight,
    mobile: mobileNavigationBarHeight,
} as const;

export const desktopNavigationBarHeightRem = parseRemLengthNumber(
    spacing[desktopNavigationBarHeight],
);
export const mobileNavigationBarHeightRem = parseRemLengthNumber(
    spacing[mobileNavigationBarHeight],
);

export function getNavigationBarHeightRemWithoutListening(): number {
    if (getIsMobileWithoutListening()) {
        return mobileNavigationBarHeightRem;
    } else {
        return desktopNavigationBarHeightRem;
    }
}

export function getNavigationBarHeightPxWithoutListening(): number {
    return getNavigationBarHeightRemWithoutListening() * getRemPxWithoutListening();
}

{
    // IMPORTANT: If you change this value, you must also change
    // `navigationBarHeight` in `NavigationBarConstants.swift`.
    //
    // We have an assertion below to make sure this value always equals the
    // navigation bar's pixel height on mobile devices. After converting `Spacing`
    // to an actual value and applying the rem pixel count.
    const mobileNavigationBarHeight = 70;

    assert(mobileNavigationBarHeight === mobileNavigationBarHeightRem * remPxByPlatform.mobile);
}

const navigationBarActionsFlexBasis: Spacing = "10";
const mobileNavigationBarGap: Spacing = "3";

export const mobileNavigationBarActionsWidthFittingFlexBasis = subtractRemLengths(
    spacing[navigationBarActionsFlexBasis],
    spacing[mobileNavigationBarGap],
);

const onNavigationBarPrepareSmoothScrollToSymbol = Symbol("onNavigationBarPrepareSmoothScrollTo");

/**
 * When we call `scrollTo({top: newScrollTop, behavior: "smooth"})` then in
 * mobile WebKit a scroll animation will be started on iOS's UI thread. We may
 * get scroll events after a delay as iOS prioritizes animation performance.
 *
 * If this scroll would change the scroll direction then we need to update our
 * navigation bar's `scrollDirectionState` BEFORE the animation starts so our
 * sticky positioning CSS is ready for the animation. Otherwise there may be a
 * little jank in the animation as sticky positioning thinks we're scrolling in
 * the wrong direction.
 *
 * Ideally we'd call this before any
 * `scrollTo({top: newScrollTop, behavior: "smooth"})` call but since we don't
 * want to mutate `Element.prototype` instead we'll manually call this function
 * when necessary.
 *
 * Example of bug this fixes:
 * https://gist.github.com/calebmer/91334a35af1e9ee8043bea5e1c105728
 */
export function dispatchNavigationBarPrepareSmoothScrollTo(
    element: Element & {
        [onNavigationBarPrepareSmoothScrollToSymbol]?: (scrollTop: number) => void;
    },
    scrollTop: number,
) {
    element[onNavigationBarPrepareSmoothScrollToSymbol]?.(scrollTop);
}

type ScrollDirectionState = {
    readonly scrollDirection: "Up" | "Down";
    readonly navigationBarTopOffset: number;
    readonly animateNavigationBar: {
        readonly translateY: number;
        readonly isOpaque: boolean;
        readonly isTitleVisible: boolean;
        readonly lastIsOpaque: boolean;
        readonly lastIsTitleVisible: boolean;
    } | null;
};

const initialScrollDirectionState: ScrollDirectionState = {
    scrollDirection: "Down",
    navigationBarTopOffset: 0,
    animateNavigationBar: null,
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

export type NavigationBarRef = {
    /**
     * Get the number of visible pixels for this navigation bar. Includes top safe
     * area inset since the navigation bar is always visible in the safe area.
     */
    getVisibleHeight(): number;

    /**
     * Get the number of visible pixels when this navigation bar is fully expanded.
     */
    getMaxVisibleHeight(): number;
};

export type NavigationBarResult = {
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
     *
     * If you're attaching a navigation bar to a `<VirtualizedScrollView>` then
     * `navigationBar` may be put in the `extraChildren` prop.
     */
    navigationBar: ReactElement | null;

    /**
     * (Required) The `insetTop` value to pass to `useScrollbar()`. Otherwise the
     * custom scrollbar may sometimes overlap the header which looks weird. You are
     * expected to pass this to `useScrollbar()`.
     */
    scrollbarInsetTop?: ScrollbarInsetDynamic;
};

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
    ref,
    isDisabled = false,
    withMobileLayout,
    title = null,
    titleBoundaryRef,
    withoutDisappearingTitle = false,
    subtitle,
    menuActions = emptyArray,
    shareButton,
    stickyBanner,
    replaceActions,
    desktopControls = null,
    desktopMaxWidth,
    desktopTitleMaxWidth,
    desktopTitleFontSize = "200",
    desktopTitleFontWeight = "semi-bold",
    desktopTitleLeftSlop,
    desktopMarginTop,
    mobileTitleJustifyContents = "center",
    onMobileCancel,
}: {
    /**
     * A ref for interacting with the navigation bar when mounted.
     */
    ref?: Ref<NavigationBarRef>;

    /**
     * Is the navigation bar actually rendered? If true then none of the navigation
     * bar logic runs and you don't need to use `navigationBarResult`.
     *
     * `ref` will not be initialized if true.
     */
    isDisabled?: boolean;

    /**
     * Should the navigation bar use a mobile layout even while on desktop? This is
     * typically set to true in peeks. Peeks are visible on desktop but need a
     * mobile-like layout.
     *
     * We use a mobile layout when in mobile mode regardless of whether this is
     * true or not.
     */
    withMobileLayout: boolean;

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
     * Don't let the title disappear when the navigation bar is scrolled to the
     * top. This can lead to some cleaner designs.
     */
    withoutDisappearingTitle?: boolean;

    /**
     * A secondary title we render under the main title at a smaller size. Used to
     * add a bit of extra detail.
     */
    subtitle?: ReactNode;

    /**
     * Actions that are made available to the user in a menu button at the right of
     * the navigation bar. These are secondary and tertiary actions where it
     * doesn't make sense to give them their own screen space.
     */
    menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;

    /**
     * Configures the behavior of the share button in the navigation bar. If not
     * provided then there's no share button in the navigation bar.
     */
    // TODO(calebmer): Currently the share button is unimplemented. When we add
    // implementation this object will configure updating share properties
    // and such.
    shareButton?: {};

    /**
     * The sticky banner element will be rendered underneath the navigation bar and
     * will continue to be visible as the user scrolls.
     */
    stickyBanner?: ReactNode;

    /**
     * If provided, completely replace the actions in this navigation bar's content
     * (which includes `menuActions` and `shareButton`) with the contents of this
     * node.
     *
     * Useful if you're entering an edit modality and need controls to exit the
     * editing modality.
     */
    replaceActions?: ReactNode;

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
     * The amount of space all content in the navigation bar can occupy on desktop.
     * This also has the effect of centering the title container (of this width)
     * when set.
     *
     * The difference between `desktopMaxWidth` and `desktopTitleMaxWidth` is that
     * if `desktopTitleMaxWidth` is set then `menuActions` and `shareButton` will
     * be aligned with the right side of the screen but if `desktopMaxWidth` is set
     * then `menuActions` and `shareButton` are within the max width.
     */
    desktopMaxWidth?: Spacing | RemLength;

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

    /**
     * Slop we add to the left of the title element. You can use this if you don't
     * want the title's `overflow="hidden"` to clip some UI the title renders to
     * the left.
     */
    desktopTitleLeftSlop?: Spacing;

    /**
     * Extra scroll space added above the navigation bar on desktop. Similar to safe
     * area inset but the navigation bar doesn't cover this area when scrolled.
     */
    desktopMarginTop?: Spacing | RemLength;

    /**
     * How do we justify title contents on mobile? Defaults to `center`. To match
     * desktop behavior use `flex-start`.
     */
    mobileTitleJustifyContents?: "center" | "flex-start";

    /**
     * By default, the navigation bar on mobile has a back button which calls
     * `navigate(-1)`. If you'd like to provide custom back navigation behavior
     * then you may pass this prop which will switch the back button to a "Cancel"
     * button that calls the function when pressed.
     *
     * For instance, if you use this in a `<MobileFullScreenModal>` you need to
     * close the modal instead of calling `navigate(-1)`.
     */
    onMobileCancel?: () => void;
}): NavigationBarResult {
    const isMobile = useIsMobile();

    const navigationBarRef = useRef<{
        initialize: (element: HTMLElement) => void;
        onResize: (element: HTMLElement) => void;
        onScroll: (element: HTMLElement) => void;
        onPrepareSmoothScrollTo: (element: HTMLElement, scrollTop: number) => void;
    } | null>(null);

    const scrollViewRef = useLifecycleRef<HTMLElement>(
        useCallback(
            element => {
                if (isDisabled) return;

                const handleResize = () => {
                    assertExists(navigationBarRef.current).onResize(element);
                };

                const handleScroll = () => {
                    assertExists(navigationBarRef.current).onScroll(element);
                };

                const handlePrepareSmoothScrollTo = (scrollTop: number) => {
                    assertExists(navigationBarRef.current).onPrepareSmoothScrollTo(
                        element,
                        scrollTop,
                    );
                };

                let isCancelled = false;
                let cleanup: (() => void) | undefined;

                // Run after a microtask so if a `useLayoutEffect()` scrolls the view then the
                // scroll change is seen by `initialize()`. Initial scrolls shouldn't hide the
                // navigation bar. Coincidentally, our native wrapper works the same way. It
                // doesn't see the initial scroll.
                //
                // Test case: On mobile click a document comment thread preview (from a
                // document comment thread notification) it should open the document scrolled
                // to the comment (but without the comment thread open) and the navigation bar
                // should be visible.
                scheduleMicrotask(() => {
                    if (isCancelled) return;

                    // Call `flushSync()` since if this update was happening inside the layout
                    // effect it would be synchronously flushed. We need changes from this function
                    // to be applied before the next browser paint.
                    flushSync(() => {
                        assertExists(navigationBarRef.current).initialize(element);

                        // Immediately populate the content rect with our element's dimensions
                        // on mount.
                        handleResize();

                        addResizeListenerForElement(element, handleResize);
                        element.addEventListener("scroll", handleScroll);
                        (element as any)[onNavigationBarPrepareSmoothScrollToSymbol] =
                            handlePrepareSmoothScrollTo;

                        cleanup = () => {
                            element.removeEventListener("scroll", handleScroll);
                            removeResizeListenerForElement(element, handleResize);
                            (element as any)[onNavigationBarPrepareSmoothScrollToSymbol] =
                                undefined;
                        };
                    });
                });

                return () => {
                    isCancelled = true;
                    cleanup?.();
                };
            },
            [isDisabled],
        ),
    );

    const desktopMarginTopRem =
        desktopMarginTop !== undefined
            ? parseRemLengthNumber(
                  desktopMarginTop.endsWith("rem")
                      ? (desktopMarginTop as RemLength)
                      : spacing[desktopMarginTop as Spacing],
              )
            : 0;

    const navigationBar = !isDisabled ? (
        <NavigationBar
            isMobile={isMobile}
            withMobileLayout={withMobileLayout || isMobile}
            handleRef={navigationBarRef}
            navigationBarRef={ref}
            title={title}
            titleBoundaryRef={titleBoundaryRef}
            withoutDisappearingTitle={withoutDisappearingTitle}
            subtitle={subtitle}
            menuActions={menuActions}
            shareButton={shareButton}
            stickyBanner={stickyBanner}
            replaceActions={replaceActions}
            desktopControls={desktopControls}
            desktopMaxWidth={desktopMaxWidth}
            desktopTitleMaxWidth={desktopTitleMaxWidth}
            desktopTitleFontSize={desktopTitleFontSize}
            desktopTitleFontWeight={desktopTitleFontWeight}
            desktopTitleLeftSlop={desktopTitleLeftSlop}
            desktopMarginTopRem={desktopMarginTopRem}
            mobileTitleJustifyContents={mobileTitleJustifyContents}
            onMobileCancel={onMobileCancel}
        />
    ) : null;

    return {
        scrollViewRef,
        navigationBar,
        scrollbarInsetTop: useMemo(
            () =>
                !isDisabled
                    ? isMobile
                        ? [
                              desktopMarginTopRem !== 0
                                  ? addRemLengths(
                                        spacing[mobileNavigationBarHeight],
                                        `${desktopMarginTopRem}rem`,
                                    )
                                  : spacing[mobileNavigationBarHeight],
                              {withSafeArea: true},
                          ]
                        : [
                              desktopMarginTopRem !== 0
                                  ? addRemLengths(
                                        spacing[desktopNavigationBarHeight],
                                        `${desktopMarginTopRem}rem`,
                                    )
                                  : spacing[desktopNavigationBarHeight],
                              {withSafeArea: true},
                          ]
                    : undefined,
            [desktopMarginTopRem, isDisabled, isMobile],
        ),
    };
}

function NavigationBar<TitleBoundaryElement extends HTMLElement>({
    isMobile,
    withMobileLayout,
    handleRef,
    navigationBarRef: externalNavigationBarRef,
    title,
    titleBoundaryRef,
    withoutDisappearingTitle,
    subtitle,
    menuActions,
    shareButton,
    stickyBanner,
    replaceActions,
    desktopControls,
    desktopMaxWidth,
    desktopTitleMaxWidth,
    desktopTitleFontSize,
    desktopTitleFontWeight,
    desktopTitleLeftSlop,
    desktopMarginTopRem,
    mobileTitleJustifyContents,
    onMobileCancel,
}: {
    isMobile: boolean;
    withMobileLayout: boolean;
    handleRef: MutableRefObject<{
        initialize: (element: HTMLElement) => void;
        onScroll: (element: HTMLElement) => void;
        onResize: (element: HTMLElement) => void;
        onPrepareSmoothScrollTo: (element: HTMLElement, scrollTop: number) => void;
    } | null>;
    navigationBarRef: Ref<NavigationBarRef> | undefined;
    title: ReactNode;
    titleBoundaryRef: RefObject<TitleBoundaryElement> | undefined;
    withoutDisappearingTitle: boolean;
    subtitle: ReactNode | undefined;
    menuActions: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
    shareButton: {} | undefined;
    stickyBanner: ReactNode;
    replaceActions: ReactNode;
    desktopControls: ReactNode;
    desktopMaxWidth: Spacing | RemLength | undefined;
    desktopTitleMaxWidth: Spacing | RemLength | undefined;
    desktopTitleFontSize: FontSize;
    desktopTitleFontWeight: "semi-bold" | "bold";
    desktopTitleLeftSlop: Spacing | undefined;
    desktopMarginTopRem: number;
    mobileTitleJustifyContents: "center" | "flex-start";
    onMobileCancel: (() => void) | undefined;
}) {
    const {isAppleDevice, isNativeMobile} = useClientInfo();

    const [scrollViewSize, setScrollViewSize] = useState<{height: number; width: number} | null>(
        null,
    );

    const navigationBarHeightRem = isMobile
        ? mobileNavigationBarHeightRem
        : desktopNavigationBarHeightRem;

    const navigationBarContainerRef = useRef<HTMLDivElement>(null);
    const navigationBarRef = useRef<HTMLDivElement>(null);
    const navigationBarBackgroundRef = useRef<HTMLDivElement>(null);
    const navigationBarContentRef = useRef<NavigationBarContentRef>(null);

    const [scrollDirectionState, setScrollDirectionState] = useState<ScrollDirectionState>(
        initialScrollDirectionState,
    );

    const lastScrollOffsetRef = useRef(0);
    const lastScrollHeightRef = useRef(0);
    const lastScrollDirectionRef = useRef(scrollDirectionState.scrollDirection);
    const lastNavigationBarTopOffsetRef = useRef(scrollDirectionState.navigationBarTopOffset);
    const lastIsNavigationBarOpaqueRef = useRef(false);
    const lastIsNavigationBarTitleVisibleRef = useRef(false);

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
        [navigationBarHeightRem],
    );

    const animationControlsRef = useRef<Set<AnimationControls> | null>(null);

    useImperativeHandle(
        handleRef,
        () => {
            let navigationBarContainerElement: HTMLDivElement | undefined;
            let navigationBarBackgroundElement: HTMLDivElement | undefined;
            let navigationBarContent: NavigationBarContentRef | undefined;
            let navigationBarContentElement: HTMLElement | undefined;
            let navigationBarTitleElement: HTMLElement | undefined;

            let scrollDebounceTimeout: Timeout | null = null;

            const getTitleBoundaryOffset = (element: HTMLElement): number | null => {
                navigationBarBackgroundElement ??= assertExists(navigationBarBackgroundRef.current);
                navigationBarContent ??= assertExists(navigationBarContentRef.current);
                navigationBarContentElement ??= navigationBarContent.getElement();

                if (withoutDisappearingTitle) return null;
                if (!titleBoundaryRef?.current) return null;

                let titleBoundaryParentElement: HTMLElement = titleBoundaryRef.current;

                let titleBoundaryOffset =
                    titleBoundaryParentElement.offsetTop + titleBoundaryParentElement.clientHeight;
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
                titleBoundaryOffset -= Math.max(
                    0,
                    navigationBarBackgroundElement.clientHeight -
                        navigationBarContentElement.clientHeight,
                );

                // Hide the title a bit after the title is actually in view.
                titleBoundaryOffset -= 0.5 * getRemPxWithoutListening();

                return titleBoundaryOffset;
            };

            const initialize = (element: HTMLElement) => {
                navigationBarBackgroundElement ??= assertExists(navigationBarBackgroundRef.current);
                navigationBarContent ??= assertExists(navigationBarContentRef.current);
                navigationBarTitleElement ??= navigationBarContent.getTitleElement();

                // Immediately finish any animations when scrolling begins.
                if (animationControlsRef.current) {
                    const animationControls = animationControlsRef.current;
                    animationControlsRef.current = null;

                    for (const animationControl of animationControls) {
                        animationControl.finish();
                    }
                }

                scrollDebounceTimeout?.clear();
                scrollDebounceTimeout = null;

                const remPx = getRemPxWithoutListening();
                const navigationBarHeight = navigationBarHeightRem * remPx;

                const scrollOffset = Math.max(0, element.scrollTop);

                const lastScrollDirection = lastScrollDirectionRef.current;
                const lastNavigationBarTopOffset = lastNavigationBarTopOffsetRef.current;
                const lastIsNavigationBarOpaque = lastIsNavigationBarOpaqueRef.current;
                const lastIsNavigationBarTitleVisible = lastIsNavigationBarTitleVisibleRef.current;

                lastScrollOffsetRef.current = scrollOffset;
                lastScrollHeightRef.current = element.scrollHeight;
                // Initialize scroll direction to `Up` if the scroll view has initially
                // scrolled since we've observed some janky when immediately scrolling up after
                // initialization.
                const scrollDirection = (lastScrollDirectionRef.current =
                    scrollOffset > navigationBarHeight ? "Up" : "Down");
                const navigationBarTopOffset = (lastNavigationBarTopOffsetRef.current =
                    scrollOffset);

                const isNavigationBarOpaque = scrollOffset > navigationBarHeight;
                lastIsNavigationBarOpaqueRef.current = isNavigationBarOpaque;

                const titleBoundaryOffset = getTitleBoundaryOffset(element);

                const isNavigationBarTitleVisible =
                    withoutDisappearingTitle ||
                    (isNavigationBarOpaque &&
                        (titleBoundaryOffset === null ||
                            scrollOffset >= titleBoundaryOffset - navigationBarHeight));
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

                if (isNavigationBarOpaque !== lastIsNavigationBarOpaque) {
                    navigationBarBackgroundElement.style.opacity = isNavigationBarOpaque
                        ? "1"
                        : "0";
                    navigationBarBackgroundElement.style.pointerEvents = isNavigationBarOpaque
                        ? "auto"
                        : "none";
                    navigationBarBackgroundElement.style.pointerEvents = isNavigationBarOpaque
                        ? "80"
                        : "40";
                    navigationBarBackgroundElement.classList.remove(
                        navigationBarBackgroundFadeOutAnimationClassName,
                    );
                }

                if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                    navigationBarTitleElement.style.opacity = isNavigationBarTitleVisible
                        ? "1"
                        : "0";
                    navigationBarTitleElement.style.pointerEvents = isNavigationBarTitleVisible
                        ? "auto"
                        : "none";
                    navigationBarTitleElement.classList.remove(
                        navigationBarTitleFadeOutAnimationClassName,
                    );
                }
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

                const doesNavigationBarHaveSafeAreaInsetTop =
                    navigationBarBackgroundElement.clientHeight >
                    navigationBarContentElement.clientHeight;

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
                if (
                    scrollOffset > lastScrollOffset &&
                    scrollOffset - lastScrollOffset == scrollHeight - lastScrollHeight
                ) {
                    const lastNavigationBarScrollOffset = clamp(
                        0,
                        lastScrollOffset - lastNavigationBarTopOffsetRef.current,
                        navigationBarHeight,
                    );

                    const navigationBarTopOffset = scrollOffset - lastNavigationBarScrollOffset;
                    lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                    const lastIsNavigationBarOpaque = lastIsNavigationBarOpaqueRef.current;
                    const lastIsNavigationBarTitleVisible =
                        lastIsNavigationBarTitleVisibleRef.current;

                    const isNavigationBarOpaque = scrollOffset > 0;

                    const titleBoundaryOffset = getTitleBoundaryOffset(element);

                    const isNavigationBarTitleVisible =
                        withoutDisappearingTitle ||
                        (isNavigationBarOpaque &&
                            (titleBoundaryOffset === null ||
                                scrollOffset >= titleBoundaryOffset - navigationBarHeight));

                    lastIsNavigationBarOpaqueRef.current = isNavigationBarOpaque;
                    lastIsNavigationBarTitleVisibleRef.current = isNavigationBarTitleVisible;

                    // Immediately update our sticky positioning CSS to avoid potential jankiness.
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection: lastScrollDirectionRef.current,
                            navigationBarTopOffset: Math.max(
                                0,
                                navigationBarTopOffset -
                                    (!isMobile ? desktopMarginTopRem * remPx : 0),
                            ),
                            animateNavigationBar: null,
                        });
                    });

                    if (isNavigationBarOpaque !== lastIsNavigationBarOpaque) {
                        navigationBarBackgroundElement.style.opacity = isNavigationBarOpaque
                            ? "1"
                            : "0";
                        navigationBarBackgroundElement.style.pointerEvents = isNavigationBarOpaque
                            ? "auto"
                            : "none";
                        navigationBarBackgroundElement.style.pointerEvents = isNavigationBarOpaque
                            ? "80"
                            : "40";
                        navigationBarBackgroundElement.classList.remove(
                            navigationBarBackgroundFadeOutAnimationClassName,
                        );
                    }

                    if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                        navigationBarTitleElement.style.opacity = isNavigationBarTitleVisible
                            ? "1"
                            : "0";
                        navigationBarTitleElement.style.pointerEvents = isNavigationBarTitleVisible
                            ? "auto"
                            : "none";
                        navigationBarTitleElement.classList.remove(
                            navigationBarTitleFadeOutAnimationClassName,
                        );
                    }
                }

                const scrollDirection = scrollOffset > lastScrollOffset ? "Down" : "Up";
                const lastScrollDirection = lastScrollDirectionRef.current;
                lastScrollDirectionRef.current = scrollDirection;

                const lastNavigationBarTopOffset = lastNavigationBarTopOffsetRef.current;
                let navigationBarTopOffset = lastNavigationBarTopOffset;

                const lastNavigationBarScrollOffset = clamp(
                    0,
                    lastScrollOffset - lastNavigationBarTopOffset,
                    navigationBarHeight,
                );

                if (scrollDirection !== lastScrollDirection) {
                    navigationBarTopOffset = lastScrollOffset - lastNavigationBarScrollOffset;
                    lastNavigationBarTopOffsetRef.current = navigationBarTopOffset;

                    // Immediately update our sticky positioning CSS to avoid potential jankiness.
                    flushSync(() => {
                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset: Math.max(
                                0,
                                navigationBarTopOffset -
                                    (!isMobile ? desktopMarginTopRem * remPx : 0),
                            ),
                            animateNavigationBar: null,
                        });
                    });
                }

                const navigationBarScrollOffset = clamp(
                    0,
                    scrollOffset - navigationBarTopOffset,
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
                    const lastIsNavigationBarOpaque = lastIsNavigationBarOpaqueRef.current;
                    const lastIsNavigationBarTitleVisible =
                        lastIsNavigationBarTitleVisibleRef.current;

                    const isNavigationBarOpaque = lastIsNavigationBarOpaque
                        ? scrollOffset > 0
                        : scrollOffset >
                          navigationBarHeight + (!isMobile ? desktopMarginTopRem * remPx : 0);

                    const titleBoundaryOffset = getTitleBoundaryOffset(element);

                    const isNavigationBarTitleVisible =
                        withoutDisappearingTitle ||
                        (isNavigationBarOpaque &&
                            (titleBoundaryOffset === null ||
                                scrollOffset >= titleBoundaryOffset - navigationBarHeight) &&
                            (navigationBarScrollOffset >= navigationBarHeight ||
                                lastIsNavigationBarTitleVisible));

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

                            // Render over overlays while opaque.
                            navigationBarContainerElement.style.zIndex = "80";
                        } else {
                            navigationBarBackgroundElement.style.opacity = `${navigationBarScrollPercentage}`;
                            navigationBarBackgroundElement.style.pointerEvents =
                                navigationBarScrollPercentage === 0 ? "none" : "auto";

                            // Render under overlays while translucent.
                            navigationBarContainerElement.style.zIndex = "40";
                        }

                        // If we have a fade out animation running, cancel it.
                        navigationBarBackgroundElement.classList.remove(
                            navigationBarBackgroundFadeOutAnimationClassName,
                        );

                        // NOTE(calebmer): I'm seeing some issues in mobile Safari when using
                        // `scrollTo({behavior: "smooth"})` which is an animation driven by iOS's UI
                        // thread and not the web thread. This causes some jankiness as JavaScript is
                        // behind native so opacity may not be updated in a timely manner.
                        //
                        // I'd love to move these opacity updates to [CSS scroll-driven animations][1]
                        // when they're available in WebKit.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations
                        navigationBarContentElement.style.opacity = `${
                            1 - Math.min(1, navigationBarScrollPercentage * 2)
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

                            // Render under overlays while translucent.
                            navigationBarContainerElement.style.zIndex = "40";
                        } else {
                            navigationBarBackgroundElement.style.opacity = "1";
                            navigationBarBackgroundElement.style.pointerEvents = "auto";

                            navigationBarBackgroundElement.classList.remove(
                                navigationBarBackgroundFadeOutAnimationClassName,
                            );

                            // Render over overlays while opaque.
                            navigationBarContainerElement.style.zIndex = "80";
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

                        const lastIsNavigationBarOpaque = lastIsNavigationBarOpaqueRef.current;
                        const lastIsNavigationBarTitleVisible =
                            lastIsNavigationBarTitleVisibleRef.current;

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
                        let nextIsNavigationBarOpaque: boolean;
                        if (
                            navigationBarHeight - navigationBarScrollOffset >=
                                navigationBarVisibleHeightThresholdForRevealRem * remPx ||
                            scrollOffset >= scrollHeight - clientHeight
                        ) {
                            nextNavigationBarTopOffset = scrollOffset;
                            nextIsNavigationBarOpaque = true;
                        } else {
                            nextNavigationBarTopOffset = Math.max(
                                0,
                                scrollOffset - navigationBarHeight,
                            );
                            // The only time the navigation bar is not opaque is when it's flush with the
                            // top of the view.
                            nextIsNavigationBarOpaque = true;
                        }

                        const titleBoundaryOffset = getTitleBoundaryOffset(element);

                        const nextIsNavigationBarTitleVisible =
                            withoutDisappearingTitle ||
                            (nextIsNavigationBarOpaque &&
                                (titleBoundaryOffset === null ||
                                    scrollOffset >= titleBoundaryOffset - navigationBarHeight));

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
                        lastIsNavigationBarOpaqueRef.current = nextIsNavigationBarOpaque;
                        lastIsNavigationBarTitleVisibleRef.current =
                            nextIsNavigationBarTitleVisible;

                        // We'll animate the navigation bar background's opacity with `motion` in our
                        // effect after the state update but update these non-animatable properties
                        // immediately.
                        if (nextIsNavigationBarOpaque !== lastIsNavigationBarOpaque) {
                            navigationBarBackgroundElement!.style.pointerEvents =
                                nextIsNavigationBarOpaque ? "auto" : "none";
                            navigationBarBackgroundElement!.style.pointerEvents =
                                nextIsNavigationBarOpaque ? "80" : "40";
                            navigationBarBackgroundElement!.classList.remove(
                                navigationBarBackgroundFadeOutAnimationClassName,
                            );
                        }

                        // We'll animate the navigation bar title's opacity with `motion` in our effect
                        // after the state update but update these non-animatable properties
                        // immediately.
                        if (nextIsNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
                            navigationBarTitleElement!.style.pointerEvents =
                                nextIsNavigationBarTitleVisible ? "auto" : "none";
                            navigationBarTitleElement!.classList.remove(
                                navigationBarTitleFadeOutAnimationClassName,
                            );
                        }

                        setScrollDirectionState({
                            scrollDirection,
                            navigationBarTopOffset: Math.max(
                                0,
                                nextNavigationBarTopOffset -
                                    (!isMobile ? desktopMarginTopRem * remPx : 0),
                            ),
                            animateNavigationBar: {
                                translateY: nextNavigationBarTopOffset - lastNavigationBarTopOffset,
                                isOpaque: nextIsNavigationBarOpaque,
                                isTitleVisible: nextIsNavigationBarTitleVisible,
                                lastIsOpaque: lastIsNavigationBarOpaque,
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
        [
            desktopMarginTopRem,
            isMobile,
            navigationBarHeightRem,
            titleBoundaryRef,
            withoutDisappearingTitle,
        ],
    );

    const lastAnimatedScrollDirectionStateRef = useRef(scrollDirectionState);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastAnimatedScrollDirectionStateRef.current === scrollDirectionState) return;
        lastAnimatedScrollDirectionStateRef.current = scrollDirectionState;

        if (!scrollDirectionState.animateNavigationBar) return;

        const navigationBarElement = assertExists(navigationBarRef.current);
        const navigationBarBackgroundElement = assertExists(navigationBarBackgroundRef.current);
        const navigationBarContent = assertExists(navigationBarContentRef.current);
        const navigationBarContentElement = navigationBarContent.getElement();
        const navigationBarTitleElement = navigationBarContent.getTitleElement();

        const {
            translateY,
            isOpaque: isNavigationBarOpaque,
            isTitleVisible: isNavigationBarTitleVisible,
            lastIsOpaque: lastIsNavigationBarOpaque,
            lastIsTitleVisible: lastIsNavigationBarTitleVisible,
        } = scrollDirectionState.animateNavigationBar;

        const doesNavigationBarHaveSafeAreaInsetTop =
            navigationBarBackgroundElement.clientHeight > navigationBarContentElement.clientHeight;

        const timelineDefinition: Parameters<typeof timeline>[0] = [
            [navigationBarElement, {y: [-translateY, 0]}, {easing: "ease-in-out"}],
        ];

        if (doesNavigationBarHaveSafeAreaInsetTop) {
            timelineDefinition.push([
                navigationBarContentElement,
                {opacity: translateY > 0 ? 1 : 0},
                {at: "<", easing: "ease-in"},
            ]);
        }

        if (isNavigationBarOpaque !== lastIsNavigationBarOpaque) {
            timelineDefinition.push([
                navigationBarBackgroundElement,
                {opacity: isNavigationBarOpaque ? 1 : 0},
                {at: "<", easing: "ease-in"},
            ]);
        }

        if (isNavigationBarTitleVisible !== lastIsNavigationBarTitleVisible) {
            timelineDefinition.push([
                navigationBarTitleElement,
                {opacity: isNavigationBarTitleVisible ? 1 : 0},
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

    return (
        <div
            ref={navigationBarContainerRef}
            className={sprinkles({
                // Initial z-index renders under overlays. We update the z-index in JavaScript
                // when the navigation background is opaque.
                zIndex: "40",
            })}
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
                    top: !isMobile && desktopMarginTopRem !== 0 ? `${desktopMarginTopRem}rem` : 0,
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
                    <Box position="relative" zIndex="0" paddingTop="safe-area-inset">
                        <Box
                            ref={navigationBarBackgroundRef}
                            position="absolute"
                            zIndex="-10"
                            inset="0"
                            backgroundColor="grey-0"
                            borderBottom="grey-10"
                            display="flex"
                            justifyContent="center"
                            // Initial opacity is 0. Our code will update the opacity.
                            opacity="0"
                            style={{
                                // In iOS Safari we want our grey border to be 1px lower than the navigation
                                // bar so it still shows even if the navigation bar is completely scrolled up.
                                // That's because Safari on iOS has safe area between the content and the
                                // notch. We'd like our border to render between the content and the safe area.
                                //
                                // This doesn't really work if we're rendering inside of some other app's
                                // in-app browser which shows a header. Is there a condition we can check that
                                // we're not in an in-app browser? Maybe its fine to have a double top border
                                // in these situations.
                                bottom: isMobile && isAppleDevice && !isNativeMobile ? -1 : 0,
                            }}
                        />
                        <NavigationBarContent
                            ref={navigationBarContentRef}
                            withMobileLayout={withMobileLayout}
                            title={title}
                            withDisappearingTitle={!withoutDisappearingTitle}
                            subtitle={subtitle}
                            menuActions={menuActions}
                            shareButton={shareButton}
                            replaceActions={replaceActions}
                            desktopControls={desktopControls}
                            desktopMaxWidth={desktopMaxWidth}
                            desktopTitleMaxWidth={desktopTitleMaxWidth}
                            desktopTitleFontSize={desktopTitleFontSize}
                            desktopTitleFontWeight={desktopTitleFontWeight}
                            desktopTitleLeftSlop={desktopTitleLeftSlop}
                            mobileTitleJustifyContents={mobileTitleJustifyContents}
                            onMobileCancel={onMobileCancel}
                        />
                        {stickyBanner}
                    </Box>
                </div>
            </div>
        </div>
    );
}

export type NavigationBarContentRef = {
    getElement(): HTMLElement;
    getTitleElement(): HTMLElement;
    reconcileFocusedTextInputIfMobile(): void;
};

export const NavigationBarContent = forwardRef(function NavigationBarContent(
    {
        withMobileLayout,
        title,
        withDisappearingTitle = false,
        withoutFocusedTextInputDoneButton = false,
        subtitle,
        menuActions = emptyArray,
        shareButton,
        replaceActions,
        desktopControls,
        desktopMaxWidth: desktopMaxWidthProp,
        desktopTitleMaxWidth: desktopTitleMaxWidthProp,
        desktopTitleFontSize = "200",
        desktopTitleFontWeight = "semi-bold",
        desktopTitleLeftSlop,
        mobileTitleJustifyContents = "center",
        onMobileCancel,
    }: {
        withMobileLayout: boolean;
        title?: ReactNode;
        withDisappearingTitle?: boolean;
        withoutFocusedTextInputDoneButton?: boolean;
        subtitle?: ReactNode;
        menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;
        shareButton?: {};
        replaceActions?: ReactNode;
        desktopControls?: ReactNode;
        desktopMaxWidth?: Spacing | RemLength;
        desktopTitleMaxWidth?: Spacing | RemLength;
        desktopTitleFontSize?: FontSize;
        desktopTitleFontWeight?: "semi-bold" | "bold";
        desktopTitleLeftSlop?: Spacing;
        mobileTitleJustifyContents?: "center" | "flex-start";
        onMobileCancel?: () => void;
    },
    ref: Ref<NavigationBarContentRef>,
) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const showToast = useShowToast();

    const contentRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLDivElement>(null);

    const {isTextInputFocused, reconcileFocusedTextInput} = useIsTextInputFocused({
        isDisabled: !isMobile || withoutFocusedTextInputDoneButton,
    });

    useImperativeHandle(
        ref,
        () => ({
            getElement: () => assertExists(contentRef.current),
            getTitleElement: () => assertExists(titleRef.current),
            reconcileFocusedTextInputIfMobile: reconcileFocusedTextInput,
        }),
        [reconcileFocusedTextInput],
    );

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

    return (
        <Box
            ref={contentRef}
            position="relative"
            zIndex="0"
            width="full"
            height={navigationBarHeight}
            display="flex"
            gap={isMobile ? mobileNavigationBarGap : "5"}
            style={{
                maxWidth: !isMobile ? desktopMaxWidth : undefined,
                margin: !isMobile ? "0 auto" : undefined,
            }}
        >
            <OverlayScopeContextProvider>
                {isMobile ? (
                    <Box
                        flexShrink="0"
                        height={navigationBarHeight}
                        paddingLeft={mobileNavigationBarGap}
                        display="flex"
                        justifyContent="flex-start"
                        alignItems="center"
                        style={{flexBasis: spacing[navigationBarActionsFlexBasis]}}
                        // Gives children `pointer-events: initial` so the user can interact with them.
                        className={pointerEventsNoneNotInheritedClassName}
                    >
                        {onMobileCancel ? (
                            <Box
                                display="flex"
                                justifyContent="flex-start"
                                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
                            >
                                <Button
                                    fontSize="100"
                                    pressErrorTitle="Couldn’t cancel"
                                    onPress={onMobileCancel}
                                >
                                    Cancel
                                </Button>
                            </Box>
                        ) : (
                            <IconButton
                                size="base"
                                description="Go back"
                                withoutTooltip={true}
                                pressErrorTitle="Couldn’t go back"
                                onPress={() => navigate(-1)}
                            >
                                <ArrowLeft />
                            </IconButton>
                        )}
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
                    height={navigationBarHeight}
                    paddingLeft={desktopTitleMaxWidth === undefined && !isMobile ? "5" : undefined}
                    display="flex"
                    justifyContent={isMobile ? mobileTitleJustifyContents : "flex-start"}
                    alignItems="center"
                    gap="3"
                    style={{
                        maxWidth: !isMobile ? desktopTitleMaxWidth : undefined,
                        // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                        // have `min-width: auto` which extends with content.
                        // https://stackoverflow.com/a/66689926/1568890
                        minWidth: 0,
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
                        ref={titleRef}
                        overflow="hidden"
                        // Initial opacity is 0. Our code will update the opacity.
                        opacity={withDisappearingTitle ? "0" : undefined}
                        // Initial pointer events is auto. Our code will update this style.
                        pointerEvents={!withDisappearingTitle ? "auto" : undefined}
                        paddingLeft={
                            !isMobile && desktopTitleLeftSlop !== undefined
                                ? desktopTitleLeftSlop
                                : undefined
                        }
                        marginLeft={
                            !isMobile && desktopTitleLeftSlop !== undefined
                                ? `-${desktopTitleLeftSlop}`
                                : undefined
                        }
                    >
                        <Box
                            overflow="hidden"
                            // We have less space on mobile so use a smaller font size.
                            fontSize={isMobile ? "100" : desktopTitleFontSize}
                            fontStyle={
                                isMobile
                                    ? "truncate-semi-bold"
                                    : `truncate-${desktopTitleFontWeight}`
                            }
                            userSelect={!isMobile ? "text" : undefined}
                            paddingLeft={
                                !isMobile && desktopTitleLeftSlop !== undefined
                                    ? desktopTitleLeftSlop
                                    : undefined
                            }
                            marginLeft={
                                !isMobile && desktopTitleLeftSlop !== undefined
                                    ? `-${desktopTitleLeftSlop}`
                                    : undefined
                            }
                            textAlign={subtitle && isMobile ? "center" : undefined}
                        >
                            {title}
                        </Box>
                        {subtitle && (
                            <Box
                                fontSize="50"
                                color="grey-50"
                                fontStyle="truncate"
                                userSelect={!isMobile ? "text" : undefined}
                                textAlign={!isMobile ? undefined : "center"}
                            >
                                {subtitle}
                            </Box>
                        )}
                    </Box>
                </Box>
                <Box
                    flexGrow={!isMobile ? "1" : undefined}
                    flexShrink="0"
                    height={navigationBarHeight}
                    paddingRight={isMobile ? mobileNavigationBarGap : "5"}
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                    gap={isMobile ? "0.5" : "2"}
                    // Gives children `pointer-events: initial` so the user can interact with them.
                    className={pointerEventsNoneNotInheritedClassName}
                    style={{flexBasis: spacing[navigationBarActionsFlexBasis]}}
                >
                    {replaceActions ? (
                        replaceActions
                    ) : (
                        <>
                            {shareButton && !withMobileLayout && (
                                <Box paddingRight="3">
                                    <ShareButton />
                                </Box>
                            )}
                            {isTextInputFocused ? (
                                // If a text input is focused then we hide menu actions and replace it with a
                                // "Done" button. This helps the user see how to end their editing session.
                                // Opening menu actions would cause the text input to unfocus anyway.
                                <Button
                                    fontSize="100"
                                    // Don't remove focus from the current text input element
                                    // on press start. Remove focus on press finish.
                                    isFocusable={false}
                                    onPress={() => {
                                        if (document.activeElement instanceof HTMLElement) {
                                            document.activeElement.blur();
                                        }
                                    }}
                                >
                                    <Box display="inline" fontStyle="semi-bold" color="grey-70">
                                        Done
                                    </Box>
                                </Button>
                            ) : (
                                (menuActions.length > 0 || (shareButton && withMobileLayout)) && (
                                    <MenuButton
                                        placement="bottom-end"
                                        actions={
                                            shareButton && withMobileLayout
                                                ? [
                                                      [createShareMenuItem({showToast})],
                                                      ...menuActions,
                                                  ]
                                                : menuActions
                                        }
                                    >
                                        <IconButton
                                            size={isMobile ? "base" : "md"}
                                            description="More"
                                            withoutTooltip={true}
                                        >
                                            <DotsThreeVertical
                                            // Vertical dots create better visual balance on mobile because:
                                            //
                                            // 1. On mobile we have a back button on the left and we want this button to
                                            //    look aligned with that
                                            // 2. The title might be truncated with ellipsis which looks like horizontal
                                            //    dots
                                            />
                                        </IconButton>
                                    </MenuButton>
                                )
                            )}
                        </>
                    )}
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
});
