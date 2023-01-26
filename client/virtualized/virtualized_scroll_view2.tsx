import {
    CSSProperties,
    Key,
    Memo,
    ReactNode,
    RefObject,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {VariableSizeList} from "react-window";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
    useResizeObserver,
} from "~/client/helpers/use_resize_observer";
import {RemLength, convertRemLengthToPx} from "~/shared/design/spacing";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {sprinkles} from "~/shared/styles/styles";

export type VirtualizedScrollViewItem = {
    readonly key: Key;
    readonly minHeight: number | RemLength;
    readonly item: ReactNode;
};

export function VirtualizedScrollView2({
    itemCount,
    renderItem: _renderItem,
    estimatedItemHeight,
    pinTo = "top",
}: {
    itemCount: number;
    renderItem: Memo<(index: number) => VirtualizedScrollViewItem>;
    estimatedItemHeight: number | RemLength;

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
    const isInitialAppRender = useIsInitialAppRender();
    const remPx = useRemPx();
    const containerRef = useRef<HTMLDivElement>(null);
    const containerRect = useResizeObserver(containerRef);
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<VariableSizeList<VirtualizedScrollViewItemData>>(null);

    const getItem = useMemo(() => {
        const itemByIndex = new Map<number, VirtualizedScrollViewItem>();

        return (index: number): VirtualizedScrollViewItem =>
            getOrSetDefaultMapValue(itemByIndex, index, _renderItem);
    }, [_renderItem]);

    const [itemHeightByKey, setItemHeightByKey] = useState(ImmutableMap.empty<Key, number>());

    const getItemHeight = (item: VirtualizedScrollViewItem) => {
        const itemHeight = itemHeightByKey.get(item.key);
        if (itemHeight !== undefined) return itemHeight;
        return typeof item.minHeight === "string"
            ? convertRemLengthToPx(item.minHeight, remPx)
            : item.minHeight;
    };

    const delayedCallbacksRef = useRef<Array<() => void>>([]);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (delayedCallbacksRef.current.length === 0) return;

        const delayedCallbacks = delayedCallbacksRef.current;
        delayedCallbacksRef.current = [];

        for (const callback of delayedCallbacks) callback();
    });

    const onItemHeightChange = useEvent((index: number, height: number) => {
        // If we do not yet have the list ref, this may have been called from a child
        // effect. Delay the callback until this component renders.
        if (!listRef.current) {
            delayedCallbacksRef.current.push(() => {
                assert(listRef.current);
                onItemHeightChange(index, height);
            });
            return;
        }

        const list = listRef.current;
        const item = getItem(index);
        const itemHeight = getItemHeight(item);

        // If the item's height didn't change, don't bother updating state and
        // re-rendering.
        if (itemHeight === height) return;

        setItemHeightByKey(itemHeightByKey => itemHeightByKey.set(item.key, height));

        // Don't re-render since by setting the new item height to state it will cause
        // our parent component to re-render.
        const shouldForceUpdate = false;

        list.resetAfterIndex(index, shouldForceUpdate);
    });

    if (typeof estimatedItemHeight === "string")
        estimatedItemHeight = convertRemLengthToPx(estimatedItemHeight, remPx);

    // Make sure to pin to the bottom of the list whenever content changes instead
    // of pinning to the top of the list.
    useScrollViewPinTo(outerRef, innerRef, containerRect && !isInitialAppRender ? pinTo : null);

    return (
        <div ref={containerRef} className={sprinkles({height: "full"})}>
            {containerRect && !isInitialAppRender && (
                <VariableSizeList<VirtualizedScrollViewItemData>
                    ref={listRef}
                    outerRef={outerRef}
                    innerRef={innerRef}
                    height={containerRect.height}
                    width={containerRect.width}
                    initialScrollOffset={pinTo === "bottom" ? Number.MAX_SAFE_INTEGER : 0}
                    itemCount={itemCount}
                    itemKey={index => getItem(index).key}
                    itemSize={index => getItemHeight(getItem(index))}
                    itemData={{getItem, onItemHeightChange}}
                    estimatedItemSize={estimatedItemHeight}
                    // Render enough items to fill half the view.
                    overscanCount={Math.max(
                        1,
                        Math.ceil(containerRect.height / 2 / estimatedItemHeight),
                    )}
                >
                    {VirtualizedScrollViewItem}
                </VariableSizeList>
            )}
        </div>
    );
}

