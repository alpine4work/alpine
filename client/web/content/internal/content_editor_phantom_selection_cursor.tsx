import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject} from "react";
import {ContentEditorPhantomSelection} from "~/client/web/content/content_editor.js";
import {useContentEditorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {defaultThemeColor} from "~/shared/design/core/theme_colors.js";

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
                pos: phantomSelection.$head.pos,
                // Bias the tracker position towards the anchor. This is apparent when you are
                // selecting a line of text and the head of your selection is at the newline.
                side:
                    phantomSelection.$anchor.pos < phantomSelection.$head.pos
                        ? -1
                        : phantomSelection.$anchor.pos > phantomSelection.$head.pos
                          ? 1
                          : 0,
                // Give the tracker the height of our parent element's line height since that will
                // be the height of the selection background.
                shouldUseLineHeight: true,
            })}
            className={sprinkles({
                width: "0",
                height: "0",
                position: "absolute",
                pointerEvents: "none",
            })}
        >
            <div
                className={sprinkles({
                    position: "absolute",
                    height: "full",
                    width: "border-thick",
                    backgroundColor,
                })}
                style={{
                    top: 0,
                    left: 0,
                    transform: `translateX(-50%)`,
                }}
            />
            {phantomSelection.color !== defaultThemeColor && (
                // Don't render a selection head for the space theme color. We use the space theme
                // color to represent the current user's selection cursor when the editor is
                // unfocused (see state regarding `isFocusWithinInsertMenu` in
                // `document_content_editor.tsx`).
                //
                // TODO(calebmer): When the theme color is configurable, we should use that instead
                // of `defaultThemeColor`.
                <div
                    className={sprinkles({
                        position: "absolute",
                        width: "1.5",
                        height: "1.5",
                        backgroundColor,
                    })}
                    style={{
                        top: 0,
                        left: 0,
                        transform: `translate(-50%, -50%)`,
                    }}
                />
            )}
        </div>
    );
}
