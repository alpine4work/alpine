import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Memo, Ref, RefObject, forwardRef, useCallback, useLayoutEffect, useRef} from "react";
import {Box} from "~/client/design/box";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {scheduleException} from "~/shared/helpers/async/schedule_exception";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";

const ContentEditorCursorTrackerForwardRef = forwardRef(ContentEditorCursorTracker);
export {ContentEditorCursorTrackerForwardRef as ContentEditorCursorTracker};

function ContentEditorCursorTracker(
    {
        state,
        viewRef,
        pos,
        onUpdatePosition,
    }: {
        state: EditorState;
        viewRef: RefObject<EditorView | null>;
        pos: number;
        onUpdatePosition?: () => void;
    },
    foreignRef: Ref<HTMLDivElement>,
) {
    const onUpdatePositionRef = useRef(onUpdatePosition);
    useLayoutEffect(() => {
        onUpdatePositionRef.current = onUpdatePosition;
    });

    const localRef = useContentEditorTracker({
        state,
        viewRef,
        pos,
        onUpdatePosition: useCallback(() => onUpdatePositionRef.current?.(), []),
    });

    return (
        <Box
            ref={useMergedRef(localRef, foreignRef)}
            width="0"
            position="absolute"
            pointerEvents="none"
        />
    );
}

export function useContentEditorTracker({
    state,
    viewRef,
    pos,
    side,
    onUpdatePosition,
    shouldUseLineHeight = false,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    pos: number;
    /** See the documentation for `coordsAtPos()` for what this does. */
    side?: number;
    onUpdatePosition?: Memo<() => void>;
    shouldUseLineHeight?: boolean;
}) {
    const localRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        let isCancelled = false;

        // We want this effect to run whenever the underlying doc changes too.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state.doc;

        const run = () => {
            if (isCancelled) return;

            assert(viewRef.current);
            assert(localRef.current);

            // jsdom doesn't care about layout so this property doesn't exist.
            if (typeof jest !== "undefined" && !localRef.current.offsetParent) return;
            assert(localRef.current.offsetParent);

            // `coords` are relative to the viewport, so get our offset parent's viewport
            // rect so we can correctly position our selection target in the offset parent.
            const coords = viewRef.current.coordsAtPos(pos, side);
            const offsetParentRect = localRef.current.offsetParent.getBoundingClientRect();

            // Calculate the line height of the parent element if we want to use the line
            // height as the height of our tracker instead of the content height.
            let lineHeightIfShouldBeUsed = null;
            if (shouldUseLineHeight) {
                const {node} = viewRef.current.domAtPos(pos, side);
                const parentElement = node instanceof Element ? node : node.parentElement;
                const lineHeightString = parentElement
                    ? getComputedStyle(parentElement).lineHeight
                    : null;
                lineHeightIfShouldBeUsed = lineHeightString?.endsWith("px")
                    ? parseInt(lineHeightString.slice(0, -2), 10)
                    : null;
            }

            const contentHeight = coords.bottom - coords.top;
            const finalHeight =
                lineHeightIfShouldBeUsed !== null
                    ? Math.max(contentHeight, lineHeightIfShouldBeUsed)
                    : contentHeight;

            localRef.current.style.top = `${
                coords.top - offsetParentRect.top - (finalHeight - contentHeight) / 2
            }px`;
            localRef.current.style.height = `${finalHeight}px`;
            localRef.current.style.left = `${coords.left - offsetParentRect.left}px`;

            onUpdatePosition?.();
        };

        let removeResizeListener: (() => void) | null;

        // In React, child component effects run before parent component effects. So
        // `viewRef` is assigned after our effect runs. By scheduling a microtask we
        // wait until our parent's effect runs.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            // Make sure that whenever our view element resizes, we update the position of
            // our tracker.
            assert(viewRef.current);
            const viewElement = viewRef.current.dom;
            addResizeListenerForElement(viewElement, run);
            removeResizeListener = () => removeResizeListenerForElement(viewElement, run);

            run();
        });

        return () => {
            isCancelled = true;
            removeResizeListener?.();
        };
    }, [onUpdatePosition, pos, shouldUseLineHeight, side, state.doc, viewRef]);

    return localRef;
}

const resizeListenersByElement = new Map<Element, Set<(entry: ResizeObserverEntry) => void>>();
let resizeObserver: ResizeObserver | undefined;

function addResizeListenerForElement(element: Element, listener: () => void) {
    if (!resizeObserver) {
        resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const resizeListeners = resizeListenersByElement.get(entry.target);
                if (resizeListeners) {
                    for (const listener of resizeListeners) {
                        try {
                            listener(entry);
                        } catch (error) {
                            scheduleException(error);
                        }
                    }
                }
            }
        });
    }

    const resizeListeners = getOrSetDefaultMapValue(
        resizeListenersByElement,
        element,
        () => new Set(),
    );

    resizeListeners.add(listener);

    if (resizeListeners.size === 1) resizeObserver.observe(element);
}

function removeResizeListenerForElement(element: Element, listener: () => void) {
    const resizeListeners = resizeListenersByElement.get(element);
    if (!resizeListeners) return;

    resizeListeners.delete(listener);

    if (resizeListeners.size === 0) {
        resizeListenersByElement.delete(element);
        resizeObserver?.unobserve(element);
    }
}
