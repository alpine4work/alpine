import {
    Key,
    Memo,
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer";
import {useClientInfo} from "~/client/remix/client_info_context";
import {
    VirtualizedScrollViewState,
    initialVirtualizedScrollViewRenderFillScreenCount,
} from "~/client/virtualized/virtualized_scroll_view_state";
import {RemLength, convertRemLengthToPx, getRemPxFromScreenWidth} from "~/shared/design/spacing";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {safe} from "~/shared/helpers/string/safe_string";
import {ClientInfo} from "~/shared/remix/client_info";
import {sprinkles} from "~/shared/styles/styles";

/**
 * How many items will the virtualized scroll view initially render assuming
 * every item has the same minimum height?
 */
export function getInitialVirtualizedScrollViewRenderedItemCount(
    clientInfo: ClientInfo,
    minItemHeight: number | RemLength,
) {
    const remPx = getRemPxFromScreenWidth(clientInfo.screenWidth);
    const minItemHeightPx =
        typeof minItemHeight === "string"
            ? convertRemLengthToPx(minItemHeight, remPx)
            : minItemHeight;

    return Math.ceil(
        (clientInfo.screenHeight * initialVirtualizedScrollViewRenderFillScreenCount) /
            minItemHeightPx,
    );
}

/**
 * An item rendered by the scroll view.
 */
export type VirtualizedScrollViewItem = {
    /**
     * The key of the item. Items may be re-ordered so indexes are not stable
     * but the key should provided a stable identifier for the item.
     */
    readonly key: Key;
    /**
     * The minimum height of the item. Must be greater than zero. We use this when
     * we don't know the real height of the item to determine how many items we
     * need to render. For example when server rendering or when scrolling new
     * items on-screen we use the minimum height to decide how many items to
     * render.
     *
     * Using the minimum height in this way will mean we generally render more
     * items than necessary. But it's better to over-render then to under-render
     * and show the user blank space.
     *
     * May be measured in pixels or REM units.
     */
    readonly minHeight: number | RemLength;
    /**
     * The actual rendered React component for this item.
     */
    readonly node: ReactNode;
};

export type VirtualizedScrollViewRef = {
    /**
     * Get the height of the scroll view.
     */
    getHeight(): number;
};

const VirtualizedScrollViewForwardRef = forwardRef(VirtualizedScrollView);
export {VirtualizedScrollViewForwardRef as VirtualizedScrollView};

/**
 * Component for rendering a large list of items. Web browsers start to slow
 * down when you have hundreds of thousands of DOM nodes so virtualization is a
 * technique where you only render items visible to the user. Then as the user
 * scrolls you render new items and unmount items that are offscreen.
 *
 * Features:
 *
 * - Variable item height: Each item can have a different height. We estimate
 *   the total height of the list by looking at previously rendered item
 *   heights.
 *
 * - Dynamic item height: You don't need to statically know what the height of
 *   your item is. You provide a minimum height for every item and the list
 *   will measure the actual item heights automatically.
 *
 * - Resizable item height: The list watches for item resizes and will rerender
 *   if any item's height changes. Correctly re-positioning items that come after.
 *
 * - Server-side rendering: Can be initially rendered on the server then
 *   hydrated on the client before knowing anything about client screen height.
 *
 * - Pin to bottom scrolling: By default when content is inserted into a scrollable
 *   element, the browser keeps the top edge of the scroll window constant. However
 *   for products where the user starts at the bottom of the scroll element and
 *   scrolls up (like chat) it is sometimes desirable to keep the bottom edge of
 *   the scroll window constant instead. We provided this configuration with the
 *   `pinTo` prop.
 *
 * There are many virtualized list implementations like [`react-window`][1],
 * [`react-virtualized`][2], and the [React Native Web][3] virtualized lists.
 * However supporting the above feature set is uncommon. These libraries
 * typically need to know the height of items ahead-of-time and if an item
 * height changes it can cause potentially expensive layout changes as all
 * following items need to be measured again.
 *
 * This component is backed by immutable data structures which let us make
 * efficient incremental updates to item sizes.
 *
 * This component is also well integrated with the rest of our React component
 * system. It leverages `ClientInfo` during server-side rendering to determine
 * how much initial content to render, for instance. It's equipped for our
 * product.
 *
 * [1]: https://github.com/bvaughn/react-window
 * [2]: https://github.com/bvaughn/react-virtualized
 * [3]: https://necolas.github.io/react-native-web/docs/lists/
 */
function VirtualizedScrollView(
    {
        itemCount,
        renderItem: _renderItem,
        bufferedItemHeight: _bufferedItemHeight,
        pinTo = "top",
    }: {
        /**
         * The total number of virtualized items. You do not need all the items loaded
         * in memory but you should be able to render something (like a loading
         * shimmer) whenever `getItem` is called.
         */
        itemCount: number;

        /**
         * Render one of the items in our scroll view.
         *
         * The virtualized scroll view will only render a subset of items at any time.
         * This function may never be called for some items. Just because this function
         * is called does not mean the item is rendered! The virtualized list may be
         * trying to learn more about the shape of the list.
         *
         * We recommend memoizing this function with `useCallback()`.
         */
        renderItem: Memo<(index: number) => VirtualizedScrollViewItem>;

        /**
         * The height we use for items we have never rendered. We'll use this to
         * calculate the scroll view content's height without rendering every item.
         * Once items are scrolled into frame we can use their proper height instead of
         * the buffered height.
         */
        bufferedItemHeight: number | RemLength;

        /**
         * When the size of our scroll view's content changes, should we pin the
         * scroll window to the top of the scroll view or the bottom of the scroll
         * view?
         *
         * If set to `bottom` we will also scroll the view to the bottom when it loads.
         *
         * The browser default is to pin the window to the top of the scroll view.
         * That means the number of pixels from the scroll view top to the scroll
         * window top is kept constant.
         *
         * However, for some interfaces (like a chat interface) where content is added
         * to the bottom of the scroll view we instead want to pint the window to the
         * bottom of the scroll view. So the number of pixels from the scroll view
         * bottom to the scroll bottom is kept constant.
         */
        pinTo?: "top" | "bottom";
    },
    ref: Ref<VirtualizedScrollViewRef>,
) {
    const {screenHeight} = useClientInfo();
    const remPx = useRemPx();

    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
        ref,
        (): VirtualizedScrollViewRef => ({
            getHeight: () => assertExists(scrollRef.current).clientHeight,
        }),
        [],
    );

    const {scriptElement: pinToScriptElement} = useScrollViewPinTo(scrollRef, contentRef, pinTo);

    // Cache the `getItem` function as long as the function reference doesn't
    // change.
    const getItemWithoutRender = useMemo(() => {
        const itemByIndex = new Map<number, {key: Key; minHeight: number; node: ReactNode}>();

        return (index: number): {key: Key; minHeight: number; node: ReactNode} =>
            getOrSetDefaultMapValue(itemByIndex, index, () => {
                const item = _renderItem(index);
                return {
                    key: item.key,
                    minHeight:
                        typeof item.minHeight === "string"
                            ? convertRemLengthToPx(item.minHeight, remPx)
                            : item.minHeight,
                    node: item.node,
                };
            });
    }, [_renderItem, remPx]);

    const bufferedItemHeight = useMemo(
        () =>
            typeof _bufferedItemHeight === "string"
                ? convertRemLengthToPx(_bufferedItemHeight, remPx)
                : _bufferedItemHeight,
        [_bufferedItemHeight, remPx],
    );

    const [originalState, setState] = useState<{
        state: VirtualizedScrollViewState;
        shouldUpdateRenderedRange: boolean;
        isJumpScrolling: boolean;
    }>(() => {
        if (pinTo === "top") {
            return {
                state: VirtualizedScrollViewState.initializeFromTop({
                    screenHeight,
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                shouldUpdateRenderedRange: false,
                isJumpScrolling: false,
            };
        } else {
            return {
                state: VirtualizedScrollViewState.initializeFromBottom({
                    screenHeight,
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                shouldUpdateRenderedRange: false,
                isJumpScrolling: false,
            };
        }
    });
    let {state} = originalState;

    // Update the buffered item height in our state based on our props if
    // necessary.
    state = state.setBufferedItemHeight(bufferedItemHeight);

    const itemsRef = useRef<{
        hasScheduledCleanup: boolean;
        generation: number;
        elementRefByKey: Map<
            Key,
            {generation: number; element: HTMLDivElement; cleanup: () => void}
        >;
    }>({
        hasScheduledCleanup: false,
        generation: 1,
        elementRefByKey: new Map(),
    });

    // We don't know the heights of elements when server-side rendering so we
    // should render with relative positioning. Then when client rendering kicks in
    // we'll render with absolute positioning.
    //
    // We need to render with absolute positioning in order to accomplish virtual
    // scrolling so that we can remove rendered items from the top of the list
    // while maintaining the position of items lower in the list.
    const shouldRenderWithRelativePositioning = useIsInitialAppRender();

    const {
        state: newStateAfterRender,
        children,
        contentHeight,
        bufferedHeightBeforeChildren,
    } = state.render({
        itemCount,
        getItem: (
            index: number,
        ): {key: Key; minHeight: number; render: (offset: number) => ReactNode} => {
            const item = getItemWithoutRender(index);
            return {
                key: item.key,
                minHeight: item.minHeight,
                render: offset => (
                    <div
                        key={item.key}
                        style={{
                            minHeight: item.minHeight,
                            ...(shouldRenderWithRelativePositioning
                                ? {position: "relative"}
                                : {
                                      position: "absolute",
                                      top: offset,
                                      left: 0,
                                      right: 0,
                                  }),
                        }}
                        // Listen to the element's height with a resize observer so we can correctly
                        // position items. The resize observer will notify us whenever the height
                        // changes.
                        ref={element => {
                            // To make sure `itemsRef` doesn't grow forever, we occasionally clean it up.
                            // We need to wait for all `ref`s to fire in this render to know which refs are
                            // actually unused now.
                            if (!itemsRef.current.hasScheduledCleanup) {
                                itemsRef.current.hasScheduledCleanup = true;
                                itemsRef.current.generation++;

                                scheduleAfterNextBrowserPaint(() => {
                                    itemsRef.current.hasScheduledCleanup = false;

                                    for (const [key, elementRef] of itemsRef.current
                                        .elementRefByKey) {
                                        // If this ref is a part of the current generation it will not be
                                        // cleaned up.
                                        if (elementRef.generation === itemsRef.current.generation)
                                            continue;

                                        elementRef.cleanup();
                                        itemsRef.current.elementRefByKey.delete(key);
                                    }
                                });
                            }

                            // Ref cleanup is handled in batch above.
                            if (!element) return;

                            const elementRef = itemsRef.current.elementRefByKey.get(item.key);

                            // If the element hasn't change for this item key, update the ref to the
                            // current generation so it doesn't get cleaned up.
                            if (elementRef && elementRef.element === element) {
                                elementRef.generation = itemsRef.current.generation;
                            }
                            // Otherwise, cleanup the old ref (if it exists) and observe the height of the
                            // new element.
                            else {
                                elementRef?.cleanup();

                                let lastHeight = element.offsetHeight;
                                setState(({state, isJumpScrolling}) => ({
                                    state: state.setItemHeight(item.key, lastHeight),
                                    shouldUpdateRenderedRange: true,
                                    isJumpScrolling,
                                }));

                                const handleResize = (entry: ResizeObserverEntry) => {
                                    const height = entry.contentRect.height;
                                    if (height !== lastHeight) {
                                        setState(({state, isJumpScrolling}) => ({
                                            state: state.setItemHeight(item.key, lastHeight),
                                            shouldUpdateRenderedRange: true,
                                            isJumpScrolling,
                                        }));
                                        lastHeight = height;
                                    }
                                };

                                addResizeListenerForElement(element, handleResize);

                                itemsRef.current.elementRefByKey.set(item.key, {
                                    generation: itemsRef.current.generation,
                                    element,
                                    cleanup: () => {
                                        removeResizeListenerForElement(element, handleResize);
                                    },
                                });
                            }
                        }}
                    >
                        {item.node}
                    </div>
                ),
            };
        },
    });

    state = newStateAfterRender;

    const hasHandledScrollThisAnimationFrameRef = useRef(false);
    const lastScrollTopRef = useRef<number | null>(null);
    const jumpScrollDebounceTimerRef = useRef<Timeout | null>(null);

    const handleScroll = () => {
        // Only handle scroll events once per animation frame.
        if (hasHandledScrollThisAnimationFrameRef.current) return;
        hasHandledScrollThisAnimationFrameRef.current = true;
        requestAnimationFrame(() => {
            hasHandledScrollThisAnimationFrameRef.current = false;
        });

        const {scrollTop, clientHeight} = assertExists(scrollRef.current);

        // If the user starts scrolling really fast we enter a jump scroll state. We
        // will not update the rendered range until after the jump scroll has finished
        // to maintain high performance as the user jumps through the scrollable view.
        const isJumpScrollStart =
            lastScrollTopRef.current !== null &&
            Math.abs(lastScrollTopRef.current - scrollTop) > clientHeight;

        if (isJumpScrollStart || jumpScrollDebounceTimerRef.current !== null) {
            jumpScrollDebounceTimerRef.current?.clear();
            jumpScrollDebounceTimerRef.current = createTimeout(() => {
                const {scrollTop} = assertExists(scrollRef.current);

                setState(previousState => {
                    if (!previousState.isJumpScrolling) return previousState;
                    return {
                        state: previousState.state.updateRenderedRange({
                            scrollOffset: scrollTop,
                            itemCount,
                            getItem: getItemWithoutRender,
                        }),
                        shouldUpdateRenderedRange: false,
                        isJumpScrolling: false,
                    };
                });
            }, perceivedAsInstantLimitMs);
        }

        lastScrollTopRef.current = scrollTop;

        setState(previousState => {
            if (previousState.isJumpScrolling || isJumpScrollStart) {
                if (previousState.isJumpScrolling) return previousState;
                return {...previousState, isJumpScrolling: true};
            } else {
                return {
                    state: previousState.state.updateRenderedRange({
                        scrollOffset: scrollTop,
                        itemCount,
                        getItem: getItemWithoutRender,
                    }),
                    shouldUpdateRenderedRange: false,
                    isJumpScrolling: false,
                };
            }
        });
    };

    // Make sure any state changes in our render function are reflected back in
    // state. We need to update the rendered range because maybe the buffered item
    // height changed or maybe the list was truncated and visible items were
    // deleted.
    if (state !== originalState.state) {
        setState({
            state,
            shouldUpdateRenderedRange: true,
            isJumpScrolling: originalState.isJumpScrolling,
        });
    }

    // If there were any state changes in our render function then re-compute the
    // rendered range.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (originalState.shouldUpdateRenderedRange && !originalState.isJumpScrolling) {
            const {scrollTop} = assertExists(scrollRef.current);

            setState(previousState => {
                if (previousState.isJumpScrolling || !previousState.shouldUpdateRenderedRange)
                    return previousState;

                return {
                    state: previousState.state.updateRenderedRange({
                        scrollOffset: scrollTop,
                        itemCount,
                        getItem: getItemWithoutRender,
                    }),
                    shouldUpdateRenderedRange: false,
                    isJumpScrolling: false,
                };
            });
        }
    }, [state, originalState, itemCount, getItemWithoutRender]);

    return (
        <>
            <div
                ref={scrollRef}
                className={sprinkles({
                    position: "relative",
                    height: "full",
                    overflowX: "hidden",
                    overflowY: "scroll",
                })}
                onScroll={handleScroll}
            >
                <div style={{height: contentHeight}} />
                <div
                    ref={contentRef}
                    // NOTE(calebmer): We render our virtualized list in an absolutely positioned
                    // container because we find it helps avoid some jankiness on initial load with
                    // `pinTo="bottom"`. It is unclear to me why this is the fix.
                    style={{position: "absolute", left: 0, right: 0, top: 0, height: contentHeight}}
                >
                    {shouldRenderWithRelativePositioning && bufferedHeightBeforeChildren > 0 && (
                        <div style={{height: bufferedHeightBeforeChildren}} />
                    )}
                    {children}
                </div>
            </div>
            {pinToScriptElement}
        </>
    );
}

function useScrollViewPinTo(
    scrollRef: RefObject<HTMLDivElement>,
    contentRef: RefObject<HTMLDivElement>,
    pinTo: "top" | "bottom",
): {scriptElement: ReactNode} {
    const pinToRef = useRef(pinTo);
    const onLayoutEffectRef = useRef<(() => void) | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        pinToRef.current = pinTo;
        onLayoutEffectRef.current?.();
    });

    // This layout effect is safe because in server side renders we include a
    // `<script>` (see below) that scrolls our element to the bottom.
    //
    // We only want to perform an initial scroll on our initial render.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (pinToRef.current === "bottom") {
            const scrollElement = assertExists(scrollRef.current);
            scrollElement.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
        }
    }, [scrollRef]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (pinTo !== "bottom") return;

        const scrollElement = assertExists(scrollRef.current);
        const contentElement = assertExists(contentRef.current);

        const getScrollBottom = () =>
            scrollElement.scrollHeight - (scrollElement.scrollTop + scrollElement.clientHeight);

        let scrollBottom = getScrollBottom();

        const handleScroll = () => {
            scrollBottom = getScrollBottom();
        };

        let lastInteractionEventTimeMs: number;

        const handleInteraction = () => {
            lastInteractionEventTimeMs = Date.now();
        };

        const handleResize = () => {
            // When focus is within the scroll view, always pin to top. Users
            // typically expect the top of whatever elements they're interacting with
            // to stay in place.
            if (document.activeElement && scrollElement.contains(document.activeElement)) {
                return;
            }

            // If the user just interacted with the scroll view either through their
            // mouse or their keyboard then we want to pin to top. Users
            // typically expect the top of whatever elements they're interacting with
            // to stay in place.
            if (
                lastInteractionEventTimeMs !== undefined &&
                Date.now() - lastInteractionEventTimeMs < perceivedAsInstantLimitMs
            ) {
                return;
            }

            // Fix the scroll position so that instead of holding
            // `scrollElement.scrollTop` constant, we hold the virtual
            // `scrollElement.scrollBottom` constant (a `scrollBottom` property
            // doesn’t actually exist in the DOM).
            scrollElement.scrollTop =
                scrollElement.scrollHeight - scrollElement.clientHeight - scrollBottom;
        };

        const observer = new ResizeObserver(handleResize);

        onLayoutEffectRef.current = handleResize;
        observer.observe(scrollElement, {box: "border-box"});
        observer.observe(contentElement, {box: "border-box"});
        scrollElement.addEventListener("scroll", handleScroll);
        scrollElement.addEventListener("keydown", handleInteraction);
        scrollElement.addEventListener("keyup", handleInteraction);
        scrollElement.addEventListener("mousedown", handleInteraction);
        scrollElement.addEventListener("mouseup", handleInteraction);
        scrollElement.addEventListener("pointerdown", handleInteraction);
        scrollElement.addEventListener("pointerup", handleInteraction);
        return () => {
            onLayoutEffectRef.current = null;
            observer.unobserve(scrollElement);
            observer.unobserve(contentElement);
            scrollElement.removeEventListener("scroll", handleScroll);
            scrollElement.removeEventListener("keydown", handleInteraction);
            scrollElement.removeEventListener("keyup", handleInteraction);
            scrollElement.removeEventListener("mousedown", handleInteraction);
            scrollElement.removeEventListener("mouseup", handleInteraction);
            scrollElement.removeEventListener("pointerdown", handleInteraction);
            scrollElement.removeEventListener("pointerup", handleInteraction);
        };
    }, [contentRef, pinTo, scrollRef]);

    return {
        scriptElement:
            pinTo === "bottom" ? (
                // When server side rendering this component, we want it to be
                // immediately scrolled to the bottom. There should be no flash where
                // the element is scrolled to the top.
                //
                // That means we need to scroll the element to the bottom before our
                // JavaScript code loads and React component mounts. So inject a small
                // `<script>` element in the page on server side render to do just that.
                //
                // We set the scroll position in a `requestAnimationFrame()` because we need to
                // set the scroll position before the first browser render but after other
                // elements in the DOM have been lain out.
                <ScriptBeforeAppInitialRender
                    script={safe`var element = document.currentScript.previousElementSibling; requestAnimationFrame(function () { element.scrollTop = element.scrollHeight - element.clientHeight; })`}
                />
            ) : null,
    };
}
