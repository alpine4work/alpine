import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject} from "react";
import {ContentEditorPhantomSelection} from "~/client/content/content_editor.js";
import {useContentEditorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {sprinkles} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/spacing.js";

export function ContentEditorPhantomSelectionCursor({
    state,
    viewRef,
    phantomSelection,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    phantomSelection: ContentEditorPhantomSelection;
}) {
    if (!phantomSelection.isTextSelection) return null;

    return (
        <ContentEditorPhantomTextSelectionCursor
            state={state}
            viewRef={viewRef}
            phantomSelection={phantomSelection}
        />
    );
}

function ContentEditorPhantomTextSelectionCursor({
    state,
    viewRef,
    phantomSelection,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    phantomSelection: ContentEditorPhantomSelection;
}) {
    const backgroundColor = {
        light: `${phantomSelection.color}-50`,
        dark: `${phantomSelection.color}-40`,
    } as const;

    return (
        <div
            ref={useContentEditorTracker({
                state,
                viewRef,
                pos: phantomSelection.head,
                // Bias the tracker position towards the anchor. This is apparent when you are
                // selecting a line of text and the head of your selection is at the newline.
                side:
                    phantomSelection.anchor < phantomSelection.head
                        ? -1
                        : phantomSelection.anchor > phantomSelection.head
                        ? 1
                        : 0,
                // Give the tracker the height of our parent element's line height since that
                // will be the height of the selection background.
                shouldUseLineHeight: true,
            })}
            className={sprinkles({
                width: "0.5",
                position: "absolute",
                pointerEvents: "none",
                backgroundColor,
            })}
            style={{
                transform: `translateX(-50%)`,
            }}
        >
            <div
                className={sprinkles({
                    position: "absolute",
                    width: "1.5",
                    height: "1.5",
                    backgroundColor,
                })}
                style={{
                    top: 0,
                    left: `calc(${spacing["0.5"]} / 2)`,
                    transform: `translate(-50%, -50%)`,
                }}
            />
        </div>
    );
}
