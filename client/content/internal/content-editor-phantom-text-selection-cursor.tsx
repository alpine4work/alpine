import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject} from "react";
import {ContentEditorPhantomTextSelection} from "~/client/content/content-editor";
import {useContentEditorTracker} from "~/client/content/internal/content-editor-cursor-tracker";
import {sprinkles} from "~/client/design/sprinkles.css";
import {spacing} from "~/shared/design/spacing";

export function ContentEditorPhantomTextSelectionCursor({
    state,
    viewRef,
    phantomTextSelection,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    phantomTextSelection: ContentEditorPhantomTextSelection;
}) {
    return (
        <div
            ref={useContentEditorTracker({
                state,
                viewRef,
                pos: phantomTextSelection.head,
                // Bias the tracker position towards the anchor. This is apparent when you are
                // selecting a line of text and the head of your selection is at the newline.
                side:
                    phantomTextSelection.anchor < phantomTextSelection.head
                        ? -1
                        : phantomTextSelection.anchor > phantomTextSelection.head
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
                backgroundColor: `${phantomTextSelection.color}-50`,
            })}
            style={{
                transform: `translateX(-50%)`,
            }}
        >
            <div
                className={sprinkles({
                    position: "absolute",
                    width: "1",
                    height: "1",
                    backgroundColor: `${phantomTextSelection.color}-50`,
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
