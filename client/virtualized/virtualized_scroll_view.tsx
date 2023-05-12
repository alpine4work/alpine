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
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render";
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
    VirtualizedScrollViewStateRenderItemProps,
    getVirtualizationWindowHeight,
} from "~/client/virtualized/virtualized_scroll_view_state";
import {RemLength, convertRemLengthToPx, getRemPxFromWindowWidth} from "~/shared/design/spacing";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {clamp} from "~/shared/helpers/number/clamp";
import {safe} from "~/shared/helpers/string/safe_string";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {ClientInfo} from "~/shared/remix/client_info";
import {sprinkles} from "~/shared/styles/styles";

// NOTE(calebmer, 2023-02-17): An observation I've had after working on
// scrolling for a while is it is better to have a scroll animation that drops
// the occasional frame then to show flashes of un-rendered content. Showing
// flashes of un-rendered content is more jarring and breaks the physics of
// the product.
//
// However, blocking scroll to render content is really hard to do in a
// cross-browser compatible way. [Monday.com has a good article][1] on
// overriding the wheel event to implement synchronous scrolling vs
// asynchronous scrolling (Airtable does this too). Notably, this only works
// for the mouse wheel! It doesn't work for touch interactions in browsers like
// Safari so breaks touch momentum scrolling which feels terrible.
//
// I wonder if when I build a custom native app wrapper if I can hook into web
// view scrolling to provide a mechanism for blocking scrolls? (And a better
// implementation for scroll anchoring during a scroll...) This [blog post from
// Salesforce][2] hints at being able to have native control over a web view's
// scrolling but it might only work for body scrolling.
//
// If not, then I think tightly controlling scroll behavior is a meaningful
// quality reason to eventually build native apps.
//
// [1]: https://engineering.monday.com/our-journey-to-understand-scrolling-across-different-browsers/
// [2]: https://engineering.salesforce.com/native-scrolling-in-salesforce-mobile-app-4f334b6ad96e/

/**
 * How many items will the virtualized scroll view initially render assuming
 * every item has the same minimum height?
 */
export function getInitialVirtualizedScrollViewRenderedItemCount(
    clientInfo: ClientInfo,
    minItemHeight: number | RemLength,
) {
    const maxRenderedHeight = getVirtualizationWindowHeight(clientInfo.screenHeight);

    const remPx = getRemPxFromWindowWidth(clientInfo.screenWidth);
    const minItemHeightPx =
        typeof minItemHeight === "string"
            ? convertRemLengthToPx(minItemHeight, remPx)
            : minItemHeight;

    return Math.ceil(maxRenderedHeight / minItemHeightPx);
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
          readonly render: (
              props: VirtualizedScrollViewStateRenderItemProps & {
                  ref: Ref<HTMLDivElement>;
                  shouldRenderWithRelativePositioning: boolean;
                  isScrolling: boolean;
              },
          ) => ReactElement;
      });

export type VirtualizedScrollViewRef = {
    /**
     * Get the height of the scroll view.
     */
    getHeight(): number;

    /**
     * Get the height of the scroll view's contents.
     */
    getContentHeight(): number;

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
     * Scroll so the provided item key is visible.
     */
    scrollToKeyIfExists(key: Key): void;

    /**
     * Look at what the rendered range will be after calling `scrollToIndex()`.
     * This does not actually scroll the view but rather lets you peek into the
     * future for preloading data at a given index.
     */
    peekRenderedRangeAfterScrollToIndex(
        index: number,
    ): {startIndex: number; endIndex: number} | null;

    /**
     * Get the current scroll offset for the scroll view.
     */
    getScrollOffset(): number;

    /**
     * Set the scroll offset to a new value.
     */
    setScrollOffset(scrollOffset: number): void;

    /**
     * Get the position of an item with the provided key. Returns null if an item
     * with the provided key does not exist.
     */
    getPositionByKeyIfExists(key: Key): {
        offset: number;
        height: number;
    } | null;
};