type VirtualizedScrollViewItemData = {
    getItem: Memo<(index: number) => VirtualizedScrollViewItem>;
    onItemHeightChange: Memo<(index: number, height: number) => void>;
};

// Pass a component as the child of `VariableSizeList` to avoid unmounting
// items whenever the children function reference changes.
function VirtualizedScrollViewItem({
    data: {getItem, onItemHeightChange},
    index,
    style,
}: {
    data: VirtualizedScrollViewItemData;
    index: number;
    style: CSSProperties;
}) {
    const itemRef = useRef<HTMLDivElement>(null);
    const item = getItem(index);

    useLayoutEffect(() => {
        const itemElement = assertExists(itemRef.current);

        let lastHeight = itemElement.offsetHeight;
        onItemHeightChange(index, lastHeight);

        const listener = (entry: ResizeObserverEntry) => {
            const nextHeight = entry.contentRect.height;
            if (lastHeight !== nextHeight) {
                onItemHeightChange(index, nextHeight);
                lastHeight = nextHeight;
            }
        };

        addResizeListenerForElement(itemElement, listener);
        return () => {
            removeResizeListenerForElement(itemElement, listener);
        };
    }, [index, onItemHeightChange]);

    return (
        <div style={style}>
            <div ref={itemRef} style={{minHeight: item.minHeight}}>
                {item.item}
            </div>
        </div>
    );
}

function useScrollViewPinTo(
    outerRef: RefObject<HTMLDivElement>,
    innerRef: RefObject<HTMLDivElement>,
    pinTo: "top" | "bottom" | null,
) {
    const onLayoutEffectRef = useRef<(() => void) | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        onLayoutEffectRef.current?.();
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        if (pinTo !== "bottom") return;

        const outerElement = assertExists(outerRef.current);
        const innerElement = assertExists(innerRef.current);

        const getScrollBottom = () =>
            outerElement.scrollHeight - (outerElement.scrollTop + outerElement.clientHeight);

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
            if (document.activeElement && outerElement.contains(document.activeElement)) {
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
            outerElement.scrollTop =
                outerElement.scrollHeight - outerElement.clientHeight - scrollBottom;
        };

        const observer = new ResizeObserver(handleResize);

        onLayoutEffectRef.current = handleResize;
        observer.observe(outerElement, {box: "border-box"});
        observer.observe(innerElement, {box: "border-box"});
        outerElement.addEventListener("scroll", handleScroll);
        outerElement.addEventListener("keydown", handleInteraction);
        outerElement.addEventListener("keyup", handleInteraction);
        outerElement.addEventListener("mousedown", handleInteraction);
        outerElement.addEventListener("mouseup", handleInteraction);
        outerElement.addEventListener("pointerdown", handleInteraction);
        outerElement.addEventListener("pointerup", handleInteraction);
        return () => {
            onLayoutEffectRef.current = null;
            observer.unobserve(outerElement);
            observer.unobserve(innerElement);
            outerElement.removeEventListener("scroll", handleScroll);
            outerElement.removeEventListener("keydown", handleInteraction);
            outerElement.removeEventListener("keyup", handleInteraction);
            outerElement.removeEventListener("mousedown", handleInteraction);
            outerElement.removeEventListener("mouseup", handleInteraction);
            outerElement.removeEventListener("pointerdown", handleInteraction);
            outerElement.removeEventListener("pointerup", handleInteraction);
        };
    }, [innerRef, outerRef, pinTo]);
}
