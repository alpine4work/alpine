import {useCallback, useMemo, useRef} from "react";
import {flushSync} from "react-dom";
import {
    dispatchNavigationBarPrepareSmoothScrollToEventEmitter,
    flushNavigationBarScrollEventEmitter,
    navigationBarHeight,
} from "~/client/design/navigation_bar_helpers.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {NavigationBar} from "~/client/navigation/internal/navigation_bar_internal.js";
import {NavigationBarProps, NavigationBarResult} from "~/client/navigation/navigation_bar_types.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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
export function useNavigationBar({
    ref,
    isDisabled = false,
    withScrollAway,
    title = null,
    getTitleBoundaryElement,
    titleBoundaryMarginTop,
    withoutDisappearingTitle = false,
    subtitle,
    menuActions = emptyArray,
    menuOffset,
    contextMenuActions = emptyArray,
    shareButton,
    withWideRouteLayoutShareMenuItem = false,
    replaceActions,
    titleJustifyContent,
    desktopControls = null,
    desktopMaxWidth,
    desktopTitleMaxWidth,
    desktopTitleMaxWidthCenterOffset,
    desktopTitleFontSize = "200",
    desktopTitleFontWeight = "semi-bold",
    desktopTitleLeftSlop,
    desktopAdditionalActions,
    withoutMobileBackButton = false,
    contentCover,
    onMobileClose,
    onMobileCancel,
}: NavigationBarProps): NavigationBarResult {
    const platform = usePlatform();

    withScrollAway ??= platform === "mobile";

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

                const handleScrollFromEmitter = (targetElement: HTMLElement) => {
                    if (targetElement === element) {
                        assertExists(navigationBarRef.current).onScroll(element);
                    }
                };

                const handlePrepareSmoothScrollTo = ({
                    element: targetElement,
                    scrollTop,
                }: {
                    element: HTMLElement;
                    scrollTop: number;
                }) => {
                    if (targetElement === element) {
                        assertExists(navigationBarRef.current).onPrepareSmoothScrollTo(
                            element,
                            scrollTop,
                        );
                    }
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
                        flushNavigationBarScrollEventEmitter.addListener(handleScrollFromEmitter);
                        dispatchNavigationBarPrepareSmoothScrollToEventEmitter.addListener(
                            handlePrepareSmoothScrollTo,
                        );

                        cleanup = () => {
                            removeResizeListenerForElement(element, handleResize);
                            element.removeEventListener("scroll", handleScroll);
                            flushNavigationBarScrollEventEmitter.removeListener(
                                handleScrollFromEmitter,
                            );
                            dispatchNavigationBarPrepareSmoothScrollToEventEmitter.removeListener(
                                handlePrepareSmoothScrollTo,
                            );
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

    const navigationBar = !isDisabled ? (
        <NavigationBar
            handleRef={navigationBarRef}
            navigationBarRef={ref}
            withScrollAway={withScrollAway}
            title={title}
            getTitleBoundaryElement={getTitleBoundaryElement}
            titleBoundaryMarginTop={titleBoundaryMarginTop}
            withoutDisappearingTitle={withoutDisappearingTitle}
            subtitle={subtitle}
            menuActions={menuActions}
            menuOffset={menuOffset}
            contextMenuActions={contextMenuActions}
            shareButton={shareButton}
            withWideRouteLayoutShareMenuItem={withWideRouteLayoutShareMenuItem}
            replaceActions={replaceActions}
            titleJustifyContent={titleJustifyContent}
            desktopControls={desktopControls}
            desktopMaxWidth={desktopMaxWidth}
            desktopTitleMaxWidth={desktopTitleMaxWidth}
            desktopTitleMaxWidthCenterOffset={desktopTitleMaxWidthCenterOffset}
            desktopTitleFontSize={desktopTitleFontSize}
            desktopTitleFontWeight={desktopTitleFontWeight}
            desktopTitleLeftSlop={desktopTitleLeftSlop}
            desktopAdditionalActions={desktopAdditionalActions}
            withoutMobileBackButton={withoutMobileBackButton}
            contentCover={contentCover}
            onMobileClose={onMobileClose}
            onMobileCancel={onMobileCancel}
        />
    ) : null;

    return {
        scrollViewRef,
        navigationBar,
        scrollbarInsetTop: useMemo(
            () => (!isDisabled ? [spacing[navigationBarHeight], {withSafeArea: true}] : undefined),
            [isDisabled],
        ),
    };
}
