/* eslint-disable react-refresh/only-export-components */

import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Memo, Ref, RefObject, forwardRef, useCallback, useLayoutEffect, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";

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
        pos: number | {from: number; to: number};
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
            ref={useMergedRefs(localRef, foreignRef)}
            width="0"
            height="0"
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
    pos: number | {from: number; to: number};
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
            if (import.meta.jest && !localRef.current.offsetParent) return;
            assert(localRef.current.offsetParent);

            let coords: {top: number; bottom: number; left: number; right: number} | undefined;

            // If this is a non-text node like `file` then get the DOM element for the node
            // and use the dimensions of that element instead of the result of
            // `coordsAtPos()` which will have a height of 0.
            if (typeof pos === "number") {
                const $pos = state.doc.resolve(pos);
                if (
                    !$pos.parent.isTextblock &&
                    $pos.nodeAfter &&
                    !$pos.nodeAfter.type.inlineContent &&
                    !$pos.nodeAfter.type.isText
                ) {
                    const nodeDom = viewRef.current.nodeDOM(pos);
                    if (nodeDom instanceof Element) {
                        coords = nodeDom.getBoundingClientRect();
                    }
                }
            }

            if (!coords) {
                const coordsFrom = viewRef.current.coordsAtPos(
                    typeof pos === "number" ? pos : pos.from,
                    side,
                );
                const coordsTo =
                    typeof pos !== "number" ? viewRef.current.coordsAtPos(pos.to, side) : null;

                if (
                    !coordsTo ||
                    coordsTo.left + coordsTo.right + coordsTo.top + coordsTo.bottom === 0
                ) {
                    coords = coordsFrom;
                } else {
                    // When determining the coordinates of a selection range to position our cursor
                    // tracker, remember the overlay attached to the cursor tracker needs to look
                    // good above and below the selection. For example
                    // `<ContentEditorPointerToolbar>` when editing a post view on desktop with text
                    // selected at the start of the post will need to flip down to avoid the post
                    // navigation bar.
                    coords = {
                        top: Math.min(coordsFrom.top, coordsTo.top),
                        bottom: Math.max(coordsFrom.bottom, coordsTo.bottom),
                        left: Math.min(coordsFrom.left, coordsTo.left),
                        right: Math.max(coordsFrom.right, coordsTo.right),
                    };
                }
            }

            // `coords` are relative to the viewport, so get our offset parent's viewport
            // rect so we can correctly position our selection target in the offset parent.
            const offsetParentRect = localRef.current.offsetParent.getBoundingClientRect();
            let scrollOffset = 0;

            // Get our local element's offset due to scrolling.
            {
                let node: Node | null = localRef.current;
                while (node !== null && node !== localRef.current.offsetParent.parentNode) {
                    if (node instanceof HTMLElement) scrollOffset += node.scrollTop;
                    node = node.parentNode;
                }
            }

            // Calculate the line height of the parent element if we want to use the line
            // height as the height of our tracker instead of the content height.
            let lineHeightIfShouldBeUsed = null;
            if (shouldUseLineHeight && typeof pos === "number") {
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
                coords.top - offsetParentRect.top + scrollOffset - (finalHeight - contentHeight) / 2
            }px`;
            localRef.current.style.left = `${coords.left - offsetParentRect.left}px`;
            localRef.current.style.height = `${finalHeight}px`;
            localRef.current.style.width = `${coords.right - coords.left}px`;

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
