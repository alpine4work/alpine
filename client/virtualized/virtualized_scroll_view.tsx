import {Key, Memo, ReactNode, RefObject, useMemo, useRef, useState} from "react";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {useClientInfo} from "~/client/helpers/client_info_context";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {safe} from "~/shared/helpers/string/safe_string";
import {sprinkles} from "~/shared/styles/styles";

export type VirtualizedScrollViewItem = {
    readonly minHeight: number;
    readonly key: Key;
    readonly node: ReactNode;
};

export type VirtualizedScrollViewRenderedRange = {
    readonly itemCount: number;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly bufferedLeadingHeight: number;
    readonly bufferedTrailingHeight: number;
};

export function VirtualizedScrollView({
    itemCount,
    renderItem: _renderItem,
    pinTo = "top",
}: {
    /**
     * The total number of virtualized items. You do not need all the items loaded
     * in memory but you should be able to render something whenever `getItem` is
     * called.
     */
    itemCount: number;

    /**
     * Render one of the items in our scroll view.
     *
     * The virtualized scroll view will only render a subset of all the items at
     * any time. This function may never be called for some items. Just because
     * this function is called does not mean the item is rendered! The component
     * may be trying to learn more about the shape of the list.
     *
     * We recommend memoizing this function (with `useCallback()`).
     */
    renderItem: Memo<(index: number) => VirtualizedScrollViewItem>;

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
}) {
    const {screenHeight} = useClientInfo();

    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const {scriptElement: pinToScriptElement} = useScrollViewPinTo(scrollRef, contentRef, pinTo);

    // Cache the `getItem` function as long as the function reference doesn't
    // change.
    const getItem = useMemo(() => {
        const itemByIndex = new Map<number, VirtualizedScrollViewItem>();

        return (index: number): VirtualizedScrollViewItem =>
            getOrSetDefaultMapValue(itemByIndex, index, _renderItem);
    }, [_renderItem]);

    const [possiblyOutOfBoundsRenderedRange, setRenderedRange] = useState(
        // This function determines our initial rendered range. It also needs to run
        // during server-side rendering.
        (): VirtualizedScrollViewRenderedRange | null => {
            if (itemCount === 0) return null;

            // We initially render enough items to fill the user's screen twice (so they
            // have space to scroll). Some of the screen is probably covered so this is
            // more than necessary but we'll never show blank content.
            const maxInitialRenderedHeight = screenHeight * 2;
            let renderedItemCount = 0;
            let initialRenderedHeight = 0;

            // If we are pinned to the top of the scroll view, render items at the top. If
            // we are pinned to the bottom of the scroll view, render items at the bottom.
            if (pinTo === "top") {
                for (let index = 0; index < itemCount; index++) {
                    const item = getItem(index);
                    renderedItemCount++;
                    initialRenderedHeight += item.minHeight;

                    if (initialRenderedHeight >= maxInitialRenderedHeight) {
                        return {
                            itemCount,
                            startIndex: 0,
                            endIndex: index,
                            bufferedLeadingHeight: 0,
                            // Estimate the height below our range by extrapolating using the rendered
                            // height so far.
                            bufferedTrailingHeight:
                                (itemCount - renderedItemCount) *
                                (initialRenderedHeight / renderedItemCount),
                        };
                    }
                }
            } else {
                for (let index = itemCount - 1; index >= 0; index--) {
                    const item = getItem(index);
                    renderedItemCount++;
                    initialRenderedHeight += item.minHeight;

                    if (initialRenderedHeight >= maxInitialRenderedHeight) {
                        return {
                            itemCount,
                            startIndex: index,
                            endIndex: itemCount - 1,
                            // Estimate the height above our range by extrapolating using the rendered
                            // height so far.
                            bufferedLeadingHeight:
                                (itemCount - renderedItemCount) *
                                (initialRenderedHeight / renderedItemCount),
                            bufferedTrailingHeight: 0,
                        };
                    }
                }
            }

            return {
                itemCount,
                startIndex: 0,
                endIndex: itemCount - 1,
                bufferedLeadingHeight: 0,
                bufferedTrailingHeight: 0,
            };
        },
    );

    // If item count changed such that our range in state is now out of bounds,
    // adjust our range so that it's back in bounds.
    const renderedRange = adjustVirtualizedScrollViewRenderedRange(
        possiblyOutOfBoundsRenderedRange,
        itemCount,
    );

    const [itemHeightByKey, setItemHeightByKey] = useState(ImmutableMap.empty<Key, number>());

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

    const children: Array<ReactNode> = [];
    let contentHeight = 0;
    if (renderedRange) {
        let renderedHeight = 0;

        for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
            const item = getItem(index);
            const itemTop = renderedRange.bufferedLeadingHeight + renderedHeight;
            const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;

            renderedHeight += itemHeight;

            children.push(
                <div
                    key={item.key}
                    style={{
                        minHeight: item.minHeight,
                        ...(shouldRenderWithRelativePositioning
                            ? {position: "relative"}
                            : {
                                  position: "absolute",
                                  top: itemTop,
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

                            let isFirstResize = true;

                            const handleResize = (entry: ResizeObserverEntry) => {
                                setItemHeightByKey(itemHeightByKey =>
                                    itemHeightByKey.set(item.key, entry.contentRect.height),
                                );

                                if (isFirstResize) {
                                    isFirstResize = false;
                                    const scrollElement = assertExists(scrollRef.current);

                                    // If we added an item above the scroll window fold then when we size the
                                    // element for the first time we don't want to change, visually, our scroll
                                    // position. Otherwise the virtualized list looks janky while the user scrolls
                                    // up, since scrolling up pushes the content they're looking at down.
                                    //
                                    // So we update the scroll position with the difference of our element's
                                    // measured height and the initial height we rendered the element with.
                                    //
                                    // To see the effect this code has: comment it out, get to the bottom of a long
                                    // virtualized scroll view with either `pinTo="bottom"` or using the cmd-down
                                    // keyboard shortcut, then scroll up a while.
                                    //
                                    // NOTE(calebmer): The `scheduleAfterNextBrowserPaint()` here makes no sense to
                                    // me. Without it scrolling up feels super janky and I have no idea why. But
                                    // with the callback things feels smooth as butter-which doesn't make sense??
                                    // I'd expect the browser to do a paint with the wrong `scrollTop` then run the
                                    // callback. `requestAnimationFrame()` also appears to work but subjectively
                                    // `scheduleAfterNextBrowserPaint()` feels more smooth?
                                    if (itemTop + itemHeight < scrollElement.scrollTop) {
                                        scheduleAfterNextBrowserPaint(() => {
                                            scrollElement.scrollTop +=
                                                entry.contentRect.height - itemHeight;
                                        });
                                    }
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
                </div>,
            );
        }

        contentHeight =
            renderedRange.bufferedLeadingHeight +
            renderedHeight +
            renderedRange.bufferedTrailingHeight;
    }

    const isHandlingScrollRef = useRef(false);
    const jumpScrollDebounceTimeoutRef = useRef<Timeout | null>(null);

    const handleScroll = () => {
        // Jump scrolls are handled on a debounce. Whenever the scroll state changes
        // cancel a scheduled jump scroll.
        jumpScrollDebounceTimeoutRef.current?.clear();
        jumpScrollDebounceTimeoutRef.current = null;

        if (isHandlingScrollRef.current) return;
        isHandlingScrollRef.current = true;

        // Throttle our scroll handling to once every animation frame in case the
        // scroll event fires multiple times in an animation frame.
        requestAnimationFrame(() => {
            isHandlingScrollRef.current = false;
            actuallyHandleScroll();
        });
    };

    const actuallyHandleScroll = () => {
        if (!renderedRange) return;

        const {scrollTop, clientHeight, scrollHeight} = assertExists(scrollRef.current);

        // The virtualized window is the range we expect to be filled with content. The
        // virtualized window changes on every scroll.
        const virtualizedWindowTop = Math.max(0, scrollTop - clientHeight / 2);
        const virtualizedWindowBottom = Math.min(
            scrollHeight,
            scrollTop + clientHeight + clientHeight / 2,
        );

        // The rendered range is the range we are currently filling with content. We
        // update the rendered range if we detect our rendered range does not fully
        // cover the virtualized window.
        const renderedRangeTop = renderedRange.bufferedLeadingHeight;
        const renderedRangeHeight =
            scrollHeight -
            renderedRange.bufferedLeadingHeight -
            renderedRange.bufferedTrailingHeight;
        const renderedRangeBottom = renderedRangeTop + renderedRangeHeight;

        // Is our rendered range fully covering the virtualized window?
        const isRenderedRangeCoveringVirtualizedWindow =
            renderedRangeTop <= virtualizedWindowTop &&
            renderedRangeBottom >= virtualizedWindowBottom;

        // Is our rendered range partially intersecting with the virtualized window?
        //
        // If this is true but `isRenderedRangeCoveringVirtualizedWindow` is false then
        // we're covering some of the virtualized window but not all of it. We need to
        // update our rendered range to cover the entire virtualized window.
        const isRenderedRangeIntersectingVirtualizedWindow = areRangesOverlapping(
            renderedRangeTop,
            renderedRangeBottom,
            virtualizedWindowTop,
            virtualizedWindowBottom,
        );

        // Our rendered range covers everything we want to render. Don't bother
        // updating it.
        if (isRenderedRangeCoveringVirtualizedWindow) return;

        let newStartIndex: number;
        let newEndIndex: number;
        let newBufferedLeadingHeight: number;
        let newBufferedTrailingHeight: number;

        const updateRenderedRange = () => {
            const correctBufferHeightItemLimit = 10;

            let minBufferedLeadingHeight = 0;
            for (
                let index = 0;
                index < Math.min(newStartIndex, correctBufferHeightItemLimit);
                index++
            ) {
                const item = getItem(index);
                const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;
                minBufferedLeadingHeight += itemHeight;
            }

            let minBufferedTrailingHeight = 0;
            for (
                let index = renderedRange.itemCount - 1;
                index >
                Math.max(newEndIndex, renderedRange.itemCount - 1 - correctBufferHeightItemLimit);
                index--
            ) {
                const item = getItem(index);
                const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;
                minBufferedTrailingHeight += itemHeight;
            }

            setRenderedRange({
                itemCount: renderedRange.itemCount,
                startIndex: newStartIndex,
                endIndex: newEndIndex,
                bufferedLeadingHeight:
                    // Safety mechanism: If we reach the start of the list, make sure leading height
                    // is zero. It should approach zero naturally but just in case.
                    newStartIndex === 0
                        ? 0
                        : // Safety mechanism: Make sure we always have at least 10 items worth of
                          // leading height. We use statistical mechanisms to compute buffered height
                          // and it's possible those mechanisms will under count at times. 10 items of
                          // height is cheap to compute.
                          Math.max(minBufferedLeadingHeight, newBufferedLeadingHeight),
                bufferedTrailingHeight:
                    // Safety mechanism: If we reach the end of the list, make sure trailing height
                    // is zero. It should approach zero naturally but just in case.
                    newEndIndex === renderedRange.itemCount - 1
                        ? 0
                        : // Safety mechanism: Make sure we always have at least 10 items worth of
                          // trailing height. We use statistical mechanisms to compute buffered height
                          // and it's possible those mechanisms will under count at times. 10 items of
                          // height is cheap to compute.
                          Math.max(minBufferedTrailingHeight, newBufferedTrailingHeight),
            });
        };

        // If our rendered range intersects our virtualized window then we move our
        // rendered range to adjacent items.
        //
        // Because each item has a dynamic height in order to find the position of item
        // N we need to iterate through the N previous items to find out their heights.
        // However, we know the position of the items in our rendered range so we can
        // easily find the position of an adjacent item outside the rendered range.
        if (isRenderedRangeIntersectingVirtualizedWindow) {
            let bufferedLeadingHeightDifference = 0;
            let bufferedTrailingHeightDifference = 0;

            newStartIndex = renderedRange.startIndex;
            let newStartIndexTop = renderedRangeTop;

            // Finds the last possible item in our list that covers the top of the
            // virtualized window through an iterative algorithm.
            //
            // 1. If our current start item is below the virtualized window top then we
            //    iteratively search previous items for the first item above the
            //    virtualized window top.
            //
            // 2. If our current start item is above the virtualized window top then we
            //    iteratively search the next items for the last possible item above the
            //    virtualized window top. This is optional. We do this to minimize the
            //    number of items we need to render. Our current start item would also
            //    cover the virtualized window.
            if (newStartIndexTop > virtualizedWindowTop) {
                while (newStartIndex > 0 && newStartIndexTop > virtualizedWindowTop) {
                    const item = getItem(newStartIndex - 1);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;

                    newStartIndex -= 1;
                    newStartIndexTop -= itemHeight;
                    bufferedLeadingHeightDifference -= itemHeight;
                }
            } else {
                while (newStartIndex < renderedRange.endIndex) {
                    const item = getItem(newStartIndex);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;

                    // Stop moving forwards if it would cause us to not cover our
                    // virtualized window.
                    if (newStartIndexTop + itemHeight > virtualizedWindowTop) break;

                    newStartIndex += 1;
                    newStartIndexTop += itemHeight;
                    bufferedLeadingHeightDifference += itemHeight;
                }
            }

            newEndIndex = renderedRange.endIndex;
            let newEndIndexBottom = renderedRangeBottom;

            // Finds the first possible item in our list that covers the bottom of the
            // virtualized window through an iterative algorithm.
            //
            // 1. If our current end item is above the virtualized window bottom then we
            //    iteratively search the next items for the first item below the
            //    virtualized window bottom.
            //
            // 2. If our current end item is below the virtualized window bottom then we
            //    iteratively search previous items for the last possible item below the
            //    virtualized window bottom. This is optional. We do this to minimize the
            //    number of items we need to render. Our current end item would also cover
            //    the virtualized window.
            if (newEndIndexBottom < virtualizedWindowBottom) {
                while (newEndIndex < itemCount - 1 && newEndIndexBottom < virtualizedWindowBottom) {
                    const item = getItem(newEndIndex + 1);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;

                    newEndIndex += 1;
                    newEndIndexBottom += itemHeight;
                    bufferedTrailingHeightDifference -= itemHeight;
                }
            } else {
                while (newEndIndex > renderedRange.startIndex) {
                    const item = getItem(newEndIndex);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;

                    // Stop moving back if it would cause us to not cover our
                    // virtualized window.
                    if (newEndIndexBottom - itemHeight < virtualizedWindowBottom) break;

                    newEndIndex -= 1;
                    newEndIndexBottom -= itemHeight;
                    bufferedTrailingHeightDifference += itemHeight;
                }
            }

            newBufferedLeadingHeight =
                renderedRange.bufferedLeadingHeight + bufferedLeadingHeightDifference;
            newBufferedTrailingHeight =
                renderedRange.bufferedTrailingHeight + bufferedTrailingHeightDifference;
            updateRenderedRange();
        }
        // If our rendered range doesn't intersect the virtualized window, we guess a
        // new range of indexes to render based on what percentage we are through the
        // buffered area. It's expensive to compute the actual item at a given scroll
        // position because we'd need to iterate through all items before that one.
        else {
            // Jump scrolls are expensive (they change a lot of the screen) so put it
            // behind a debounce. If we can't scroll as fast as the mouse while the user is
            // scrubbing there will be some desync between the user's mouse and scrollbar
            // which feels janky.
            jumpScrollDebounceTimeoutRef.current = createTimeout(() => {
                const oldContentHeight =
                    renderedRangeHeight +
                    renderedRange.bufferedLeadingHeight +
                    renderedRange.bufferedTrailingHeight;

                const virtualizedWindowMiddle =
                    virtualizedWindowTop + (virtualizedWindowBottom - virtualizedWindowTop) / 2;

                const isVirtualizedWindowMiddleInBufferedLeadingHeight =
                    virtualizedWindowMiddle < renderedRangeTop;
                const isVirtualizedWindowMiddleInBufferedTrailingHeight =
                    renderedRangeBottom < virtualizedWindowMiddle;

                // The virtualized window does not intersect the rendered range so likewise the
                // virtualized window middle should be outside of the rendered range.
                assert(
                    isVirtualizedWindowMiddleInBufferedLeadingHeight ||
                        isVirtualizedWindowMiddleInBufferedTrailingHeight,
                );

                // Guess the index corresponding with the middle of the virtualized window in
                // the buffered height. This is a statistical guess given it's expensive to
                // compute the exact index at this position because we'd have to iterate
                // through all items.
                //
                // We will iterate backwards and forwards from this `scanIndex` to find the new
                // rendered range.
                let scanIndex: number;
                let scanIndexTop: number;
                let scanIndexBottom: number;
                if (isVirtualizedWindowMiddleInBufferedLeadingHeight) {
                    // Special case: If the virtualized window starts near the top of the list then
                    // scan from the start.
                    if (virtualizedWindowTop < clientHeight) {
                        scanIndex = 0;

                        const scanItem = getItem(scanIndex);
                        const scanItemHeight =
                            itemHeightByKey.get(scanItem.key) ?? scanItem.minHeight;

                        scanIndexTop = 0;
                        scanIndexBottom = scanItemHeight;
                    } else {
                        scanIndex = Math.floor(
                            renderedRange.startIndex *
                                (virtualizedWindowMiddle / renderedRange.bufferedLeadingHeight),
                        );

                        const scanItem = getItem(scanIndex);
                        const scanItemHeight =
                            itemHeightByKey.get(scanItem.key) ?? scanItem.minHeight;

                        scanIndexTop = virtualizedWindowMiddle - scanItemHeight;
                        scanIndexBottom = virtualizedWindowMiddle;
                    }
                } else {
                    assert(isVirtualizedWindowMiddleInBufferedTrailingHeight);

                    // Special case: If the virtualized window ends near the bottom of the list then
                    // scan from the end.
                    if (virtualizedWindowBottom > scrollHeight - clientHeight) {
                        scanIndex = renderedRange.itemCount - 1;

                        const scanItem = getItem(scanIndex);
                        const scanItemHeight =
                            itemHeightByKey.get(scanItem.key) ?? scanItem.minHeight;

                        scanIndexTop = oldContentHeight - scanItemHeight;
                        scanIndexBottom = oldContentHeight;
                    } else {
                        scanIndex = Math.floor(
                            renderedRange.endIndex +
                                (renderedRange.itemCount - 1 - renderedRange.endIndex) *
                                    ((virtualizedWindowMiddle - renderedRangeBottom) /
                                        renderedRange.bufferedTrailingHeight),
                        );

                        const scanItem = getItem(scanIndex);
                        const scanItemHeight =
                            itemHeightByKey.get(scanItem.key) ?? scanItem.minHeight;

                        scanIndexTop = virtualizedWindowMiddle - scanItemHeight;
                        scanIndexBottom = virtualizedWindowMiddle;
                    }
                }

                newStartIndex = scanIndex;
                let newStartIndexTop = scanIndexTop;

                // Move the start index back until we cover the virtualized window top.
                while (newStartIndex > 0 && newStartIndexTop > virtualizedWindowTop) {
                    const item = getItem(newStartIndex - 1);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;
                    newStartIndex -= 1;
                    newStartIndexTop -= itemHeight;
                }

                newEndIndex = scanIndex;
                let newEndIndexBottom = scanIndexBottom;

                // Move the end index forward until we cover the virtualized window bottom.
                while (newEndIndex < itemCount - 1 && newEndIndexBottom < virtualizedWindowBottom) {
                    const item = getItem(newEndIndex + 1);
                    const itemHeight = itemHeightByKey.get(item.key) ?? item.minHeight;
                    newEndIndex += 1;
                    newEndIndexBottom += itemHeight;
                }

                const newRenderedRangeHeight = newEndIndexBottom - newStartIndexTop;
                const newContentHeight =
                    oldContentHeight + (newRenderedRangeHeight - renderedRangeHeight);

                // Remove the new rendered range height from the buffered height area we are
                // rendering our new range in. Add the old rendered range height to the other
                // buffered height area.
                if (isVirtualizedWindowMiddleInBufferedLeadingHeight) {
                    newBufferedLeadingHeight = virtualizedWindowTop;
                    newBufferedTrailingHeight =
                        newContentHeight - newRenderedRangeHeight - newBufferedLeadingHeight;
                } else {
                    assert(isVirtualizedWindowMiddleInBufferedTrailingHeight);

                    newBufferedTrailingHeight = newContentHeight - virtualizedWindowBottom;
                    newBufferedLeadingHeight =
                        newContentHeight - newRenderedRangeHeight - newBufferedTrailingHeight;
                }

                updateRenderedRange();
            }, perceivedAsInstantLimitMs);
        }
    };

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
                <div ref={contentRef} style={{height: contentHeight}}>
                    {shouldRenderWithRelativePositioning &&
                        renderedRange &&
                        renderedRange.bufferedLeadingHeight > 0 && (
                            <div style={{height: renderedRange.bufferedLeadingHeight}} />
                        )}
                    {children}
                </div>
            </div>
            {pinToScriptElement}
        </>
    );
}

/**
 * Adjust the rendered range with a new item count. If the indexes are out of
 * bounds then we update to new indexes. If the item count changed then we
 * adjust the extra height around the rendered range proportionally with the
 * item count difference.
 */
export function adjustVirtualizedScrollViewRenderedRange(
    range: VirtualizedScrollViewRenderedRange | null,
    itemCount: number,
): VirtualizedScrollViewRenderedRange | null {
    if (!range) return null;

    assert(range.startIndex >= 0);
    assert(range.startIndex <= range.endIndex);

    // If the item count did not change, we don't need to adjust our range.
    if (range.itemCount === itemCount) return range;

    // If the item count is zero, the range is now empty.
    if (itemCount === 0) return null;

    const renderedItemCount = range.endIndex - range.startIndex;

    const heightPerItemOutOfRange =
        (range.bufferedLeadingHeight + range.bufferedTrailingHeight) /
        (range.itemCount - renderedItemCount);

    const heightDifference = (itemCount - range.itemCount) * heightPerItemOutOfRange;

    // If the range indexes are still valid but the item count changed modify the
    // range's top/bottom height by an amount proportional to how much the item
    // count changed.
    //
    // For example: if you have 100 items not in the rendered range, `bufferedLeadingHeight`
    // of 3000px, and `bufferedTrailingHeight` of 1000px then the average height of each item
    // is 40px. If you remove 5 items that's 200px of height we want to remove. We
    // will remove 150px (200 * (3000 / 4000)) from `bufferedLeadingHeight` and will remove
    // 50px from `bufferedTrailingHeight`.
    //
    // TODO(calebmer): The developer may need to control where the new item count
    // height is going. For example, in a chat app new items are only ever added to
    // the end of a scroll view but there are a lot of items at the top.
    // Proportionally we would put all the height at the top which is the wrong UX.
    if (range.startIndex < itemCount && range.endIndex < itemCount) {
        const newBufferedLeadingHeight = Math.max(
            0,
            range.bufferedLeadingHeight +
                heightDifference *
                    (range.bufferedLeadingHeight /
                        (range.bufferedLeadingHeight + range.bufferedTrailingHeight)),
        );

        const newBufferedTrailingHeight = Math.max(
            0,
            range.bufferedTrailingHeight +
                heightDifference *
                    (range.bufferedTrailingHeight /
                        (range.bufferedLeadingHeight + range.bufferedTrailingHeight)),
        );

        return {
            itemCount,
            startIndex: range.startIndex,
            endIndex: range.endIndex,
            bufferedLeadingHeight: newBufferedLeadingHeight,
            bufferedTrailingHeight: newBufferedTrailingHeight,
        };
    }

    // If the range is out of bounds, we try to maintain the number of rendered
    // items. The end of the range will be the end of our bounds. This has the
    // effect of pushing our range backwards.
    const newEndIndex = itemCount - 1;
    const newStartIndex = Math.max(0, newEndIndex - renderedItemCount);

    // Put all the height difference into `bufferedLeadingHeight`, less any height from the old
    // `bufferedTrailingHeight` since that is going to zero.
    const newBufferedLeadingHeight = Math.max(
        0,
        range.bufferedLeadingHeight + Math.min(0, heightDifference + range.bufferedTrailingHeight),
    );

    return {
        itemCount,
        startIndex: newStartIndex,
        endIndex: newEndIndex,
        bufferedLeadingHeight: newBufferedLeadingHeight,
        bufferedTrailingHeight: 0,
    };
}

function useScrollViewPinTo(
    scrollRef: RefObject<HTMLDivElement>,
    contentRef: RefObject<HTMLDivElement>,
    pinTo: "top" | "bottom",
): {scriptElement: ReactNode} {
    const pinToRef = useRef(pinTo);
    useLayoutEffectWithoutServerSideWarning(() => {
        pinToRef.current = pinTo;
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

    // This layout effect is safe because it does not change the UI.
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

        const observer = new ResizeObserver(() => {
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
        });

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

// https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap
function areRangesOverlapping(start1: number, end1: number, start2: number, end2: number) {
    assert(start1 <= end1);
    assert(start2 <= end2);
    return start1 <= end2 && end1 >= start2;
}
