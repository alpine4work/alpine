import {TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect} from "react";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Add a `__simulateTypingInContentEditor()` global helper in debug
 * environments which developers can use to simulate concurrent document
 * editing using the browser console.
 */
export function useSimulateTypingInContentEditorDebugTool(viewRef: RefObject<EditorView>) {
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;

        // If we already have a simulate typing function, don't add another to window.
        if ((window as any).__simulateTypingInContentEditor) return;

        assert(viewRef.current);
        const view = viewRef.current;

        const simulateTypingInContentEditor = async (string: string) => {
            let isFirstChar = true;

            for (const char of string) {
                if (!isFirstChar) await wait(200);
                isFirstChar = false;

                let depthToLastChildWithInlineContent = 0;
                let lastChild = view.state.doc.lastChild;
                while (lastChild !== null) {
                    depthToLastChildWithInlineContent++;
                    if (lastChild.inlineContent) break;
                    lastChild = lastChild.lastChild;
                }

                const $pos = view.state.doc.resolve(
                    view.state.doc.content.size - depthToLastChildWithInlineContent,
                );

                if (char === "\n" || char === "\r") {
                    view.dispatch(view.state.tr.setSelection(new TextSelection($pos)));
                    view.dom.dispatchEvent(
                        new KeyboardEvent("keydown", {key: "Enter", code: "Enter"}),
                    );
                } else {
                    view.dispatch(
                        view.state.tr
                            .setSelection(new TextSelection($pos))
                            .insertText(char, $pos.pos),
                    );
                }
            }
        };

        (window as any).__simulateTypingInContentEditor = simulateTypingInContentEditor;
        return () => {
            delete (window as any).__simulateTypingInContentEditor;
        };
    }, [viewRef]);
}
