import {ReactNode, RefCallback, useCallback, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

type ScrollDirectionState = {
    readonly scrollDirection: "Up" | "Down";
    readonly navigationBarTopOffset: number;
};

const initialScrollDirectionState: ScrollDirectionState = {
    scrollDirection: "Down",
    navigationBarTopOffset: 0,
};

const navigationBarHeight = "32";
const navigationBarHeightRem = parseRemLengthNumber(spacing[navigationBarHeight]);

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
export function useNavigationBar(): {
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
} {
    const lastScrollOffsetRef = useRef(0);
    const [scrollDirectionState, setScrollDirectionState] = useState<ScrollDirectionState>(
        initialScrollDirectionState,
    );

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
                let scrollOffset = element.scrollTop;

                // Clamp scroll offset so it's not affected by overscroll at the top of the
                // scroll view. Overscroll at the bottom of the scroll view is desired! We want
                // the top bar (which should be collapsed) to continue with the scroll window
                // when at the bottom of the view.
                //
                // This also creates a neat effect where when the overscroll bounces back the
                // navigation bar is revealed. If the user is at the end of the scroll view
                // they probably need the navigation bar to navigate out.
                scrollOffset = Math.max(0, scrollOffset);

                const lastScrollOffset = lastScrollOffsetRef.current;
                lastScrollOffsetRef.current = scrollOffset;

                setScrollDirectionState(scrollDirectionState => {
                    const newScrollDirection = scrollOffset > lastScrollOffset ? "Down" : "Up";

                    if (scrollDirectionState.scrollDirection === newScrollDirection)
                        return scrollDirectionState;

                    const navigationBarHeight = navigationBarHeightRem * getRemPxWithoutListening();

                    if (newScrollDirection === "Down") {
                        const navigationBarScrollOffset = clamp(
                            0,
                            scrollOffset - scrollDirectionState.navigationBarTopOffset,
                            navigationBarHeight,
                        );

                        const navigationBarTopOffset = scrollOffset - navigationBarScrollOffset;

                        return {
                            scrollDirection: "Down",
                            navigationBarTopOffset,
                        };
                    } else {
                        const navigationBarScrollOffset =
                            clamp(
                                scrollDirectionState.navigationBarTopOffset - navigationBarHeight,
                                scrollOffset,
                                scrollDirectionState.navigationBarTopOffset + navigationBarHeight,
                            ) - scrollDirectionState.navigationBarTopOffset;

                        const navigationBarTopOffset = scrollOffset - navigationBarScrollOffset;

                        return {
                            scrollDirection: "Up",
                            navigationBarTopOffset,
                        };
                    }
                });
            };

            // Immediately populate the content rect with our element's dimensions
            // on mount.
            handleResize();

            addResizeListenerForElement(element, handleResize);
            element.addEventListener("scroll", handleScroll);

            return () => {
                element.removeEventListener("scroll", handleScroll);
                removeResizeListenerForElement(element, handleResize);
            };
        }, []),
    );

    const navigationBar = (
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
                <Box
                    position="sticky"
                    width="full"
                    backgroundColor="grey-10"
                    opacity="60"
                    style={{
                        height: `calc(${
                            scrollViewSize?.height ?? 0
                        }px + ${navigationBarHeightRem}rem)`,
                        ...(scrollDirectionState.scrollDirection === "Down"
                            ? {top: `-${navigationBarHeightRem}rem`}
                            : {bottom: `-${navigationBarHeightRem}rem`}),
                    }}
                >
                    <Box width="full" height={navigationBarHeight} backgroundColor="red-10"></Box>
                    <Box
                        width="full"
                        backgroundColor="red-20"
                        style={{height: "var(--safe-area-inset-top)"}}
                    ></Box>
                </Box>
            </div>
        </div>
    );

    return {scrollViewRef, navigationBar};
}
