import {TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect} from "react";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Add a `ContentEditorDebugTools` object with some helpers in debug
 * environments which developers can use to understand the internal state
 * of the content editor and simulate concurrent document editing.
 */
export function useContentEditorDebugTools(viewRef: RefObject<EditorView>) {
    useEffect(() => {
        // Do not add debug tools in production!
        if (process.env.NODE_ENV === "production") return;

        // If we already have a simulate typing function, don't add another to window.
        if ((window as any).ContentEditorDebugTools) return;

        assert(viewRef.current);
        const view = viewRef.current;

        const simulateTyping = async (string: string) => {
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

                    // NOTE(calebmer): Observing what appears to be a React bug but I can't find a
                    // minimal reproduction. Adding this `wait()` fixes it.
                    //
                    // We were observing React pass the same state object into the reducer in
                    // `useDocumentContentEditorState()` for the action dispatched by the line of
                    // code above and the action dispatched by the line of code below. Despite the
                    // reducer clearly producing a new object.
                    //
                    // Assuming there's some bug in React's batch handling. Adding the wait seems to
                    // leave React in a good state? Hopefully this doesn't come up in actual usage
                    // of the product. This function is a bit weird since we dispatch an event to
                    // emulate user behavior.
                    await wait(0);

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

        const ContentEditorDebugTools = {
            view,
            simulateTyping,
        };

        (window as any).ContentEditorDebugTools = ContentEditorDebugTools;
        return () => {
            delete (window as any).ContentEditorDebugTools;
        };
    }, [viewRef]);
}
