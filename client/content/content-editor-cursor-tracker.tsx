import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Ref, RefObject, forwardRef, useLayoutEffect, useRef} from "react";
import {Box} from "~/client/design/box";
import {useMergedRef} from "~/client/design/helpers/use-merged-ref";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";

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
    const localRef = useRef<HTMLDivElement>(null);

    const onUpdatePositionRef = useRef(onUpdatePosition);
    useLayoutEffect(() => {
        onUpdatePositionRef.current = onUpdatePosition;
    });

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
            const coords = viewRef.current.coordsAtPos(pos);
            const offsetParentRect = localRef.current.offsetParent.getBoundingClientRect();

            localRef.current.style.top = `${coords.top - offsetParentRect.top}px`;
            localRef.current.style.height = `${coords.bottom - coords.top}px`;
            localRef.current.style.left = `${coords.left - offsetParentRect.left}px`;

            onUpdatePositionRef.current?.();
        };

        // In React, child component effects run before parent component effects. So
        // `viewRef` is assigned after our effect runs. By scheduling a microtask we
        // wait until our parent's effect runs.
        scheduleMicrotask(run);

        return () => {
            isCancelled = true;
        };
    }, [pos, state.doc, viewRef]);

    return (
        <Box
            ref={useMergedRef(localRef, foreignRef)}
            width="0"
            position="absolute"
            pointerEvents="none"
        />
    );
}
