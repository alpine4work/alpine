import {
    Key,
    Memo,
    MutableRefObject,
    ReactElement,
    ReactNode,
    Ref,
    cloneElement,
    forwardRef,
    startTransition,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {
    CallbackNode,
    unstable_LowPriority,
    unstable_cancelCallback,
    unstable_scheduleCallback,
} from "scheduler";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {
    ScrollbarInset,
    ScrollbarInsetDynamic,
    convertScrollbarInsetDynamicToPx,
    convertScrollbarInsetToPx,
    useScrollbar,
} from "~/client/web/design/scrollbar.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    getRemPxWithoutListening,
    useSpacingScale,
} from "~/client/web/remix/spacing_scale_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollViewState,
    VirtualizedScrollViewStateRenderItemProps,
    getVirtualizationWindowHeight,
} from "~/client/web/virtualized/virtualized_scroll_view_state.js";
import {RemLength, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.open_source.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {safe} from "~/shared/helpers/string/safe_string.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";

// NOTE(calebmer, 2023-02-17): An observation I've had after working on scrolling
// for a while is it is better to have a scroll animation that drops the occasional
// frame then to show flashes of un-rendered content. Showing flashes of
// un-rendered content is more jarring and breaks the physics of the product.
//
// However, blocking scroll to render content is really hard to do in a
// cross-browser compatible way. [Monday.com has a good article][1] on overriding
// the wheel event to implement synchronous scrolling vs asynchronous scrolling
// (Airtable does this too). Notably, this only works for the mouse wheel! It
// doesn't work for touch interactions in browsers like Safari so breaks touch
// momentum scrolling which feels terrible.
//
// I wonder if when I build a custom native app wrapper if I can hook into web view
// scrolling to provide a mechanism for blocking scrolls? (And a better
// implementation for scroll anchoring during a scroll...) This [blog post from
// Salesforce][2] hints at being able to have native control over a web view's
// scrolling but it might only work for body scrolling.
//
// If not, then I think tightly controlling scroll behavior is a meaningful quality
// reason to eventually build native apps.
//
// [1]:
//     https://engineering.monday.com/our-journey-to-understand-scrolling-across-different-browsers/
// [2]:
//     https://engineering.salesforce.com/native-scrolling-in-salesforce-mobile-app-4f334b6ad96e/

type VirtualizedScrollViewItemBase = {
    /**
     * The key of the item. Items may be re-ordered so indexes are not stable but the
     * key should provided a stable identifier for the item.
     */
    readonly key: Key;

    /**
     * The minimum height of the item. Must be greater than zero. We use this when we
     * don't know the real height of the item to determine how many items we need to
     * render. For example when server rendering or when scrolling new items on-screen
     * we use the minimum height to decide how many items to render.
     *
     * Using the minimum height in this way will mean we generally render more items
     * than necessary. But it's better to over-render then to under-render and show the
     * user blank space.
     *
     * May be measured in pixels or REM units.
     */
    readonly minHeight: RemLength | number;

    /**
     * Set the `z-index` CSS property for this node.
     */
    readonly zIndex?: string;

    /**
     * If this item is rendered then we will also render the items at the indexes
     * provided in this array even if they are not in the virtualized window. Useful
     * for implementing sticky section headers.
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
           * Manually render the wrapper `<div>` to position the item with a render function.
           *
           * The default implementation is:
           *
           * ```ts
           * <div
           *     ref={ref}
           *     style={{
           *         minHeight: item.minHeight,
           *         zIndex: item.zIndex,
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
           * You should attach the `ref` so React can detect item size changes. If you don't
           * the item will use the `minHeight` as the item's constant height.
           *
           * `shouldRenderWithRelativePositioning` is set to true when server-side rendering.
           * We don't know the heights of elements in the component so we lay items out
           * relative to each other and let the browser perform layout.
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
     * Scroll so the provided index is visible. Will throw an error if the index is out
     * of bounds.
     *
     * If `withAnchor` is true then while the item is onscreen, any content size shifts
     * will keep the item in a stable position.
     */
    scrollToIndex(index: number, options: {withAnchor: boolean}): void;

    /**
     * Scroll so the provided item key is visible.
     *
     * If `withAnchor` is true then while the item is onscreen, any content size shifts
     * will keep the item in a stable position.
     */
    scrollToKeyIfExists(key: Key, options: {withAnchor: boolean}): void;

    /**
     * Get the current scroll offset for the scroll view.
     */
    getScrollOffset(): number;

    /**
     * Set the scroll offset to a new value.
     */
    setScrollOffset(scrollOffset: number, options?: {behavior?: "instant" | "smooth"}): void;

    /**
     * Returns the key at the provided index if we've rendered that index before.
     * Otherwise the index is un-rendered buffered space and we return null. Throws if
     * the index is out of bounds.
     */
    getKeyByIndexIfExists(index: number): Key | null;

    /**
     * Get the index of an item with the provided key. Returns null if an item with the
     * provided key does not exist.
     *
     * The index may be out-of-date if we've scrolled away. The item may be in a new
     * position but our scroll view state won't know until the item or the old index is
     * re-rendered.
     */
    getIndexByKeyIfExists(key: Key): number | null;

    /**
     * Get the position of an item at the provided index. Throws an error if the index
     * is out-of-bounds.
     */
    getPositionByIndex(index: number): {
        offset: number;
        height: number;
    };

    /**
     * Get the position of an item with the provided key. Returns null if an item with
     * the provided key does not exist.
     */
    getPositionByKeyIfExists(key: Key): {
        offset: number;
        height: number;
        getIndex: () => number;
    } | null;

    /**
     * Look at what the rendered range will be after calling `scrollToIndex()`. This
     * does not actually scroll the view but rather lets you peek into the future for
     * preloading data at a given index.
     */
    peekRenderedRangeAfterScrollToIndex(
        index: number,
    ): {startIndex: number; endIndex: number} | null;

    /**
     * Look at what the rendered range will be after calling `setScrollOffset()`. This
     * does not actually scroll the view but rather lets you peek into the future for
     * preloading data at a given index.
     */
    peekRenderedRangeAfterSetScrollOffset(
        scrollOffset: number,
    ): {startIndex: number; endIndex: number} | null;

    /**
     * Return the underlying view HTML element.
     */
    getElement(): HTMLDivElement;

    /**
     * Return the underlying content container HTML element.
     */
    getContentElement(): HTMLDivElement;

    /**
     * Return the underlying HTML element for an item at the specified index if it
     * exists.
     */
    getElementByKeyIfExists(key: Key): HTMLElement | null;
};

const VirtualizedScrollViewForwardRef = forwardRef(VirtualizedScrollView);
export {VirtualizedScrollViewForwardRef as VirtualizedScrollView};

type VirtualizedScrollViewActualState = {
    readonly key: Key | undefined;
    readonly state: VirtualizedScrollViewState;
    readonly isScrolling: boolean;
    readonly isJumpScrolling: boolean;
    readonly hasInitiallyScrolledRef: MutableRefObject<boolean>;

    // NOTE(calebmer, #mobile-webkit-weirdness): Well, this is annoying.
    //
    // Our scroll anchoring logic makes sure that when content is added to the scroll
    // view, the visible items stay visible. Otherwise you get a janky, jittery,
    // experience when scrolling up. To do that we adjust `scrollElement.scrollTop`
    // when items resize in an effect. However in Safari on iOS (not Safari on MacOS)
    // this cancels the momentum scroll animation ([you can follow this code
    // around][1], [ends up around here][2]) leading to an even more janky experience
    // where your scrolls don't feel continuous.
    //
    // I spent a lot of time digging around in the WebKit source code for a way to
    // adjust scroll position without cancelling the scroll animation (e.g. dispatch
    // `wheel` event?) but couldn't find anything.
    //
    // So on mobile WebKit the way we implement scroll anchoring is by offsetting the
    // position in which all our items are rendered during a scroll then fixing the
    // position once the scroll is done (with a `scrollElement.scrollTop` assignment).
    //
    // So if we start with content height of 100 and render an item above our rendered
    // range which is 5 pixels larger than its min-height while scrolling up, we will
    // keep a content height of 100 (even though the true content height is now 105)
    // and we will offset the position of all items by -5. When the scroll is complete,
    // we set the content height back to 105 and offset the `scrollElement.scrollTop`
    // by +5 so to the user it feels like you didn't move.
    //
    // Now, this is a little janky when you get to the top of the scroll view.
    // Especially if the accumulated offset is a big number. But we are ok with this
    // tradeoff for smooth continuous scrolling.
    //
    // [1]:
    //     https://github.com/WebKit/WebKit/blob/8f690bd4d72836915fb0c82775e16f1bf01caf59/Source/WebCore/dom/Element.cpp#L1564-L1585
    // [2]:
    //     https://github.com/WebKit/WebKit/blob/8f690bd4d72836915fb0c82775e16f1bf01caf59/Source/WebCore/rendering/RenderLayerScrollableArea.cpp#L304-L327
    readonly scrollAnchorAdjustmentDuringMobileWebKitScroll: number | null;
};

export type VirtualizedScrollViewRenderItem = Memo<(index: number) => VirtualizedScrollViewItem>;

/**
 * Component for rendering a large list of items. Web browsers start to slow down
 * when you have hundreds of thousands of DOM nodes so virtualization is a
 * technique where you only render items visible to the user. Then as the user
 * scrolls you render new items and unmount items that are offscreen.
 *
 * Features:
 *
 * - Variable item height: Each item can have a different height. We estimate the
 *   total height of the list by looking at previously rendered item heights.
 *
 * - Dynamic item height: You don't need to statically know what the height of your
 *   item is. You provide a minimum height for every item and the list will measure
 *   the actual item heights automatically.
 *
 * - Resizable item height: The list watches for item resizes and will rerender if
 *   any item's height changes. Correctly re-positioning items that come after.
 *
 * - Server-side rendering: Can be initially rendered on the server then hydrated
 *   on the client before knowing anything about client screen height.
 *
 * - Scroll anchoring: Browser's implement a [scroll anchoring][4] algorithm so
 *   that layout shifts above the content a user is viewing does not disrupt the
 *   user's reading. This behavior is even more important for a virtualized list
 *   implementation where we don't know the heights of items until we render them.
 *   As a user scrolls from bottom to top content will continually jump as we
 *   measure items without scroll anchoring. However, scroll anchoring does not
 *   work for scrollable elements with absolutely positioned children so we need to
 *   reimplement scroll anchoring in user land for the best experience.
 *
 *     Additionally, iOS Safari does not support scroll anchoring at all and
 *     changing the scroll offset during a scroll disrupts scrolling animations! So
 *     we need custom workarounds for smooth scrolling on iOS.
 *
 * - Initial scroll to bottom: For interfaces like a chat interface, we want to
 *   initially scroll the user to the bottom of the view instead of the top. Both
 *   on client and server.
 *
 * - Advanced escape hatches: Advanced props that allow you to break out of normal
 *   operation for rendering things like sticky headers/footers.
 *
 * There are many virtualized list implementations like [`react-window`][1],
 * [`react-virtualized`][2], and the [React Native Web][3] virtualized lists.
 * However supporting the above feature set is uncommon. These libraries typically
 * need to know the height of items ahead-of-time and if an item height changes it
 * can cause potentially expensive layout changes as all following items need to be
 * measured again.
 *
 * This component is backed by immutable data structures which let us make
 * efficient incremental updates to item sizes.
 *
 * This component is also well integrated with the rest of our React component
 * system. It leverages `ClientInfo` during server-side rendering to determine how
 * much initial content to render, for instance. It's equipped for our product.
 *
 * [1]: https://github.com/bvaughn/react-window
 * [2]: https://github.com/bvaughn/react-virtualized
 * [3]: https://necolas.github.io/react-native-web/docs/lists/
 * [4]: https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md
 */
function VirtualizedScrollView(
    {
        itemCount,
        renderItem: renderItemProp,
        bufferedItemHeight: bufferedItemHeightProp,
        initialScrollOffset = "top",
        initialViewHeight,
        onRenderedRangeChange,
        onRenderedRangeLayoutChange,
        onScroll,
        onStateChange,
        // `elementRef` is a common variable name in this component so let's disambiguate
        // the name.
        elementRef: elementRefProp,
        stateKey,
        "data-testid": dataTestId,
        alwaysRenderAdditionalItemIndexes,
        scrollbarInsetTopItemIndex,
        scrollbarInsetTop: actualScrollbarInsetTop,
        scrollbarInsetBottomItemIndex,
        scrollbarInsetBottom: actualScrollbarInsetBottom,
        extraChildren,
        extraChildrenOutsideContentElement,
        extraChildrenContentHeight = 0,
        withRoundedContentHeight = false,
    }: {
        /**
         * The total number of virtualized items. You do not need all the items loaded in
         * memory but you should be able to render something (like a loading shimmer)
         * whenever `getItem` is called.
         */
        itemCount: number;

        /**
         * Render one of the items in our scroll view.
         *
         * The virtualized scroll view will only render a subset of items at any time. This
         * function may never be called for some items. Just because this function is
         * called does not mean the item is rendered! The virtualized list may be trying to
         * learn more about the shape of the list.
         *
         * We recommend memoizing this function with `useCallback()`.
         */
        renderItem: VirtualizedScrollViewRenderItem;

        /**
         * The height we use for items we have never rendered. We'll use this to calculate
         * the scroll view content's height without rendering every item. Once items are
         * scrolled into frame we can use their proper height instead of the buffered
         * height.
         */
        bufferedItemHeight: number | RemLength;

        /**
         * On initial render of the scroll view we use this height to determine how many
         * items to render before we know the real scroll view height.
         *
         * If you underestimate the height then the component will immediately need to
         * re-render. Overestimating is generally better.
         *
         * By default we use the screen height which is the maximum height of any view.
         */
        initialViewHeight?: number | RemLength;

        /**
         * On initial render where are we scrolled? Top of the scroll view or bottom? Even
         * works when server-side rendering by injecting a blocking `<script>`.
         *
         * Defaults to `top`.
         */
        initialScrollOffset?: "top" | "bottom";

        /**
         * Called on initial mount and again whenever the range of rendered items changes.
         * If no items are rendered then this will be called with `null` for the range
         * object. The range is inclusive of both the start and end index.
         */
        onRenderedRangeChange?: (range: {startIndex: number; endIndex: number} | null) => void;

        /**
         * Called on initial mount and again whenever the range of rendered items changes.
         * If no items are rendered then this will be called with `null` for the range
         * object. The range is inclusive of both the start and end index.
         *
         * Different from `onRenderedRangeChange` is this runs during React's
         * `useLayoutEffect()` phase instead of `onRenderedRangeChange` which runs during
         * React's `useEffect()` phase. That means this function is render blocking (be
         * careful to not hurt performance when using!).
         *
         * Generally prefer `onRenderedRangeChange`.
         */
        onRenderedRangeLayoutChange?: (
            range: {startIndex: number; endIndex: number} | null,
        ) => void;

        /**
         * Called whenever the scroll position changes. Remember that the scroll event is
         * asynchronous with the browser renderer so be careful tying effects to the scroll
         * position.
         */
        onScroll?: (scrollOffset: number) => void;

        /**
         * Called whenever the scroll view's internal state changes. This callback may be
         * redundant with `onRenderedRangeChange` and `onScroll`. A case where this
         * function will be called but `onRenderedRangeChange` and `onScroll` won't be
         * called is if an item changes height and the height change does not trigger a
         * rendered range change because the same item indexes are rendered.
         */
        onStateChange?: () => void;

        /**
         * If you want to attach a ref to the scroll view DOM element instead of
         * `VirtualizedScrollViewRef` then you may use this prop.
         */
        elementRef?: Ref<HTMLDivElement>;

        /**
         * When the `stateKey` changes we reset our virtualized scroll view's internal
         * state and scroll the user back to the top. But we don't remount the component.
         *
         * This can be used, for instance, when changing the backing list of a virtualized
         * scroll view and you want to throw away the state of old measured items that
         * aren't representative of the new list.
         *
         * On change this will also re-render and scroll the list to its initial position
         * synchronously so the user doesn't see blank space while the list re-renders.
         */
        stateKey?: Key;

        /**
         * The `data-testid` attribute to use for this scroll view.
         */
        "data-testid"?: string;

        /**
         * Item indexes that we always render regardless of where our virtualized window
         * is. Useful for sticky headers.
         */
        alwaysRenderAdditionalItemIndexes?: ReadonlyArray<number>;

        /**
         * Inset the scrollbar after this item index. Throws an error if the index is out
         * of range.
         */
        scrollbarInsetTopItemIndex?: number;

        /**
         * Inset the scrollbar by this many pixels. If both `scrollbarInsetTopItemIndex`
         * and `scrollbarInsetTop` are set then `scrollbarInsetTop` wins.
         */
        scrollbarInsetTop?: ScrollbarInsetDynamic;

        /**
         * Inset the scrollbar after this item index. Throws an error if the index is out
         * of range.
         */
        scrollbarInsetBottomItemIndex?: number;

        /**
         * Inset the scrollbar by this many pixels.
         */
        scrollbarInsetBottom?: ScrollbarInset;

        /**
         * Extra children to always render in our virtualized scroll view. Useful if you
         * want to render extra sticky content.
         *
         * The children are rendered in a container with no pointer events. So you need to
         * add `pointerEvents: "auto"` on elements you want to be interactive with a
         * pointer.
         */
        extraChildren?:
            | ReactNode
            | ((props: {
                  contentHeight: number;
                  viewHeight: number;
                  shouldRenderWithRelativePositioning: boolean;
              }) => ReactNode);

        /**
         * Extra children to always render in our virtualized scroll view. Useful if you
         * want to render extra sticky content.
         *
         * The children are rendered in a container with no pointer events. So you need to
         * add `pointerEvents: "auto"` on elements you want to be interactive with a
         * pointer.
         *
         * Usually you should use `extraChildren` instead of this property but sometimes
         * you need to position using the scrollable element not the content element. To
         * understand when you'd use this you have to understand the virtualized scroll
         * view's DOM which looks like:
         *
         * ```html
         * <div style="position: relative; overflow-y: scroll">
         *     <div style="position: absolute; height: ${contentHeight}">
         *         {extraChildren}
         *         <!-- All items... -->
         *     </div>
         *     {extraChildrenOutsideContentElement}
         * </div>
         * ```
         *
         * So absolutely positioned extra children will have a difference reference point
         * depending on whether you use `extraChildren` or
         * `extraChildrenOutsideContentElement`.
         */
        extraChildrenOutsideContentElement?:
            | ReactNode
            | ((props: {
                  contentHeight: number;
                  viewHeight: number;
                  shouldRenderWithRelativePositioning: boolean;
              }) => ReactNode);

        /**
         * If the height contributed by `extraChildren` could be larger than the view's
         * content height it's recommended you measure your `extraChildren`'s height and
         * pass it in here.
         *
         * We'll use this value in the DOM to make sure anyone setting `height: 100%`
         * includes the extra children content height.
         *
         * This is an advanced property. You probably don't need it.
         */
        extraChildrenContentHeight?: number;

        /**
         * If `contentHeight` is not an integer, round up to the nearest integer. So if
         * it's 100.2px we'll round up to 101px. Given scroll offset is always an integer,
         * it can be useful for content height to also always be an integer if you have
         * some manually positioned scroll linked UI outside the virtualized list (e.g.
         * asides in `<PostListView>`).
         */
        withRoundedContentHeight?: boolean;
    },
    ref: Ref<VirtualizedScrollViewRef>,
) {
    const {screenHeight} = useClientInfo();
    const spacingScale = useSpacingScale();

    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Cache the `getItem` function as long as the function reference doesn't change.
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
                const item = renderItemProp(index);
                return {
                    ...item,
                    minHeight:
                        typeof item.minHeight === "string"
                            ? convertRemLengthToPx(item.minHeight, spacingScale)
                            : item.minHeight,
                    originalMinHeight: item.minHeight,
                };
            });
    }, [renderItemProp, spacingScale]);

    const bufferedItemHeight = useMemo(
        () =>
            typeof bufferedItemHeightProp === "string"
                ? convertRemLengthToPx(bufferedItemHeightProp, spacingScale)
                : bufferedItemHeightProp,
        [bufferedItemHeightProp, spacingScale],
    );

    const initializeState = (): VirtualizedScrollViewActualState => {
        if (initialScrollOffset === "top") {
            return {
                key: stateKey,
                state: VirtualizedScrollViewState.initializeFromTop({
                    initialViewHeight:
                        typeof initialViewHeight === "string"
                            ? convertRemLengthToPx(initialViewHeight, spacingScale)
                            : (initialViewHeight ?? screenHeight),
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                isScrolling: false,
                isJumpScrolling: false,
                hasInitiallyScrolledRef: {current: false},
                scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
            };
        } else {
            return {
                key: stateKey,
                state: VirtualizedScrollViewState.initializeFromBottom({
                    initialViewHeight:
                        typeof initialViewHeight === "string"
                            ? convertRemLengthToPx(initialViewHeight, spacingScale)
                            : (initialViewHeight ?? screenHeight),
                    bufferedItemHeight,
                    itemCount,
                    getItem: getItemWithoutRender,
                }),
                isScrolling: false,
                isJumpScrolling: false,
                hasInitiallyScrolledRef: {current: false},
                scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
            };
        }
    };

    const [actualStateBeforeReInitialization, setActualState] = useState(initializeState);

    // If `stateKey` changed then re-initialize our state from scratch. We don't want
    // to fully remount the component so React only needs to re-render items that
    // changed.
    let actualState = actualStateBeforeReInitialization;
    if (actualState.key !== stateKey) {
        actualState = initializeState();
        setActualState(actualState);
    }

    let {state} = actualState;
    const {scrollAnchorAdjustmentDuringMobileWebKitScroll} = actualState;

    // Update the buffered item height in our state based on our props if necessary.
    state = state.setBufferedItemHeight(bufferedItemHeight);

    // For server side renders we include a `<script>` (see below) that scrolls our
    // element to the bottom.
    useLayoutEffectWithoutServerSideWarning(() => {
        // If the `stateKey` changed then we want to perform our initial scroll again.
        if (actualState.hasInitiallyScrolledRef.current) return;
        actualState.hasInitiallyScrolledRef.current = true;

        // Reset some state if we're re-rendering because the `stateKey` changed.
        scrollAnchorRef.current = null;

        const scrollElement = assertExists(scrollRef.current);

        if (initialScrollOffset !== "bottom") {
            lastScrollTopRef.current = scrollElement.scrollTop = 0;
            return;
        }

        lastScrollTopRef.current = scrollElement.scrollTop =
            scrollElement.scrollHeight - scrollElement.clientHeight;

        // When we initially scroll to the bottom, use the bottom of our view as our scroll
        // anchor. That way as we measure items rendered above the content doesn't shift
        // for the user.
        {
            const contentElement = assertExists(contentRef.current);
            let selectedElement: HTMLElement | null = null;
            let selectedKey: Key | null = null;

            // NOTE(calebmer): There's room to optimize this algorithm. If we keep our item
            // refs in sorted order we can break after we find the first item within the scroll
            // window.
            for (const [key, elementRef] of iterateItemRefs()) {
                // Ignore elements that are positioned within an element other than our absolutely
                // positioned content element. This could happen for items using custom layout.
                if (elementRef.element.offsetParent !== contentElement) continue;

                // Select the last element.
                if (
                    selectedElement === null ||
                    elementRef.element.offsetTop > selectedElement.offsetTop
                ) {
                    selectedKey = key;
                    selectedElement = elementRef.element;
                }
            }

            if (selectedElement) {
                const scrollAnchorElement = selectedElement;

                scrollAnchorRef.current = {
                    keyForDebugging: selectedKey!,
                    // Use the last element as the anchor until it is scrolled offscreen. Then resume
                    // regular anchor selection. (First visible element.)
                    shouldAnchorWhileVisible: true,
                    lastPosition: getElementPosition(
                        scrollElement,
                        scrollAnchorElement,
                        // Scroll anchor adjustment initializes to null.
                        null,
                    ),
                    getPosition: ({scrollAnchorAdjustmentDuringMobileWebKitScroll}) => {
                        if (!document.body.contains(scrollAnchorElement)) return null;
                        return getElementPosition(
                            scrollElement,
                            scrollAnchorElement,
                            scrollAnchorAdjustmentDuringMobileWebKitScroll,
                        );
                    },
                };
            }
        }
    }, [initialScrollOffset, actualState.hasInitiallyScrolledRef]);

    const itemsRef = useRef<{
        hasScheduledCleanup: boolean;
        generation: number;
        elementRefByKey: Map<
            Key,
            {
                generation: number;
                index: number;
                element: HTMLElement;
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
            ([, elementRef]) =>
                // Ignore refs from old generations. They will eventually be cleaned up.
                elementRef.generation === itemsRef.current.generation &&
                // Ignore refs that were removed from the DOM but have not been cleaned up yet.
                document.body.contains(elementRef.element),
        );

    // We don't know the heights of elements when server-side rendering so we should
    // render with relative positioning. Then when client rendering kicks in we'll
    // render with absolute positioning.
    //
    // We need to render with absolute positioning in order to accomplish virtual
    // scrolling so that we can remove rendered items from the top of the list while
    // maintaining the position of items lower in the list.
    const shouldRenderWithRelativePositioning = useIsInitialAppRender();

    const {
        state: newStateAfterRender,
        children,
        contentHeight,
        bufferedHeightBeforeChildren,
        renderedRange,
    } = state.render({
        itemCount,
        alwaysRenderAdditionalItemIndexes,
        getItem: (index: number) => {
            const item = getItemWithoutRender(index);

            return {
                key: item.key,
                minHeight: item.minHeight,
                zIndex: item.zIndex,
                renderAdditionalItemIndexes: item.renderAdditionalItemIndexes,
                render: ({
                    offset,
                    height,
                    minHeight,
                    zIndex,
                    getPositionByIndex,
                    viewHeight,
                    originalContentHeight,
                }) => {
                    const ref = (element: HTMLElement | null) => {
                        // To make sure `itemsRef` doesn't grow forever, we occasionally clean it up. We
                        // need to wait for all `ref`s to fire in this render to know which refs are
                        // actually unused now.
                        if (!itemsRef.current.hasScheduledCleanup) {
                            itemsRef.current.hasScheduledCleanup = true;
                            itemsRef.current.generation++;

                            scheduleAfterNextBrowserPaint(() => {
                                itemsRef.current.hasScheduledCleanup = false;

                                for (const [key, elementRef] of itemsRef.current.elementRefByKey) {
                                    // If this ref is a part of the current generation it will not be cleaned up.
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

                        // If the element hasn't change for this item key, update the ref to the current
                        // generation so it doesn't get cleaned up.
                        if (currentElementRef && currentElementRef.element === element) {
                            currentElementRef.generation = itemsRef.current.generation;

                            // The key for an item may stay stable while the index changes.
                            currentElementRef.index = index;
                        }
                        // Otherwise, cleanup the old ref (if it exists) and observe the height of the new
                        // element.
                        else {
                            currentElementRef?.cleanup();

                            const newElementRef: {
                                generation: number;
                                index: number;
                                element: HTMLElement;
                                lastRenderedHeight: number | null;
                                cleanup: () => void;
                            } = {
                                generation: itemsRef.current.generation,
                                index,
                                element,
                                lastRenderedHeight: currentElementRef?.lastRenderedHeight ?? null,
                                cleanup: () => {
                                    removeResizeListenerForElement(element, handleResize);
                                    removeSuppressResizeLoopErrorNotificationForElement(element);
                                },
                            };

                            // IMPORTANT: Be careful about using props in this function because we will capture
                            // a version of props when the component is rendered.
                            const handleResize = (entry: ResizeObserverEntry) => {
                                // We must use `entry.borderBoxSize` so we get the sub-pixel height. `offsetHeight`
                                // is rounded (at least on iOS Safari).
                                const height = entry.borderBoxSize[0]?.blockSize ?? 0;

                                // If the element was removed from the DOM its height will be zero. Don't record
                                // that height.
                                if (!document.body.contains(element)) return;

                                // If the height didn't change, don't bother setting state.
                                if (height === newElementRef.lastRenderedHeight) return;

                                // NOTE(calebmer): We can't update the rendered range inline here because we will
                                // have captured stale `itemCount` and `renderItem` props.
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

                            // When a virtualized item resizes then the content height of the full virtualized
                            // view also changes. `ResizeObserver` doesn't like this and logs an error instead
                            // of notifying us about the content height change. The state update we make for
                            // this resize considers the content height changing so it's ok that we don't get
                            // the content height change notification from `ResizeObserver`.
                            addSuppressResizeLoopErrorNotificationForElement(element);

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
                            minHeight,
                            zIndex,
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
                                    zIndex,
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
        // NOTE(calebmer, 2024-04-02): Added the scroll anchor element key to aid in
        // debugging. It's not currently used to control any virtualized scroll view
        // behavior. The original design goal of the scroll anchor type was to have no
        // knowledge of virtualized scroll view state and anchor only based on information
        // from the DOM. It's ok if this changes but for now only use the key while
        // debugging.
        keyForDebugging: Key;
        // If you manually set a scroll anchor you can set this flag so it won't change on
        // scroll and will continue to be the anchor as long as it is in the scroll window.
        shouldAnchorWhileVisible: boolean;
        lastPosition: {
            offset: number;
            height: number;
            previousElementSibling: Element | null | "ignore";
            nextElementSibling: Element | null | "ignore";
        };
        getPosition: (actualState: {
            state: VirtualizedScrollViewState;
            scrollAnchorAdjustmentDuringMobileWebKitScroll: number | null;
        }) => {
            offset: number;
            height: number;
            previousElementSibling: Element | null | "ignore";
            nextElementSibling: Element | null | "ignore";
        } | null;
    } | null>(null);

    // Implement an anchor node selection algorithm. Ours is simpler than the generic
    // browser algorithm. We only look at our item elements.
    // https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md#anchor-node-selection
    const updateScrollAnchor = () => {
        const contentElement = assertExists(contentRef.current);
        const scrollElement = assertExists(scrollRef.current);
        const clientHeight = scrollElement.clientHeight;
        const scrollTop =
            scrollElement.scrollTop + (scrollAnchorAdjustmentDuringMobileWebKitScroll ?? 0);

        // If the scroll anchor was manually set and it's currently visible then don't
        // update the scroll anchor to something different.
        if (scrollAnchorRef.current !== null && scrollAnchorRef.current.shouldAnchorWhileVisible) {
            const scrollAnchorPosition = scrollAnchorRef.current.getPosition(
                actualState.state !== state
                    ? {
                          state,
                          scrollAnchorAdjustmentDuringMobileWebKitScroll:
                              actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll,
                      }
                    : actualState,
            );

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

        let selectedElement: HTMLElement | null = null;
        let selectedKey: Key | null = null;

        // NOTE(calebmer): There's room to optimize this algorithm. If we keep our item
        // refs in sorted order we can break after we find the first item within the scroll
        // window.
        for (const [key, elementRef] of iterateItemRefs()) {
            // Ignore elements that are positioned within an element other than our absolutely
            // positioned content element. This could happen for items using custom layout.
            if (elementRef.element.offsetParent !== contentElement) continue;

            if (
                // Start our comparison with the first element we see.
                selectedElement === null ||
                // Pick the earliest element in the scroll view.
                elementRef.element.offsetTop < selectedElement.offsetTop ||
                // If the current element is completely outside the scroll window, then prefer an
                // element inside the scroll window.
                (selectedElement.offsetTop + selectedElement.offsetHeight < scrollTop &&
                    elementRef.element.offsetTop < scrollTop + clientHeight)
            ) {
                selectedKey = key;
                selectedElement = elementRef.element;
            }
        }

        if (selectedElement === null) {
            scrollAnchorRef.current = null;
        } else {
            const scrollAnchorElement = selectedElement;

            scrollAnchorRef.current = {
                keyForDebugging: selectedKey!,
                shouldAnchorWhileVisible: false,
                lastPosition: getElementPosition(
                    scrollElement,
                    scrollAnchorElement,
                    scrollAnchorAdjustmentDuringMobileWebKitScroll,
                ),
                getPosition: ({scrollAnchorAdjustmentDuringMobileWebKitScroll}) => {
                    if (!document.body.contains(scrollAnchorElement)) return null;
                    return getElementPosition(
                        scrollElement,
                        scrollAnchorElement,
                        scrollAnchorAdjustmentDuringMobileWebKitScroll,
                    );
                },
            };
        }
    };

    const hasHandledScrollThisAnimationFrameRef = useRef(false);
    const lastScrollTopRef = useRef<number | null>(null);
    const scrollDebounceTimeoutRef = useRef<Timeout | null>(null);
    const isScrollToIndexEventRef = useRef(false);

    const handleScroll = () => {
        // Only handle scroll events once per animation frame.
        if (hasHandledScrollThisAnimationFrameRef.current) return;
        hasHandledScrollThisAnimationFrameRef.current = true;
        requestAnimationFrame(() => {
            hasHandledScrollThisAnimationFrameRef.current = false;
        });

        // Update the scroll anchor whenever our scroll position changes since there may be
        // a new node that's first in the scroll window.
        updateScrollAnchor();

        const {scrollTop} = assertExists(scrollRef.current);

        onScroll?.(scrollTop);

        const isScrollToIndexEvent = isScrollToIndexEventRef.current;
        if (isScrollToIndexEvent) isScrollToIndexEventRef.current = false;

        // Optimization: Our code may update `scrollTop` like when adjusting due to content
        // size changes. When this happens we update `lastScrollTopRef.current` with the
        // new scroll top position. We can skip going to an `isScrolling` state if we've
        // already "seen" this `scrollTop`.
        if (scrollTop === lastScrollTopRef.current && !isScrollToIndexEvent) return;

        const run = () => {
            // If the user is scrolling fast we enter a jump scroll state. We will not update
            // the rendered range until after the jump scroll has finished to maintain high
            // performance as the user jumps through the scrollable view.
            //
            // The threshold for jump scrolling is the user has moved more than two scroll view
            // heights in the last render frame. As long as the user maintains that speed we
            // will continue the jump scroll. If scrolling decelerates (like in an iOS toss
            // scroll which maintains scrolling momentum a while) the jump scroll ends.
            const isJumpScrolling =
                !isScrollToIndexEvent &&
                lastScrollTopRef.current !== null &&
                Math.abs(lastScrollTopRef.current - scrollTop) >
                    (getVirtualizationWindowHeight(state.getViewHeight()) - state.getViewHeight()) *
                        2;

            setActualState(actualState => {
                if (actualState.isJumpScrolling || isJumpScrolling) {
                    if (actualState.isJumpScrolling) return actualState;
                    return {...actualState, isJumpScrolling: true};
                } else {
                    // Sometimes React tries to eagerly compute the next state. Then will rebase during
                    // render.
                    //
                    // If the `itemCount` changed we need to wait for React to render before calling
                    // `updateRenderedRange()` or else it will throw. So if we detect an incorrect item
                    // count then React is probably trying to eagerly evaluate this state update.
                    // Return a new state value to trigger a re-render and React should properly apply
                    // state updates from there.
                    if (itemCount !== actualState.state.getItemCount()) {
                        return {...actualState};
                    }

                    return updateVirtualizedScrollViewActualStateRenderedRange(
                        !actualState.isScrolling &&
                            // Optimization: During `scrollToIndex()` we don't mark `isScrolling: true` since
                            // we want one immediate render instead of engaging continuous scroll behavior.
                            !isScrollToIndexEvent
                            ? {...actualState, isScrolling: true}
                            : actualState,
                        {
                            itemCount,
                            getItemWithoutRender,
                            scrollTop,
                        },
                    );
                }
            });

            scrollDebounceTimeoutRef.current?.clear();

            const runScrollDebounceTimeout = () => {
                scrollDebounceTimeoutRef.current = null;

                // Transition this render because if it's a jump scroll or if items change based on
                // `isScrolling` the render may be expensive and it will be useful to time slice.
                startTransition(() => {
                    setActualState(actualState => {
                        // If nothing changed, we don't need to update our state.
                        if (
                            !actualState.isJumpScrolling &&
                            !actualState.isScrolling &&
                            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll === null
                        ) {
                            return actualState;
                        }

                        actualState = {
                            ...actualState,
                            isScrolling: false,
                            // Reset the scroll adjustment on mobile WebKit once the user is done scrolling.
                            // This should update our rendered element's content height.
                            scrollAnchorAdjustmentDuringMobileWebKitScroll: null,
                        };

                        // If we were jump scrolling we need to update the rendered range at the end of the
                        // scroll.
                        if (!actualState.isJumpScrolling) return actualState;

                        // Sometimes React tries to eagerly compute the next state. Then will rebase during
                        // render.
                        //
                        // If the `itemCount` changed we need to wait for React to render before calling
                        // `updateRenderedRange()` or else it will throw. So if we detect an incorrect item
                        // count then React is probably trying to eagerly evaluate this state update.
                        // Return a new state value to trigger a re-render and React should properly apply
                        // state updates from there.
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
            };

            let timeout2: CallbackNode | null = null;

            const timeout1 = createTimeout(
                () => {
                    // Schedule a low priority callback to stop scrolling. That way the React scheduler
                    // finishes any current work and can interrupt the stop scroll update if it gets a
                    // higher priority render.
                    timeout2 = unstable_scheduleCallback(
                        unstable_LowPriority,
                        runScrollDebounceTimeout,
                    );
                },
                // This timeout can't be too short that it would interrupt an iOS momentum scroll.
                // In practice we found 100ms to be too short. As the momentum scroll slows down
                // and only 1px or so was moving at a time, this timeout would fire and there would
                // be a jump.
                //
                // However, we do want this value to be as short as possible so jump scrolls can
                // complete in a timely manner or UI disabled by `isScrolling` can be presented.
                // 250ms was found in practice to be one of the fastest values for this timeout
                // that doesn't cause jumps.
                250,
            );

            scrollDebounceTimeoutRef.current = {
                clear: () => {
                    timeout1.clear();
                    if (timeout2) {
                        unstable_cancelCallback(timeout2);
                    }
                },
            };

            // Finally, update the scroll top so we know what the last value was.
            lastScrollTopRef.current = scrollTop;
        };

        // If we're scrolling because of a `scrollToIndex()` call then `flushSync()` so we
        // synchronously render new items so there isn't a white flash with no content.
        if (isScrollToIndexEvent) {
            flushSync(run);
        } else {
            run();
        }
    };

    let scrollbarInsetTop: ScrollbarInsetDynamic | undefined;
    if (actualScrollbarInsetTop !== undefined) {
        scrollbarInsetTop = actualScrollbarInsetTop;
    } else if (scrollbarInsetTopItemIndex !== undefined) {
        const {offset, height} = state.getPositionByIndex(scrollbarInsetTopItemIndex);
        scrollbarInsetTop = offset + height;
    }

    let scrollbarInsetBottom: ScrollbarInset | undefined;
    if (actualScrollbarInsetBottom !== undefined) {
        scrollbarInsetBottom = actualScrollbarInsetBottom;
    } else if (scrollbarInsetBottomItemIndex !== undefined) {
        const {offset} = state.getPositionByIndex(scrollbarInsetBottomItemIndex);
        scrollbarInsetBottom = state.getContentHeight() - offset;
    }

    const stateRefCurrent = {
        state,
        itemCount,
        getItemWithoutRender,
        scrollbarInsetTop,
        scrollbarInsetBottom,
    };
    const stateRef = useRef(stateRefCurrent);
    useLayoutEffectWithoutServerSideWarning(() => {
        stateRef.current = stateRefCurrent;
    });

    const previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef = useRef(
        scrollAnchorAdjustmentDuringMobileWebKitScroll,
    );

    // When we clear `scrollAnchorAdjustmentDuringMobileWebKitScroll` from state, all
    // items shift as they find their correct positions. This layout effect counteracts
    // the shift to maintain the position in the scroll view the user was looking at.
    //
    // This must go before the below hook which adjusts `scrollTop` based on the
    // anchored element! Since `lastScrollTopRef.current` needs to be updated with the
    // cleared adjustment. Or else our anchor logic may think another adjustment needs
    // to be made.
    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollElement = assertExists(scrollRef.current);

        if (
            previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current !== null &&
            scrollAnchorAdjustmentDuringMobileWebKitScroll === null
        ) {
            lastScrollTopRef.current = scrollElement.scrollTop =
                // `scrollTop` rounds to an integer. Make sure `lastScrollTopRef.current` is an
                // integer too.
                Math.round(
                    scrollElement.scrollTop +
                        previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current,
                );
        }

        previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current =
            scrollAnchorAdjustmentDuringMobileWebKitScroll;
    }, [scrollAnchorAdjustmentDuringMobileWebKitScroll]);

    const lastStateKeyRef = useRef(actualState.key);

    // On every render:
    //
    // - Check if our item heights changed and update them. This is redundant with the
    //   resize observer but doing it here allows us to batch into one state update
    //   that also updates the rendered range all at once.
    //
    // - Update our rendered range. Many changes in props may affect what items need to
    //   be rendered outside of simply scroll changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        const hasStateKeyChanged = lastStateKeyRef.current !== actualState.key;
        if (hasStateKeyChanged) lastStateKeyRef.current = actualState.key;

        const scrollElement = assertExists(scrollRef.current);

        const heightByKey = new Map<Key, number>();

        for (const [key, elementRef] of iterateItemRefs()) {
            // We must use `getBoundingClientRect()` so we get the sub-pixel height.
            // `offsetHeight` is rounded (at least on iOS Safari).
            const {height} = elementRef.element.getBoundingClientRect();

            // If our state key changes, we need to call `setItemHeight()` for all items
            // regardless of the last rendered height. Since the state will have reset all
            // heights back to min heights.
            if (hasStateKeyChanged || height !== elementRef.lastRenderedHeight) {
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

        // Use the last scroll position we saw from a scroll event. NOT the current scroll
        // position in the DOM. This is so if the browser adjusted the scroll position
        // between our last scroll event and now (probably while React was updating the
        // DOM) we ignore those updates from the browser.
        //
        // Notably if the content height shrinks such that the old scroll top is
        // out-of-bounds the browser will change the scroll offset. However, if we have a
        // scroll anchor then we will also try to perform the same scroll adjustment here!
        // We don't want to apply this adjustment twice so ignore the browser adjustment
        // when computing our new `scrollTop`.
        const originalScrollTop = lastScrollTopRef.current ?? scrollElement.scrollTop;

        let scrollTop = originalScrollTop;
        let newScrollAnchorAdjustmentDuringMobileWebKitScroll =
            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll;

        // We want to perform our scroll anchoring adjustment whenever the anchor node
        // moves.
        //
        // All anchor node movements that we care about should be captured by this effect
        // (item height changes, view height changes) so we do the adjustment here.
        //
        // It means we can avoid calling `updateRenderedRange()` twice. Once here and once
        // again in the scroll event handler in response to our adjustment.
        if (scrollAnchorRef.current) {
            // Will return null if the scroll anchor was unmounted.
            const nextPosition = scrollAnchorRef.current.getPosition(
                actualState.state !== newState
                    ? {
                          state: newState,
                          scrollAnchorAdjustmentDuringMobileWebKitScroll:
                              actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll,
                      }
                    : actualState,
            );

            if (nextPosition) {
                const lastPosition = scrollAnchorRef.current.lastPosition;

                // If our scroll anchor moves in the DOM, we don't want to apply its scroll
                // adjustment! Elements moving _around_ our scroll anchor is fine but we want to
                // see that our scroll anchor remains attached to either its next sibling or
                // previous sibling before applying a scroll adjustment.
                //
                // Some test cases for you to try:
                //
                // 1. In a long chat, reload the page and scroll from the bottom to the top. Scroll
                //    anchor adjustments _should_ be applied to make the scrolling feel smooth.
                //
                // 2. In a long chat, reply to a message near the top of the chat. Then reload the
                //    page and jump to that message. Scroll anchor adjustments _should_ be applied
                //    to make sure while data loads around the anchored message the anchored
                //    message stays centered.
                if (
                    nextPosition.nextElementSibling === "ignore" ||
                    nextPosition.previousElementSibling === "ignore" ||
                    lastPosition.nextElementSibling === "ignore" ||
                    lastPosition.previousElementSibling === "ignore" ||
                    nextPosition.nextElementSibling === lastPosition.nextElementSibling ||
                    nextPosition.previousElementSibling === lastPosition.previousElementSibling
                ) {
                    const scrollAdjustment = nextPosition.offset - lastPosition.offset;

                    // If this is not a mobile WebKit scroll, actually update the `scrollTop`. On
                    // mobile WebKit this cancels the scrolling animation so instead we have a piece of
                    // state we use to implement a more hacky version of scroll adjustments that
                    // doesn't disrupt the scroll.
                    if (newScrollAnchorAdjustmentDuringMobileWebKitScroll === null) {
                        // `element.scrollTop` rounds to an integer. Make sure `lastScrollTopRef.current`
                        // and everything else is an integer too.
                        scrollTop = Math.round(scrollTop + scrollAdjustment);
                        if (scrollTop !== originalScrollTop) {
                            lastScrollTopRef.current = scrollElement.scrollTop = scrollTop;
                        }
                    } else {
                        newScrollAnchorAdjustmentDuringMobileWebKitScroll += scrollAdjustment;
                    }
                }

                scrollAnchorRef.current.lastPosition = nextPosition;
            }
        }

        // Make sure our new scroll top is in bounds. Since our scroll top starts from
        // `lastScrollTopRef` instead of the scroll offset in the DOM we may be out of
        // bounds.
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
        // NOTE (rmtobin, 2026-04-01): This is an attempt to fix
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/yczy9sa0ffx006gedsyzr79gz4
        // I'm not super confident this fix will work since the bug is not consistently
        // reproducible. But it shouldn't hurt anything to have this check.
        if (newActualState !== actualState) {
            setActualState(newActualState);
        }
    }, [getItemWithoutRender, itemCount, actualState, state]);

    // Effect to report the rendered range back to our callback.
    const events = useEvents({
        onRenderedRangeChange: onRenderedRangeChange ?? noop,
        onRenderedRangeLayoutChange: onRenderedRangeLayoutChange ?? noop,
        onStateChange: onStateChange ?? noop,
    });
    const renderedRangeRef = useRef(
        renderedRange
            ? {startIndex: renderedRange.startIndex, endIndex: renderedRange.endIndex}
            : null,
    );

    // Optimization: Record the last rendered height for all our items so we don't need
    // to set the height again on every update.
    useEffect(() => {
        for (const [key, elementRef] of iterateItemRefs()) {
            const position = state.getPositionByKeyIfExists(key);
            if (position) elementRef.lastRenderedHeight = position.height;
        }

        // We call `onStateChange()` here since we already depend on `state` exclusively as
        // a dependency for this effect.
        events.onStateChange();
    }, [events, state]);

    // Watch size changes to the view element to make sure we update the height.
    useLayoutEffectWithoutServerSideWarning(() => {
        const scrollElement = assertExists(scrollRef.current);

        const handleResize = () => {
            const viewHeight = scrollElement.clientHeight;

            if (stateRef.current.state.getViewHeight() === viewHeight) return;

            setActualState(actualState => {
                if (actualState.state.getViewHeight() === viewHeight) return actualState;
                return {...actualState, state: actualState.state.setViewHeight(viewHeight)};
            });
        };

        // If the scroll element height changes we immediately re-render our virtualized
        // scroll view with the new height which may change the layout of any number of
        // elements (e.g. the virtualization window changes so we render new items with new
        // heights).
        addSuppressResizeLoopErrorNotificationForElement(scrollElement);

        addResizeListenerForElement(scrollElement, handleResize);

        return () => {
            removeSuppressResizeLoopErrorNotificationForElement(scrollElement);
            removeResizeListenerForElement(scrollElement, handleResize);
        };
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Make sure we only take effect dependencies on the start and end index. We don't
        // care about other properties of the rendered range changing.
        const startIndex = renderedRange?.startIndex;
        const endIndex = renderedRange?.endIndex;

        let range: {startIndex: number; endIndex: number} | null;
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

        events.onRenderedRangeLayoutChange(range);
    }, [events, renderedRange?.endIndex, renderedRange?.startIndex]);

    useEffect(() => {
        // Use the updated rendered range from the layout effect above. We need to call a
        // rendered range change in both a layout effect and regular effect.
        events.onRenderedRangeChange(renderedRangeRef.current);
    }, [events, renderedRange?.endIndex, renderedRange?.startIndex]);

    useImperativeHandle(ref, (): VirtualizedScrollViewRef => {
        const scrollToIndex = (index: number, {withAnchor}: {withAnchor: boolean}) => {
            // Scheduled in a microtask so that if there is a pending immediate React state
            // update it can be applied before we perform the scroll.
            //
            // To repro the bug this fixes: open a peek for a link to a comment in a post near
            // the bottom of the post.
            //
            // What happens here is:
            //
            // 1. We run an initial layout effect in `<VirtualizedScrollView>` with the correct
            //    view height and initially rendered item heights.
            // 2. This schedules an immediate, synchronous, React update for
            //    `<VirtualizedScrollView>`.
            // 3. React synchronously flushes all parent component `useEffect()`s. Including
            //    the `useEffect()` in `<PostView>` that scrolls to a comment.
            // 4. `scrollToIndex()` is called but `stateRef` does not match what is in the DOM.
            //    While in the DOM we have elements with the correct measurements, in React we
            //    haven't run our second immediate scheduled update which will update state.
            // 5. `scrollToIndex()` scrolls to the wrong location unless we have the
            //    `scheduleMicrotask()` wrapper which runs `scrollToIndex()` after the React
            //    immediately scheduled re-render that updates state.
            scheduleMicrotask(() => {
                const {state, getItemWithoutRender, scrollbarInsetTop, scrollbarInsetBottom} =
                    stateRef.current;
                const scrollElement = assertExists(scrollRef.current);

                const {scrollOffset, position} = getVirtualizedScrollViewOffsetForScrollToIndex({
                    state,
                    index,
                    scrollElement,
                    scrollbarInsetTop,
                    scrollbarInsetBottom,
                });

                const {key} = getItemWithoutRender(index);

                if (withAnchor) {
                    // Once an item has rendered, use its DOM position instead of looking at state.
                    const initialItemRef = itemsRef.current.elementRefByKey.get(key);
                    const initialElement =
                        initialItemRef?.generation === itemsRef.current.generation
                            ? initialItemRef.element
                            : null;

                    // Anchor to the item we are scrolling to. At first when the item hasn't rendered
                    // we use the position we found in our state. Then once we find the item was
                    // rendered in the DOM we use the position of the related DOM node.
                    //
                    // The position we initially render our item in the DOM may be different from the
                    // computed position which is why we need to capture the computed position here.
                    scrollAnchorRef.current = {
                        keyForDebugging: key,
                        shouldAnchorWhileVisible: true,
                        lastPosition: initialElement
                            ? getElementPosition(
                                  scrollElement,
                                  initialElement,
                                  previousScrollAnchorAdjustmentDuringMobileWebKitScrollRef.current,
                              )
                            : {
                                  ...position,
                                  // If the item isn't rendered, we can't know adjacent elements.
                                  previousElementSibling: "ignore",
                                  nextElementSibling: "ignore",
                              },
                        getPosition: ({state, scrollAnchorAdjustmentDuringMobileWebKitScroll}) => {
                            // Once an item has rendered, use its DOM position instead of looking at state.
                            const itemRef = itemsRef.current.elementRefByKey.get(key);
                            const element =
                                itemRef?.generation === itemsRef.current.generation
                                    ? itemRef.element
                                    : null;
                            if (element) {
                                return getElementPosition(
                                    scrollElement,
                                    element,
                                    scrollAnchorAdjustmentDuringMobileWebKitScroll,
                                );
                            }

                            const position =
                                state.getPositionByKeyIfExists(key) ??
                                (index < state.getItemCount()
                                    ? state.getPositionByIndex(index)
                                    : null);

                            if (position === null) return null;

                            // We use the virtualized scroll view state to get the position instead of DOM
                            // nodes because while scrolling to an item it may not be rendered in the
                            // virtualization window but we still need the position.
                            //
                            // By using the latest state we can also see updates that haven't been written to
                            // the DOM yet which causes less churn in scroll anchor adjustments.
                            return {
                                ...position,
                                // If the item isn't rendered, we can't know adjacent elements.
                                previousElementSibling: "ignore",
                                nextElementSibling: "ignore",
                            };
                        },
                    };
                }

                // Actually perform the scroll.
                //
                // We perform this after setting the scroll anchor to make sure any event listeners
                // see the new scroll anchor.
                //
                // We set `isScrollToIndexEventRef` to avoid considering this as a jump scroll
                // which prevents rendering for a bit.
                if (scrollElement.scrollTop !== scrollOffset) {
                    isScrollToIndexEventRef.current = true;
                    lastScrollTopRef.current = scrollOffset;
                    scrollElement.scrollTop = scrollOffset;
                }
            });
        };

        return {
            getHeight: () => assertExists(scrollRef.current).clientHeight,
            getContentHeight: () => {
                // Get the scroll height based exclusively on our first `<div>`. Use
                // `getBoundingClientRect()` so we have sub-pixel accuracy.
                return assertExists(scrollRef.current?.firstElementChild).getBoundingClientRect()
                    .height;
            },
            getRenderedRange: () => renderedRangeRef.current,
            scrollToIndex,
            scrollToKeyIfExists: (key, options) => {
                const state = stateRef.current.state;
                const index = state.getIndexByKeyIfExists(key);
                if (index === null) return;
                scrollToIndex(index, options);
            },
            getScrollOffset: () => {
                return assertExists(scrollRef.current).scrollTop;
            },
            setScrollOffset: (scrollOffset, {behavior = "instant"} = {}) => {
                const scrollElement = assertExists(scrollRef.current);

                if (behavior === "smooth") {
                    scrollElement.scrollTo({top: scrollOffset, behavior: "smooth"});
                } else {
                    scrollElement.scrollTop = scrollOffset;
                }
            },
            getKeyByIndexIfExists: index => {
                const state = stateRef.current.state;
                return state.getKeyByIndexIfExists(index);
            },
            getIndexByKeyIfExists: key => {
                const state = stateRef.current.state;
                return state.getIndexByKeyIfExists(key);
            },
            getPositionByIndex: index => {
                const state = stateRef.current.state;
                return state.getPositionByIndex(index);
            },
            getPositionByKeyIfExists: key => {
                const state = stateRef.current.state;
                return state.getPositionByKeyIfExists(key);
            },
            peekRenderedRangeAfterScrollToIndex: index => {
                const {state, scrollbarInsetTop, scrollbarInsetBottom} = stateRef.current;
                const scrollElement = assertExists(scrollRef.current);

                const {scrollOffset} = getVirtualizedScrollViewOffsetForScrollToIndex({
                    state,
                    index,
                    scrollElement,
                    scrollbarInsetTop,
                    scrollbarInsetBottom,
                });

                const peekState = state.updateRenderedRange({
                    scrollOffset,
                    itemCount: stateRef.current.itemCount,
                    getItem: stateRef.current.getItemWithoutRender,
                });

                return peekState.getRenderedRange();
            },
            peekRenderedRangeAfterSetScrollOffset: scrollOffset => {
                const state = stateRef.current.state;

                const peekState = state.updateRenderedRange({
                    scrollOffset,
                    itemCount: stateRef.current.itemCount,
                    getItem: stateRef.current.getItemWithoutRender,
                });

                return peekState.getRenderedRange();
            },
            getElement: () => assertExists(scrollRef.current),
            getContentElement: () => assertExists(contentRef.current),
            getElementByKeyIfExists: key => {
                const itemRef = itemsRef.current.elementRefByKey.get(key);
                if (itemRef?.generation !== itemsRef.current.generation) return null;
                return itemRef.element;
            },
        };
    }, []);

    let actualContentHeight = Math.max(contentHeight, extraChildrenContentHeight);
    if (withRoundedContentHeight) actualContentHeight = Math.ceil(actualContentHeight);

    return (
        <>
            <div
                ref={useMergedRefs(
                    scrollRef,
                    useScrollbar({
                        insetTop: scrollbarInsetTop,
                        insetBottom: scrollbarInsetBottom,
                        getScrollHeight: useCallback(() => {
                            // Get the scroll height based exclusively on our first `<div>`. Use
                            // `getBoundingClientRect()` so we have sub-pixel accuracy.
                            return assertExists(
                                scrollRef.current?.firstElementChild,
                            ).getBoundingClientRect().height;
                        }, []),
                    }),
                    elementRefProp,
                )}
                data-testid={dataTestId}
                className={sprinkles({
                    flexGrow: "1",
                    position: "relative",
                    height: "full",
                    overflowX: "hidden",
                    overflowY: "auto",
                })}
                style={{
                    // Opt-out of scroll anchoring. We need to manually implement scroll anchoring for
                    // our virtualized scroll view.
                    //
                    // See: https://github.com/WICG/ScrollAnchoring/blob/master/explainer.md
                    overflowAnchor: "none",
                    // Make sure we use momentum-based scrolling on iOS.
                    WebkitOverflowScrolling: "touch",
                }}
                onScroll={handleScroll}
            >
                <div style={{height: actualContentHeight}} />
                <div
                    ref={contentRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0 - (scrollAnchorAdjustmentDuringMobileWebKitScroll ?? 0),
                        height: actualContentHeight,
                        zIndex: "0", // Make sure we create a new z-index stacking context
                    }}
                >
                    <OverlayScopeContextProvider>
                        {extraChildren && (
                            <div
                                style={{
                                    // We need to render extra children in an absolutely positioned `<div>` so it
                                    // doesn't affect server side rendering.
                                    position: "absolute",
                                    inset: 0,
                                    pointerEvents: "none",
                                }}
                            >
                                {typeof extraChildren === "function"
                                    ? extraChildren({
                                          contentHeight,
                                          viewHeight: state.getViewHeight(),
                                          shouldRenderWithRelativePositioning,
                                      })
                                    : extraChildren}
                            </div>
                        )}
                        {shouldRenderWithRelativePositioning &&
                            bufferedHeightBeforeChildren > 0 && (
                                <div style={{height: bufferedHeightBeforeChildren}} />
                            )}
                        {children}
                    </OverlayScopeContextProvider>
                </div>
                {extraChildrenOutsideContentElement && (
                    <div
                        style={{
                            // We need to render extra children in an absolutely positioned `<div>` so it
                            // doesn't affect server side rendering.
                            position: "absolute",
                            inset: 0,
                            pointerEvents: "none",
                        }}
                    >
                        {typeof extraChildrenOutsideContentElement === "function"
                            ? extraChildrenOutsideContentElement({
                                  contentHeight,
                                  viewHeight: state.getViewHeight(),
                                  shouldRenderWithRelativePositioning,
                              })
                            : extraChildrenOutsideContentElement}
                    </div>
                )}
            </div>
            {initialScrollOffset === "bottom" && (
                // When server side rendering this component, we want it to be immediately scrolled
                // to the bottom. There should be no flash where the element is scrolled to the
                // top.
                //
                // That means we need to scroll the element to the bottom before our JavaScript
                // code loads and React component mounts. So inject a small `<script>` element in
                // the page on server side render to do just that.
                //
                // We set the scroll position in a `requestAnimationFrame()` because we need to set
                // the scroll position before the first browser render but after other elements in
                // the DOM have been lain out.
                <ScriptBeforeAppInitialRender
                    script={safe`const element = document.currentScript.previousElementSibling; requestAnimationFrame(() => { element.scrollTop = element.scrollHeight - element.clientHeight })`}
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
        key: actualState.key,
        state,
        isScrolling: actualState.isScrolling,
        isJumpScrolling: false,
        hasInitiallyScrolledRef: actualState.hasInitiallyScrolledRef,
        scrollAnchorAdjustmentDuringMobileWebKitScroll:
            actualState.scrollAnchorAdjustmentDuringMobileWebKitScroll ??
            (isMobileWebKit ? 0 : null),
    };
}

function getVirtualizedScrollViewOffsetForScrollToIndex({
    state,
    index,
    scrollElement,
    scrollbarInsetTop = 0,
    scrollbarInsetBottom = 0,
}: {
    state: VirtualizedScrollViewState;
    index: number;
    scrollElement: HTMLElement;
    scrollbarInsetTop: ScrollbarInsetDynamic | undefined;
    scrollbarInsetBottom: ScrollbarInset | undefined;
}): {scrollOffset: number; position: {offset: number; height: number}} {
    const remPx = getRemPxWithoutListening();
    const originalViewHeight = state.getViewHeight();
    const position = state.getPositionByIndex(index);
    const scrollOffset = scrollElement.scrollTop;

    // Equivalent of `spacing["4"]`
    const margin = remPx;

    const viewInsetTop = convertScrollbarInsetDynamicToPx(scrollbarInsetTop, remPx, scrollElement);
    const viewInsetBottom = convertScrollbarInsetToPx(scrollbarInsetBottom, remPx);

    // Modify the view window space for our scroll to exclude scrollbar inset space.
    //
    // Our custom scrollbar is inset as to not cover navigation bars and safe area. We
    // don't want to scroll an item underneath navigation bars and safe area so we
    // reuse the scrollbar inset here to avoid this.
    const viewTop = scrollOffset + viewInsetTop;
    const viewHeight = originalViewHeight - viewInsetTop - viewInsetBottom;
    const viewBottom = viewTop + viewHeight;

    // NOTE(calebmer): When scrolling to an unmeasured item we won't know the height!
    // This means we may render a large item too far down the view. Maybe we should
    // measure the item before scrolling to it?
    //
    // If we keep the item we're scrolling to rendered during the scroll that would
    // also prevent bugs where measuring items around it unmounts the item. We could
    // simplify some code like `getPosition` below which handles its `element` being
    // unmounted and `<MessageView>` which takes care to not animate if we might soon
    // unmount the message.
    const {offset, height} = position;

    // If the item is already partially visible, we make sure it is fully visible and
    // don't scroll anymore.
    if (areRangesOverlapping(offset, offset + height, viewTop, viewBottom)) {
        // If the item is bigger than the screen (excluding margins), don't change scroll
        // position.
        if (offset < viewTop + margin && offset + height > viewBottom - margin) {
            return {scrollOffset, position};
        }

        // If the item is visible but its top is out of the scroll view then figure out the
        // smallest scroll to make the item fully visible (either scrolling to top or
        // scrolling to bottom).
        if (offset < viewTop + margin) {
            const scrollOffset1 = offset - margin - viewInsetTop;
            const scrollOffset2 = offset + height - viewHeight + margin + viewInsetBottom;
            const scrollDelta1 = Math.abs(scrollOffset - scrollOffset1);
            const scrollDelta2 = Math.abs(scrollOffset - scrollOffset2);

            // Don't bother scrolling if we have a subpixel scroll delta. It's likely due to a
            // rounding error somewhere.
            if (scrollDelta1 < 1) return {scrollOffset, position};
            if (scrollDelta2 < 1) return {scrollOffset, position};

            return {
                scrollOffset: scrollDelta2 < scrollDelta1 ? scrollOffset2 : scrollOffset1,
                position,
            };
        }

        if (offset + height > viewBottom - margin) {
            return {
                scrollOffset: offset + height - viewHeight + margin,
                position,
            };
        }

        return {scrollOffset, position};
    }

    // Ideally we scroll the item one fifth down the screen so it's near the top but
    // there is some context surrounding it.
    let newScrollOffset = Math.max(0, offset - viewHeight / 5);

    // If there would be less than one fifth of the screen below the item then push the
    // item back up.
    const viewHeightBelow = newScrollOffset + viewHeight - (offset + height);
    newScrollOffset -= Math.min(0, viewHeightBelow - viewHeight / 5);

    // The top of the item should always be visible.
    newScrollOffset = Math.min(offset - margin, newScrollOffset);

    return {scrollOffset: newScrollOffset, position};
}

/**
 * Get an HTML element's position. We can't use `element.offsetTop` and
 * `element.offsetHeight` because they don't have subpixel precision. So instead we
 * need to build it from `getBoundingClientRect()`.
 *
 * You should be able to replace this with
 * `{offset: element.offsetTop, height: element.offsetHeight}` and get correct
 * results when subpixel rendering is not involved.
 */
function getElementPosition(
    scrollElement: HTMLElement,
    element: HTMLElement,
    scrollAnchorAdjustmentDuringMobileWebKitScroll: number | null,
): {
    offset: number;
    height: number;
    previousElementSibling: Element | null;
    nextElementSibling: Element | null;
} {
    const scrollRect = scrollElement.getBoundingClientRect();
    const rect = element.getBoundingClientRect();

    let offset =
        rect.top -
        scrollRect.top +
        scrollElement.scrollTop +
        // During mobile WebKit scrolls, any scroll adjustments we make aren't reflected in
        // `scrollElement.scrollTop` during the scroll.
        (scrollAnchorAdjustmentDuringMobileWebKitScroll ?? 0);

    if (Math.abs(offset - element.offsetTop) >= 1) {
        // Fallback to `element.offsetTop` if the calculated `offset` based on bounding
        // client rects is incorrect. We'll lose sub-pixel accuracy but get the right
        // result. This happens if `element` is animating with a CSS animation (e.g. task
        // grid view animates virtualized scroll view elements).
        offset = element.offsetTop;

        // Development debug warning. We want the offset we return to be equivalent to
        // `offsetTop` but with subpixel accuracy. If it's not equal, something's going
        // wrong!
        if (process.env.NODE_ENV !== "production") {
            let hasAnimations = false;

            let parentElement: HTMLElement | null = element;
            while (parentElement !== null) {
                if (parentElement.getAnimations().length > 0) {
                    hasAnimations = true;
                    break;
                }
                parentElement = parentElement.parentElement;
            }

            // Don't log if we call `element.getAnimations()` and there are some animations.
            // It's expected that we'll need to reset `offset` back to `element.offsetTop` if
            // there are animations.
            if (!hasAnimations) {
                // eslint-disable-next-line no-console
                console.warn(
                    "`<VirtualizedScrollView>` expected offset computed from element to be within 1px of `offsetTop`",
                    {actual: offset, expected: element.offsetTop},
                );
            }
        }
    }

    return {
        offset,
        height: rect.height,
        previousElementSibling: element.previousElementSibling,
        nextElementSibling: element.nextElementSibling,
    };
}
