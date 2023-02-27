import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useRef} from "react";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker";
import {Box} from "~/client/design/box";
import {OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay_animated";

export function ContentEditorMentionFloater({
    state,
    viewRef,
    range,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
}) {
    const overlayRef = useRef<OverlayRef>(null);

    return (
        <OverlayAnimated
            ref={overlayRef}
            isVisible={true}
            placement="top-start"
            offset="3"
            overlay={<Box>TODO</Box>}
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}