const VirtualizedScrollViewForwardRef = forwardRef(VirtualizedScrollView);
export {VirtualizedScrollViewForwardRef as VirtualizedScrollView};

type VirtualizedScrollViewActualState = {
    readonly state: VirtualizedScrollViewState;
    readonly isScrolling: boolean;
    readonly isJumpScrolling: boolean;
    /**
     * Well, this is annoying.
     *
     * Our scroll anchoring logic makes sure that when content is added to the
     * scroll view, the visible items stay visible. Otherwise you get a janky,
     * jittery, experience when scrolling up. To do that we adjust
     * `scrollElement.scrollTop` when items resize in an effect. However in Safari
     * on iOS (not Safari on MacOS) this cancels the momentum scroll animation
     * ([you can follow this code around][1]) leading to an even more janky
     * experience where your scrolls don't feel continuous.
     *
     * I spent a lot of time digging around in the WebKit source code for a way to
     * adjust scroll position without cancelling the scroll animation (e.g.
     * dispatch `wheel` event?) but couldn't find anything.
     *
     * So on mobile WebKit the way we implement scroll anchoring is by offsetting
     * the position in which all our items are rendered during a scroll then fixing
     * the position once the scroll is done (with a `scrollElement.scrollTop`
     * assignment).
     *
     * So if we start with content height of 100 and render an item above our
     * rendered range which is 5 pixels larger than its min-height while scrolling
     * up, we will keep a content height of 100 (even though the true content
     * height is now 105) and we will offset the position of all items by -5. When
     * the scroll is complete, we set the content height back to 105 and offset the
     * `scrollElement.scrollTop` by +5 so to the user it feels like you didn't move.
     *
     * Now, this is a little janky when you get to the top of the scroll view.
     * Especially if the accumulated offset is a big number. But we are ok with
     * this tradeoff for smooth continuous scrolling.
     *
     * [1]: https://github.com/WebKit/WebKit/blob/8f690bd4d72836915fb0c82775e16f1bf01caf59/Source/WebCore/dom/Element.cpp#L1564-L1585
     */
    readonly scrollAnchorAdjustmentDuringMobileWebKitScroll: number | null;
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
        initialScrollOffset = "top",
        initialViewHeight,
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
         * On initial render of the scroll view we use this height to determine how
         * many items to render before we know the real scroll view height.
         *
         * If you underestimate the height then the component will immediately need to
         * re-render. Overestimating is generally better.
         *
         * By default we use the screen height which is the maximum height of any view.
         */
        initialViewHeight?: number | RemLength;

        /**
         * On initial render where are we scrolled? Top of the scroll view or bottom?
         * Even works when server-side rendering by injecting a blocking `<script>`.
         *
         * Defaults to `top`.
         */
        initialScrollOffset?: "top" | "bottom";

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
            DistributiveOmit<VirtualizedScrollViewItem, "minHeight"> & {
                minHeight: number;
                originalMinHeight: RemLength | number;
            }
        >();

        return (
            index: number,
        ): DistributiveOmit<VirtualizedScrollViewItem, "minHeight"> & {
            minHeight: number;
            originalMinHeight: RemLength | number;
        } =>
            getOrSetDefaultMapValue(itemByIndex, index, () => {
                const item = _renderItem(index);
                return {
                    ...item,
                    minHeight:
                        typeof item.minHeight === "string"
                            ? convertRemLengthToPx(item.minHeight, remPx)
                            : item.minHeight,
                    originalMinHeight: item.minHeight,
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

    const [actualState, setActualState] = useState((): VirtualizedScrollViewActualState => {
        if (initialScrollOffset === "top") {
            return {
                state: VirtualizedScrollViewState.initializeFromTop({
                    initialViewHeight:
                        typeof initialViewHeight === "string"
                            ? convertRemLengthToPx(initialViewHeight, remPx)
                            : initialViewHeight ?? screenHeight,
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                isScrolling: false,
                isJumpScrolling: false,
                scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
            };
        } else {
            return {
                state: VirtualizedScrollViewState.initializeFromBottom({
                    initialViewHeight:
                        typeof initialViewHeight === "string"
                            ? convertRemLengthToPx(initialViewHeight, remPx)
                            : initialViewHeight ?? screenHeight,
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                isScrolling: false,
                isJumpScrolling: false,
                scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
            };
        }
    });
    let {state} = actualState;
    const {scrollAnchorAdjustmentDuringMobileWebKitScroll} = actualState;

    // Update the buffered item height in our state based on our props if
    // necessary.
    state = state.setBufferedItemHeight(bufferedItemHeight);

    const hasInitiallyScrolledRef = useRef(false);

    // For server side renders we include a `<script>` (see below) that scrolls our
    // element to the bottom.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyScrolledRef.current) return;
        hasInitiallyScrolledRef.current = true;

        const scrollElement = assertExists(scrollRef.current);

        if (initialScrollOffset !== "bottom") return;

        scrollElement.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;

        // When we initially scroll to the bottom, use the last rendered element as our
        // scroll anchor. That way as we measure items rendered above the content
        // doesn't shift for the user.
        {
            const contentElement = assertExists(contentRef.current);
            let element: HTMLElement | null = null;

            // NOTE(calebmer): There's room to optimize this algorithm. If we keep our item
            // refs in sorted order we can break after we find the first item within the
            // scroll window.
            for (const [, elementRef] of iterateItemRefs()) {
                // Ignore elements that are positioned within an element other than our
                // absolutely positioned content element. This could happen for items using
                // custom layout.
                if (elementRef.element.offsetParent !== contentElement) continue;

                // Select the last element.
                if (element === null || elementRef.element.offsetTop > element.offsetTop) {
                    element = elementRef.element;
                }
            }

            if (element) {
                const scrollAnchorElement = element;

                scrollAnchorRef.current = {
                    // Use the last element as the anchor until it is scrolled offscreen. Then
                    // resume regular anchor selection. (First visible element.)
                    shouldAnchorWhileVisible: true,
                    lastPosition: {
                        offset: scrollAnchorElement.offsetTop,
                        height: scrollAnchorElement.offsetHeight,
                    },
                    getPosition: () => {
                        if (!document.body.contains(scrollAnchorElement)) return null;
                        return {
                            offset: scrollAnchorElement.offsetTop,
                            height: scrollAnchorElement.offsetHeight,
                        };
                    },
                };
            }
        }
    }, [initialScrollOffset]);

    const itemsRef = useRef<{
        hasScheduledCleanup: boolean;
        generation: number;
        elementRefByKey: Map<
            Key,
            {
                generation: number;
                index: number;
                element: HTMLDivElement;
                lastRenderedHeight: number | null;
                cleanup: () => void;
            }
        >;
    }>({
        hasScheduledCleanup: false,
        generation: 1,
        elementRefByKey: new Map(),
    });

    const iterateItemRefs = () =>
        filterIterable(
            itemsRef.current.elementRefByKey,
            ([key, elementRef]) =>
                // Ignore refs from old generations. They will eventually be cleaned up.
                elementRef.generation === itemsRef.current.generation &&
                // Ignore refs that were removed from the DOM but have not been cleaned up yet.
                document.body.contains(elementRef.element),
        );

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
                render: ({
                    offset,
                    height,
                    getPositionByIndex,
                    viewHeight,
                    originalContentHeight,
                }) => {
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

                            // The key for an item may stay stable while the index changes.
                            currentElementRef.index = index;
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
                                if (height === newElementRef.lastRenderedHeight) return;

                                // NOTE(calebmer): We can't update the rendered range inline here because we
                                // will have captured stale `itemCount` and `renderItem` props.
                                setActualState(actualState => {
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
                                index: number;
                                element: HTMLDivElement;
                                lastRenderedHeight: number | null;
                                cleanup: () => void;
                            } = {
                                generation: itemsRef.current.generation,
                                index,
                                element,
                                lastRenderedHeight: currentElementRef?.lastRenderedHeight ?? null,
                                cleanup: () =>
                                    removeResizeListenerForElement(element, handleResize),
                            };

                            itemsRef.current.elementRefByKey.set(item.key, newElementRef);
                        }
                    };

                    if (item.withManualLayout) {
                        const element = item.render({
                            ref,
                            shouldRenderWithRelativePositioning,
                            isScrolling: actualState.isScrolling,
                            offset,
                            height,
                            getPositionByIndex,
                            viewHeight,
                            originalContentHeight,
                        });
                        return cloneElement(element, {key: item.key});
                    } else {
                        return (
                            <div
                                key={item.key}
                                ref={ref}
                                style={{
                                    // Use the original min-height in case we have the wrong `remPx` value during
                                    // server-side rendering.
                                    minHeight: item.originalMinHeight,
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

    const scrollAnchorRef = useRef<{
        // If you manually set a scroll anchor you can set this flag so it won't change
        // on scroll and will continue to be the anchor as long as it is in the
        // scroll window.
        shouldAnchorWhileVisible: boolean;
        lastPosition: {offset: number; height: number};
        getPosition: (state: VirtualizedScrollViewState) => {offset: number; height: number} | null;
    } | null>(null);

    // Implement an anchor node selection algorithm. Ours is simpler than the
    // generic browser algorithm. We only look at our item elements.
    // https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md#anchor-node-selection
    const updateScrollAnchor = () => {
        const contentElement = assertExists(contentRef.current);
        const scrollElement = assertExists(scrollRef.current);
        const {scrollTop, clientHeight} = scrollElement;

        // If the scroll anchor was manually set and it's currently visible then don't
        // update the scroll anchor to something different.
        if (scrollAnchorRef.current !== null && scrollAnchorRef.current.shouldAnchorWhileVisible) {
            const scrollAnchorPosition = scrollAnchorRef.current.getPosition(state);
            if (
                scrollAnchorPosition &&
                areRangesOverlapping(
                    scrollTop,
                    scrollTop + clientHeight,
                    scrollAnchorPosition.offset,
                    scrollAnchorPosition.offset + scrollAnchorPosition.height,
                )
            ) {
                return;
            }
        }

        let element: HTMLElement | null = null;

        // NOTE(calebmer): There's room to optimize this algorithm. If we keep our item
        // refs in sorted order we can break after we find the first item within the
        // scroll window.
        for (const [, elementRef] of iterateItemRefs()) {
            // Ignore elements that are positioned within an element other than our
            // absolutely positioned content element. This could happen for items using
            // custom layout.
            if (elementRef.element.offsetParent !== contentElement) continue;

            // Ignore elements that are above scroll window.
            if (elementRef.element.offsetTop < scrollTop) continue;

            // Select the element closest to the top of the scroll window.
            if (element === null || elementRef.element.offsetTop < element.offsetTop) {
                element = elementRef.element;
            }
        }

        if (element === null) {
            scrollAnchorRef.current = null;
        } else {
            const scrollAnchorElement = element;

            scrollAnchorRef.current = {
                shouldAnchorWhileVisible: false,
                lastPosition: {
                    offset: scrollAnchorElement.offsetTop,
                    height: scrollAnchorElement.offsetHeight,
                },
                getPosition: () => {
                    if (!document.body.contains(scrollAnchorElement)) return null;
                    return {
                        offset: scrollAnchorElement.offsetTop,
                        height: scrollAnchorElement.offsetHeight,
                    };
                },
            };
        }
    };

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

        // Update the scroll anchor whenever our scroll position changes since there
        // may be a new node that's first in the scroll window.
        updateScrollAnchor();

        const {scrollTop} = assertExists(scrollRef.current);

        onScroll?.(scrollTop);

        // If the user is scrolling fast we enter a jump scroll state. We will not
        // update the rendered range until after the jump scroll has finished
        // to maintain high performance as the user jumps through the scrollable view.
        //
        // The threshold for jump scrolling is the user has moved more than two
        // scroll view heights in the last render frame. As long as the user maintains
        // that speed we will continue the jump scroll. If scrolling decelerates (like
        // in an iOS toss scroll which maintains scrolling momentum a while) the jump
        // scroll ends.
        const isJumpScrolling =
            lastScrollTopRef.current !== null &&
            Math.abs(lastScrollTopRef.current - scrollTop) >
                (getVirtualizationWindowHeight(state.getViewHeight()) - state.getViewHeight()) * 2;

        setActualState(actualState => {
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

                return updateVirtualizedScrollViewActualStateRenderedRange(
                    !actualState.isScrolling ? {...actualState, isScrolling: true} : actualState,
                    {
                        itemCount,
                        getItemWithoutRender,
                        scrollTop,
                    },
                );
            }
        });

        scrollDebounceTimeoutRef.current?.clear();
        scrollDebounceTimeoutRef.current = createTimeout(() => {
            // Transition this render because if it's a jump scroll or if items change
            // based on `isScrolling` the render may be expensive and it will be useful to
            // time slice.
            startTransition(() => {
                setActualState(actualState => {
                    actualState = {
                        ...actualState,
                        isScrolling: false,
                        // Reset the scroll adjustment on mobile WebKit once the user is done
                        // scrolling. This should update our rendered element's content height.
                        scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
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

    const stateRef = useRef({state, itemCount, getItemWithoutRender});
    useLayoutEffectWithoutServerSideWarning(() => {
        stateRef.current = {state, itemCount, getItemWithoutRender};
    });

    // On every render:
    //
    // - Check if our item heights changed and update them. This is redundant with
    //   the resize observer but doing it here allows us to batch into one state
    //   update that also updates the rendered range all at once.
    //
    // - Update our rendered range. Many changes in props may affect what items
    //   need to be rendered outside of simply scroll changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollElement = assertExists(scrollRef.current);

        const heightByKey = new Map<Key, number>();

        for (const [key, elementRef] of iterateItemRefs()) {
            const height = elementRef.element.offsetHeight;
            if (height !== elementRef.lastRenderedHeight) {
                heightByKey.set(key, height);
            }
        }

        let newState = state;

        // Make sure the view height is correct. Updating here also means a view height
        // change is batched with this effect render.
        newState = newState.setViewHeight(scrollElement.clientHeight);

        for (const [key, height] of heightByKey) {
            newState = newState.setItemHeight(key, height);
        }

        // Use the last scroll position we saw from a scroll event. NOT the current
        // scroll position in the DOM. This is so if the browser adjusted the scroll
        // position between our last scroll event and now (probably while React was
        // updating the DOM) we ignore those updates from the browser.
        //
        // Notably if the content height shrinks such that the old scroll top is
        // out-of-bounds the browser will change the scroll offset. However, if we have
        // a scroll anchor then we will also try to perform the same scroll adjustment
        // here! We don't want to apply this adjustment twice so ignore the browser
        // adjustment when computing our new `scrollTop`.
        const originalScrollTop = lastScrollTopRef.current ?? scrollElement.scrollTop;

        let scrollTop = originalScrollTop;
        let newScrollAnchorAdjustmentDuringMobileWebKitScroll =
            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll;

        // We want to perform our scroll anchoring adjustment whenever the anchor
        // node moves.
        //
        // All anchor node movements that we care about should be captured by this
        // effect (item height changes, view height changes) so we do the
        // adjustment here.
        //
        // It means we can avoid calling `updateRenderedRange()` twice. Once here and
        // once again in the scroll event handler in response to our adjustment.
        if (scrollAnchorRef.current) {
            // Will return null if the scroll anchor was unmounted.
            const nextPosition = scrollAnchorRef.current.getPosition(newState);
            if (nextPosition) {
                const lastPosition = scrollAnchorRef.current.lastPosition;

                const scrollAdjustment = nextPosition.offset - lastPosition.offset;

                // If this is not a mobile WebKit scroll, actually update the `scrollTop`. On
                // mobile WebKit this cancels the scrolling animation so instead we have a
                // piece of state we use to implement a more hacky version of scroll
                // adjustments that doesn't disrupt the scroll.
                if (newScrollAnchorAdjustmentDuringMobileWebKitScroll === null) {
                    scrollTop = scrollTop + scrollAdjustment;
                    if (scrollTop !== originalScrollTop) {
                        scrollElement.scrollTop = scrollTop;
                    }
                } else {
                    newScrollAnchorAdjustmentDuringMobileWebKitScroll += scrollAdjustment;
                }

                scrollAnchorRef.current.lastPosition = nextPosition;
            }
        }

        // Make sure our new scroll top is in bounds. Since our scroll top starts from
        // `lastScrollTopRef` instead of the scroll offset in the DOM we may be out
        // of bounds.
        scrollTop = clamp(0, scrollTop, newState.getContentHeight() - newState.getViewHeight());

        let newActualState =
            actualState.state !== newState ||
            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll !==
                newScrollAnchorAdjustmentDuringMobileWebKitScroll
                ? {
                      ...actualState,
                      state: newState,
                      scrollAnchorAdjustmentDuringMobileWebKitScroll:
                          newScrollAnchorAdjustmentDuringMobileWebKitScroll,
                  }
                : actualState;

        if (!actualState.isJumpScrolling) {
            newActualState = updateVirtualizedScrollViewActualStateRenderedRange(newActualState, {
                itemCount,
                getItemWithoutRender,
                scrollTop,
            });
        }

        setActualState(newActualState);
    }, [getItemWithoutRender, itemCount, actualState, state]);

    // Optimization: Record the last rendered height for all our items so we don't
    // need to set the height again on every update.
    useEffect(() => {
        for (const [key, elementRef] of iterateItemRefs()) {
            const position = state.getPositionByKeyIfExists(key);
            if (position) elementRef.lastRenderedHeight = position.height;
        }
    }, [state]);

    // Watch size changes to the view element to make sure we update the height.
    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollElement = assertExists(scrollRef.current);

        const handleResize = () => {
            const viewHeight = scrollElement.clientHeight;

            setActualState(actualState => {
                if (actualState.state.getViewHeight() === viewHeight) return actualState;
                return {...actualState, state: state.setViewHeight(viewHeight)};
            });
        };

        addResizeListenerForElement(scrollElement, handleResize);
        return () => {
            removeResizeListenerForElement(scrollElement, handleResize);
        };
    });

    const previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef = useRef(
        scrollAnchorAdjustmentDuringMobileWebKitScroll,
    );

    // When we clear `scrollAnchorAdjustmentDuringMobileWebKitScroll` from
    // state, all items shift as they find their correct positions. This layout
    // effect counteracts the shift to maintain the position in the scroll view the
    // user was looking at.
    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollElement = assertExists(scrollRef.current);

        if (
            previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current !== null &&
            scrollAnchorAdjustmentDuringMobileWebKitScroll === null
        ) {
            scrollElement.scrollTop +=
                previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current;
        }

        previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current =
            scrollAnchorAdjustmentDuringMobileWebKitScroll;
    }, [contentHeight, scrollAnchorAdjustmentDuringMobileWebKitScroll]);

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
        (): VirtualizedScrollViewRef => {
            const scrollToIndex = (index: number) => {
                // Scheduled in a microtask so that if there is a pending immediate React state
                // update it can be applied before we perform the scroll.
                //
                // To repro the bug this fixes: open a peek for a link to a comment in a post
                // near the bottom of the post.
                //
                // What happens here is:
                //
                // 1. We run an initial layout effect in `<VirtualizedScrollView>` with the
                //    correct view height and initially rendered item heights.
                // 2. This schedules an immediate, synchronous, React update for
                //    `<VirtualizedScrollView>`.
                // 3. React synchronously flushes all parent component `useEffect()`s.
                //    Including the `useEffect()` in `<PostView>` that scrolls to a comment.
                // 4. `scrollToIndex()` is called but `stateRef` does not match what is in the
                //    DOM. While in the DOM we have elements with the correct measurements, in
                //    React we haven't run our second immediate scheduled update which will
                //    update state.
                // 5. `scrollToIndex()` scrolls to the wrong location unless we have the
                //    `scheduleMicrotask()` wrapper which runs `scrollToIndex()` after the
                //    React immediately scheduled re-render that updates state.
                scheduleMicrotask(() => {
                    const {state, getItemWithoutRender} = stateRef.current;
                    const scrollElement = assertExists(scrollRef.current);

                    const {scrollOffset, position} = getVirtualizedScrollViewOffsetForScrollToIndex(
                        {
                            state,
                            index,
                            scrollOffset: scrollElement.scrollTop,
                        },
                    );

                    const itemKey = getItemWithoutRender(index).key;

                    // Anchor to the item we are scrolling to. At first when the item hasn't
                    // rendered we use the position we found in our state. Then once we find the
                    // item was rendered in the DOM we use the position of the related DOM node.
                    //
                    // The position we initially render our item in the DOM may be different from
                    // the computed position which is why we need to capture the computed
                    // position here.
                    scrollAnchorRef.current = {
                        shouldAnchorWhileVisible: true,
                        lastPosition: position,
                        getPosition: (state: VirtualizedScrollViewState) => {
                            // We use the virtualized scroll view state to get the position instead of DOM
                            // nodes because while scrolling to an item it may not be rendered in the
                            // virtualization window but we still need the position.
                            //
                            // By using the latest state we can also see updates that haven't been written
                            // to the DOM yet which causes less churn in scroll anchor adjustments.
                            return (
                                state.getPositionByKeyIfExists(itemKey) ??
                                state.getPositionByIndex(index)
                            );
                        },
                    };

                    // Actually perform the scroll.
                    //
                    // We perform this after setting the scroll anchor to make sure any event
                    // listeners see the new scroll anchor.
                    scrollElement.scrollTop = scrollOffset;
                });
            };

            return {
                getHeight: () => assertExists(scrollRef.current).clientHeight,
                getContentHeight: () => assertExists(scrollRef.current).scrollHeight,
                getRenderedRange: () => renderedRangeRef.current,
                scrollToIndex,
                scrollToKeyIfExists: key => {
                    const state = stateRef.current.state;
                    const index = state.getIndexByKeyIfExists(key);
                    if (index === null) return;
                    scrollToIndex(index);
                },
                peekRenderedRangeAfterScrollToIndex: index => {
                    const state = stateRef.current.state;
                    const scrollElement = assertExists(scrollRef.current);

                    const {scrollOffset} = getVirtualizedScrollViewOffsetForScrollToIndex({
                        state,
                        index,
                        scrollOffset: scrollElement.scrollTop,
                    });

                    const peekState = state.updateRenderedRange({
                        scrollOffset,
                        itemCount: stateRef.current.itemCount,
                        getItem: stateRef.current.getItemWithoutRender,
                    });

                    return peekState.getRenderedRange();
                },
                getScrollOffset: () => {
                    const scrollElement = assertExists(scrollRef.current);
                    return scrollElement.scrollTop;
                },
                setScrollOffset: (scrollOffset: number) => {
                    const scrollElement = assertExists(scrollRef.current);
                    scrollElement.scrollTop = scrollOffset;
                },
                getPositionByKeyIfExists: key => {
                    const state = stateRef.current.state;
                    return state.getPositionByKeyIfExists(key);
                },
            };
        },
        [],
    );

    return (
        <>
            <div
                ref={scrollRef}
                className={sprinkles({
                    flexGrow: "1",
                    position: "relative",
                    height: "full",
                    overflowX: "hidden",
                    overflowY: "scroll",
                })}
                style={{
                    // Opt-out of scroll anchoring. We need to manually implement scroll anchoring
                    // for our virtualized scroll view.
                    //
                    // See: https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md
                    overflowAnchor: "none",
                    // Make sure we use momentum-based scrolling on iOS.
                    WebkitOverflowScrolling: "touch",
                }}
                onScroll={handleScroll}
            >
                <div style={{height: contentHeight}} />
                <div
                    ref={contentRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0 - (scrollAnchorAdjustmentDuringMobileWebKitScroll ?? 0),
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
            {initialScrollOffset === "bottom" && (
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
            )}
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
        scrollOffset: scrollTop + (actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll ?? 0),
        itemCount,
        getItem: getItemWithoutRender,
    });

    // If nothing changed then don't bother re-rendering the component.
    if (actualState.state === state && !actualState.isJumpScrolling) return actualState;

    return {
        state,
        isScrolling: actualState.isScrolling,
        isJumpScrolling: false,
        scrollAnchorAdjustmentDuringMobileWebKitScroll:
            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll ??
            (isMobileWebKit ? 0 : null),
    };
}

function getVirtualizedScrollViewOffsetForScrollToIndex({
    state,
    index,
    scrollOffset,
}: {
    state: VirtualizedScrollViewState;
    index: number;
    scrollOffset: number;
}): {scrollOffset: number; position: {offset: number; height: number}} {
    const margin = getRemPxWithoutListening();
    const viewHeight = state.getViewHeight();
    const position = state.getPositionByIndex(index);

    // NOTE(calebmer): When scrolling to an unmeasured item we won't know the
    // height! This means we may render a large item too far down the view. Maybe
    // we should measure the item before scrolling to it?
    //
    // If we keep the item we're scrolling to rendered during the scroll that would
    // also prevent bugs where measuring items around it unmounts the item. We
    // could simplify some code like `getPosition` below which handles its
    // `element` being unmounted and `<MessageView>` which takes care to not
    // animate if we might soon unmount the message.
    const {offset, height} = position;

    // If the item is already partially visible, we make sure it is fully visible
    // and don't scroll anymore.
    if (areRangesOverlapping(offset, offset + height, scrollOffset, scrollOffset + viewHeight)) {
        // If the item is bigger than the screen, don't change scroll position.
        if (offset < scrollOffset && offset + height > scrollOffset + viewHeight) {
            return {scrollOffset, position};
        }

        if (offset < scrollOffset) {
            return {scrollOffset: offset - margin, position};
        }

        if (offset + height > scrollOffset + viewHeight) {
            return {
                scrollOffset: offset + height - viewHeight + margin,
                position,
            };
        }

        return {scrollOffset, position};
    }

    // Ideally we scroll the item one fifth down the screen so it's near the top
    // but there is some context surrounding it.
    let newScrollOffset = Math.max(0, offset - viewHeight / 5);

    // If there would be less than one fifth of the screen below the message then
    // push the message back up.
    const viewHeightBelow = newScrollOffset + viewHeight - (offset + height);
    newScrollOffset -= Math.min(0, viewHeightBelow - viewHeight / 5);

    // The top of the message should always be visible.
    newScrollOffset = Math.min(offset - margin, newScrollOffset);

    return {scrollOffset: newScrollOffset, position};
}
