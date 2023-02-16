import {
    Key,
    Memo,
    ReactElement,
    ReactNode,
    Ref,
    cloneElement,
    forwardRef,
    startTransition,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
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
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
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

type VirtualizedScrollViewItemBase = {
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
     * If this item is rendered then we will also render the items at the indexes
     * provided in this array even if they are not in the virtualized window.
     * Useful for implementing sticky section headers.
     */
    readonly renderAdditionalItemIndexes?: ReadonlyArray<number>;
};

/**
 * An item rendered by the scroll view.
 */
export type VirtualizedScrollViewItem =
    | (VirtualizedScrollViewItemBase & {
          /**
           * The actual rendered React component for this item.
           */
          readonly node: ReactNode;
          readonly withManualLayout?: undefined;
      })
    | (VirtualizedScrollViewItemBase & {
          readonly withManualLayout: true;
          /**
           * Manually render the wrapper `<div>` to position the item with a render
           * function.
           *
           * The default implementation is:
           *
           * ```ts
           * <div
           *     ref={ref}
           *     style={{
           *         minHeight: item.minHeight,
           *         ...(shouldRenderWithRelativePositioning
           *             ? {position: "relative"}
           *             : {
           *                   position: "absolute",
           *                   top: offset,
           *                   left: 0,
           *                   right: 0,
           *               }),
           *     }}
           * >
           *     {item.node}
           * </div>
           * ```
           *
           * You should attach the `ref` so React can detect item size changes. If you
           * don't the item will use the `minHeight` as the item's constant height.
           *
           * `shouldRenderWithRelativePositioning` is set to true when server-side rendering. We
           * don't know the heights of elements in the component so we lay items out relative to
           * each other and let the browser perform layout.
           */
          readonly render: (props: {
              ref: Ref<HTMLDivElement>;
              offset: number;
              height: number;
              shouldRenderWithRelativePositioning: boolean;
              getPositionByIndex: (index: number) => {offset: number; height: number};
              isScrolling: boolean;
          }) => ReactElement;
      });

export type VirtualizedScrollViewRef = {
    /**
     * Get the height of the scroll view.
     */
    getHeight(): number;

    /**
     * Return the current rendered range. This is the same value we pass into
     * `onRenderedRangeChange`.
     */
    getRenderedRange(): {startIndex: number; endIndex: number} | null;

    /**
     * Scroll so the provided index is visible. Will throw an error if the index is
     * out of bounds.
     */
    scrollToIndex(index: number): void;

    /**
     * Look at what the rendered range will be after calling `scrollToIndex()`.
     * This does not actually scroll the view but rather lets you peek into the
     * future for preloading data at a given index.
     */
    peekRenderedRangeAfterScrollToIndex(
        index: number,
    ): {startIndex: number; endIndex: number} | null;
};

const VirtualizedScrollViewForwardRef = forwardRef(VirtualizedScrollView);
export {VirtualizedScrollViewForwardRef as VirtualizedScrollView};

type VirtualizedScrollViewActualState = {
    readonly state: VirtualizedScrollViewState;
    readonly isScrolling: boolean;
    readonly isJumpScrolling: boolean;
};

export type VirtualizedScrollViewRenderItem = Memo<(index: number) => VirtualizedScrollViewItem>;

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
 * - Scroll anchoring: Browser's implement a [scroll anchoring][4] algorithm so
 *   that layout shifts above the content a user is viewing does not disrupt
 *   the user's reading. This behavior is even more important for a virtualized
 *   list implementation where we don't know the heights of items until we
 *   render them. As a user scrolls from bottom to top content will continually
 *   jump as we measure items without scroll anchoring. However, scroll
 *   anchoring does not work for scrollable elements with absolutely positioned
 *   children so we need to reimplement scroll anchoring in user land for the
 *   best experience.
 *
 *   Additionally, iOS Safari does not support scroll anchoring at all and
 *   changing the scroll offset during a scroll disrupts scrolling animations!
 *   So we need custom workarounds for smooth scrolling on iOS.
 *
 * - Initial scroll to bottom: For interfaces like a chat interface, we want to
 *   initially scroll the user to the bottom of the view instead of the top.
 *   Both on client and server.
 *
 * - Advanced escape hatches: Advanced props that allow you to break out of
 *   normal operation for rendering things like sticky headers/footers.
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
 * [4]: https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md
 */
function VirtualizedScrollView(
    {
        itemCount,
        renderItem: _renderItem,
        bufferedItemHeight: _bufferedItemHeight,
        onRenderedRangeChange: _onRenderedRangeChange,
        onScroll,
        extraChildren,
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
        renderItem: VirtualizedScrollViewRenderItem;

        /**
         * The height we use for items we have never rendered. We'll use this to
         * calculate the scroll view content's height without rendering every item.
         * Once items are scrolled into frame we can use their proper height instead of
         * the buffered height.
         */
        bufferedItemHeight: number | RemLength;

        /**
         * Called on initial mount and again whenever the range of rendered items
         * changes. If no items are rendered then this will be called with `null` for
         * the range object. The range is inclusive of both the start and end index.
         */
        onRenderedRangeChange?: (range: {startIndex: number; endIndex: number} | null) => void;

        /**
         * Called whenever the scroll position changes. Remember that the scroll event
         * is asynchronous with the browser renderer so be careful tying effects to the
         * scroll position.
         */
        onScroll?: (scrollOffset: number) => void;

        /**
         * Extra children to always render in our virtualized scroll view. Useful if
         * you want to render extra sticky content.
         *
         * The children are rendered in a container with no pointer events. So you need
         * to add `pointerEvents: "auto"` on elements you want to be interactive with
         * a pointer.
         */
        extraChildren?: ReactNode;
    },
    ref: Ref<VirtualizedScrollViewRef>,
) {
    const {screenHeight} = useClientInfo();
    const remPx = useRemPx();

    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Cache the `getItem` function as long as the function reference doesn't
    // change.
    const getItemWithoutRender = useMemo(() => {
        const itemByIndex = new Map<
            number,
            DistributiveOmit<VirtualizedScrollViewItem, "minHeight"> & {minHeight: number}
        >();

        return (
            index: number,
        ): DistributiveOmit<VirtualizedScrollViewItem, "minHeight"> & {minHeight: number} =>
            getOrSetDefaultMapValue(itemByIndex, index, () => {
                const item = _renderItem(index);
                return {
                    ...item,
                    minHeight:
                        typeof item.minHeight === "string"
                            ? convertRemLengthToPx(item.minHeight, remPx)
                            : item.minHeight,
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

    const [actualState, setState] = useState<VirtualizedScrollViewActualState>(() => {
        return {
            state: VirtualizedScrollViewState.initializeFromTop({
                screenHeight,
                bufferedItemHeight,
                itemCount,
                getItem: getItemWithoutRender,
            }),
            isScrolling: false,
            isJumpScrolling: false,
            contentHeightBeforeScrollForMobileWebKitPinToBottom: null,
        };
    });
    let {state} = actualState;

    // Update the buffered item height in our state based on our props if
    // necessary.
    state = state.setBufferedItemHeight(bufferedItemHeight);

    const itemsRef = useRef<{
        hasScheduledCleanup: boolean;
        generation: number;
        elementRefByKey: Map<
            Key,
            {
                generation: number;
                element: HTMLDivElement;
                lastHeight: number | null;
                cleanup: () => void;
            }
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
        renderedRange,
    } = state.render({
        itemCount,
        getItem: (index: number) => {
            const item = getItemWithoutRender(index);

            return {
                key: item.key,
                minHeight: item.minHeight,
                renderAdditionalItemIndexes: item.renderAdditionalItemIndexes,
                render: ({offset, height, getPositionByIndex}) => {
                    // Listen to the element's height with a resize observer so we can correctly
                    // position items. The resize observer will notify us whenever the height
                    // changes.
                    const ref = (element: HTMLDivElement | null) => {
                        // To make sure `itemsRef` doesn't grow forever, we occasionally clean it up.
                        // We need to wait for all `ref`s to fire in this render to know which refs are
                        // actually unused now.
                        if (!itemsRef.current.hasScheduledCleanup) {
                            itemsRef.current.hasScheduledCleanup = true;
                            itemsRef.current.generation++;

                            scheduleAfterNextBrowserPaint(() => {
                                itemsRef.current.hasScheduledCleanup = false;

                                for (const [key, elementRef] of itemsRef.current.elementRefByKey) {
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

                        const currentElementRef = itemsRef.current.elementRefByKey.get(item.key);

                        // If the element hasn't change for this item key, update the ref to the
                        // current generation so it doesn't get cleaned up.
                        if (currentElementRef && currentElementRef.element === element) {
                            currentElementRef.generation = itemsRef.current.generation;
                        }
                        // Otherwise, cleanup the old ref (if it exists) and observe the height of the
                        // new element.
                        else {
                            currentElementRef?.cleanup();

                            // IMPORTANT: Be careful about using props in this function because we will
                            // capture a version of props when the component is rendered.
                            const handleResize = () => {
                                const height = element.offsetHeight;

                                // If the element was removed from the DOM its height will be zero. Don't
                                // record that height.
                                if (!document.body.contains(element)) return;

                                // If the height didn't change, don't bother setting state.
                                if (height === newElementRef.lastHeight) return;
                                newElementRef.lastHeight = height;

                                // NOTE(calebmer): We can't update the rendered range inline here because we
                                // will have captured stale `itemCount` and `renderItem` props.
                                setState(actualState => {
                                    const newState = actualState.state.setItemHeight(
                                        item.key,
                                        height,
                                    );
                                    if (newState === actualState.state) return actualState;
                                    return {...actualState, state: newState};
                                });
                            };

                            addResizeListenerForElement(element, handleResize);

                            const newElementRef: {
                                generation: number;
                                element: HTMLDivElement;
                                lastHeight: number | null;
                                cleanup: () => void;
                            } = {
                                generation: itemsRef.current.generation,
                                element,
                                lastHeight: currentElementRef?.lastHeight ?? null,
                                cleanup: () =>
                                    removeResizeListenerForElement(element, handleResize),
                            };

                            itemsRef.current.elementRefByKey.set(item.key, newElementRef);
                        }
                    };

                    if (item.withManualLayout) {
                        const element = item.render({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getPositionByIndex,
                            isScrolling: actualState.isScrolling,
                        });
                        return cloneElement(element, {key: item.key});
                    } else {
                        return (
                            <div
                                key={item.key}
                                ref={ref}
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
                            >
                                {item.node}
                            </div>
                        );
                    }
                },
            };
        },
    });

    state = newStateAfterRender;

    const hasHandledScrollThisAnimationFrameRef = useRef(false);
    const lastScrollTopRef = useRef<number | null>(null);
    const scrollDebounceTimeoutRef = useRef<Timeout | null>(null);

    const handleScroll = () => {
        // Only handle scroll events once per animation frame.
        if (hasHandledScrollThisAnimationFrameRef.current) return;
        hasHandledScrollThisAnimationFrameRef.current = true;
        requestAnimationFrame(() => {
            hasHandledScrollThisAnimationFrameRef.current = false;
        });

        const {scrollTop, clientHeight} = assertExists(scrollRef.current);

        onScroll?.(scrollTop);

        // If the user is scrolling fast we enter a jump scroll state. We will not
        // update the rendered range until after the jump scroll has finished
        // to maintain high performance as the user jumps through the scrollable view.
        //
        // The threshold for jump scrolling is the user has moved more than half of the
        // scroll view height in the last render frame. As long as the user maintains
        // that speed we will continue the jump scroll. If scrolling decelerates (like
        // in an iOS toss scroll which maintains scrolling momentum a while) the jump
        // scroll ends.
        const isJumpScrolling =
            lastScrollTopRef.current !== null &&
            Math.abs(lastScrollTopRef.current - scrollTop) > clientHeight * 2;

        setState(actualState => {
            if (actualState.isJumpScrolling || isJumpScrolling) {
                if (actualState.isJumpScrolling) return actualState;
                return {...actualState, isJumpScrolling: true};
            } else {
                // Sometimes React tries to eagerly compute the next state. Then will rebase
                // during render.
                //
                // If the `itemCount` changed we need to wait for React to render before
                // calling `updateRenderedRange()` or else it will throw. So if we detect an
                // incorrect item count then React is probably trying to eagerly evaluate this
                // state update. Return a new state value to trigger a re-render and React
                // should properly apply state updates from there.
                if (itemCount !== actualState.state.getItemCount()) {
                    return {...actualState};
                }

                return {
                    ...updateVirtualizedScrollViewActualStateRenderedRange(actualState, {
                        itemCount,
                        getItemWithoutRender,
                        scrollTop,
                    }),
                    isScrolling: true,
                };
            }
        });

        scrollDebounceTimeoutRef.current?.clear();
        scrollDebounceTimeoutRef.current = createTimeout(() => {
            // Transition this render because if it's a jump scroll or if items change
            // based on `isScrolling` the render may be expensive and it will be useful to
            // time slice.
            startTransition(() => {
                setState(actualState => {
                    actualState = {
                        ...actualState,
                        isScrolling: false,
                    };

                    // If we were jump scrolling we need to update the rendered range at the end of
                    // the scroll.
                    if (!actualState.isJumpScrolling) return actualState;

                    // Sometimes React tries to eagerly compute the next state. Then will rebase
                    // during render.
                    //
                    // If the `itemCount` changed we need to wait for React to render before
                    // calling `updateRenderedRange()` or else it will throw. So if we detect an
                    // incorrect item count then React is probably trying to eagerly evaluate this
                    // state update. Return a new state value to trigger a re-render and React
                    // should properly apply state updates from there.
                    if (itemCount !== actualState.state.getItemCount()) {
                        return {...actualState, isJumpScrolling: false};
                    }

                    return updateVirtualizedScrollViewActualStateRenderedRange(actualState, {
                        itemCount,
                        getItemWithoutRender,
                        scrollTop,
                    });
                });
            });
        }, perceivedAsInstantLimitMs);

        // Finally, update the scroll top so we know what the last value was.
        lastScrollTopRef.current = scrollTop;
    };

    // On every render:
    //
    // - Check if our item heights changed and update them. This is redundant with
    //   the resize observer but doing it here allows us to batch into one state
    //   update that also updates the rendered range all at once.
    //
    // - Update our rendered range. Many changes in props may affect what items
    //   need to be rendered outside of simply scroll changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        const heightByKey = new Map<Key, number>();

        for (const [key, elementRef] of itemsRef.current.elementRefByKey) {
            // Ignore refs from old generations.
            if (elementRef.generation !== itemsRef.current.generation) continue;

            // If the element was removed from the DOM its height will be zero. Don't
            // record that height.
            if (!document.body.contains(elementRef.element)) continue;

            const height = elementRef.element.offsetHeight;
            if (height !== elementRef.lastHeight) {
                heightByKey.set(key, height);
                elementRef.lastHeight = height;
            }
        }

        const {scrollTop} = assertExists(scrollRef.current);

        let newState = state;

        for (const [key, height] of heightByKey) {
            newState = newState.setItemHeight(key, height);
        }

        if (actualState.isJumpScrolling) {
            setState(
                actualState.state !== newState ? {...actualState, state: newState} : actualState,
            );
        } else {
            setState(
                updateVirtualizedScrollViewActualStateRenderedRange(
                    actualState.state !== newState
                        ? {...actualState, state: newState}
                        : actualState,
                    {
                        itemCount,
                        getItemWithoutRender,
                        scrollTop,
                    },
                ),
            );
        }
    }, [getItemWithoutRender, itemCount, actualState, state]);

    // Effect to report the rendered range back to our callback.
    const onRenderedRangeChange = useEvent(_onRenderedRangeChange);
    const renderedRangeRef = useRef(
        renderedRange
            ? {startIndex: renderedRange.startIndex, endIndex: renderedRange.endIndex}
            : null,
    );
    useEffect(() => {
        // Make sure we only take effect dependencies on the start and end index. We
        // don't care about other properties of the rendered range changing.
        const startIndex = renderedRange?.startIndex;
        const endIndex = renderedRange?.endIndex;

        let range;
        if (typeof startIndex !== "number") {
            assert(typeof endIndex !== "number");
            range = null;
        } else {
            assert(typeof endIndex === "number");
            range =
                // Reuse the ref object if it already exists and is the same thing. May help
                // referential equality checking down the line.
                renderedRangeRef.current?.startIndex === startIndex &&
                renderedRangeRef.current.endIndex === endIndex
                    ? renderedRangeRef.current
                    : {startIndex, endIndex};
        }

        renderedRangeRef.current = range;
        onRenderedRangeChange(range);
    }, [onRenderedRangeChange, renderedRange?.endIndex, renderedRange?.startIndex]);

    useImperativeHandle(
        ref,
        (): VirtualizedScrollViewRef => ({
            getHeight: () => assertExists(scrollRef.current).clientHeight,
            getRenderedRange: () => renderedRangeRef.current,
            scrollToIndex: index => {
                const scrollElement = assertExists(scrollRef.current);

                scrollElement.scrollTop = getVirtualizedScrollViewOffsetForScrollToIndex({
                    state,
                    index,
                    currentScrollOffset: scrollElement.scrollTop,
                });
            },
            peekRenderedRangeAfterScrollToIndex: index => {
                const scrollElement = assertExists(scrollRef.current);

                const scrollOffset = getVirtualizedScrollViewOffsetForScrollToIndex({
                    state,
                    index,
                    currentScrollOffset: scrollElement.scrollTop,
                });

                const peekState = state.updateRenderedRange({
                    scrollOffset,
                    itemCount,
                    getItem: getItemWithoutRender,
                });

                return peekState.getRenderedRange();
            },
        }),
        [getItemWithoutRender, itemCount, state],
    );

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
                style={{
                    // Make sure we use momentum-based scrolling on iOS.
                    WebkitOverflowScrolling: "touch",
                }}
                onScroll={handleScroll}
            >
                <div style={{height: contentHeight}} />
                <div
                    ref={contentRef}
                    // NOTE(calebmer): We render our virtualized list in an absolutely positioned
                    // container because we find it helps avoid some jankiness on initial load with
                    // `pinTo="bottom"`. It is unclear to me why this is the fix.
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0,
                        height: contentHeight,
                        zIndex: "0", // Make sure we create a new z-index stacking context
                    }}
                >
                    <OverlayScopeContextProvider>
                        {extraChildren && (
                            <div
                                style={{
                                    // We need to render extra children in an absolutely positioned `<div>` so
                                    // it doesn't affect server side rendering.
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    pointerEvents: "none",
                                }}
                            >
                                {extraChildren}
                            </div>
                        )}
                        {shouldRenderWithRelativePositioning &&
                            bufferedHeightBeforeChildren > 0 && (
                                <div style={{height: bufferedHeightBeforeChildren}} />
                            )}
                        {children}
                    </OverlayScopeContextProvider>
                </div>
            </div>
        </>
    );
}

function updateVirtualizedScrollViewActualStateRenderedRange(
    actualState: VirtualizedScrollViewActualState,
    {
        itemCount,
        getItemWithoutRender,
        scrollTop,
    }: {
        itemCount: number;
        getItemWithoutRender: (index: number) => {key: Key; minHeight: number};
        scrollTop: number;
    },
): VirtualizedScrollViewActualState {
    const state = actualState.state.updateRenderedRange({
        scrollOffset: scrollTop,
        itemCount,
        getItem: getItemWithoutRender,
    });

    // If nothing changed then don't bother re-rendering the component.
    if (actualState.state === state && !actualState.isJumpScrolling) return actualState;

    return {
        state,
        isScrolling: actualState.isScrolling,
        isJumpScrolling: false,
    };
}

function getVirtualizedScrollViewOffsetForScrollToIndex({
    state,
    index,
    currentScrollOffset,
}: {
    state: VirtualizedScrollViewState;
    index: number;
    currentScrollOffset: number;
}): number {
    const viewHeight = state.getViewHeight();
    const {offset, height} = state.getPositionByIndex(index);

    // If the item is already partially visible, we make sure it is fully visible
    // and don't scroll anymore.
    if (
        areRangesOverlapping(
            offset,
            offset + height,
            currentScrollOffset,
            currentScrollOffset + viewHeight,
        )
    ) {
        // If the item is bigger than the screen, don't change scroll position.
        if (offset < currentScrollOffset && offset + height > currentScrollOffset + viewHeight) {
            return currentScrollOffset;
        }

        if (offset < currentScrollOffset) {
            return offset - getRemPxWithoutListening();
        }

        if (offset + height > currentScrollOffset + viewHeight) {
            return offset + height - viewHeight + getRemPxWithoutListening();
        }

        return currentScrollOffset;
    }

    // Ideally we scroll the item one fourth down the screen so it's near the top
    // but there is some context surrounding it.
    const idealScrollTop = Math.max(0, offset - viewHeight / 5);

    const scrollBottomLimit = offset + height + viewHeight / 5;
    const scrollBottomLimitDifferenceFromIdealScrollBottom =
        scrollBottomLimit - (idealScrollTop + viewHeight);

    // Push the ideal scroll top down if the scroll button limit would not be
    // visible with the ideal scroll top. We want the item centered which is why we
    // divide the difference by two.
    //
    // The top of the item must be visible so don't let the scroll top go past the
    // item offset.
    return Math.min(
        offset,
        idealScrollTop + Math.max(0, scrollBottomLimitDifferenceFromIdealScrollBottom / 2),
    );
}
