import {useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Spacing} from "~/shared/design/spacing.js";
import {assertSpacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export function TaskDetailNotesField({
    notesContent,
    onNotesContentChange,
    padding,
}: {
    notesContent: TaskNotesContentWithReferences;
    onNotesContentChange: (notesContent: TaskNotesContentWithReferences) => void;
    padding: Spacing;
}) {
    const labelId = useId();
    const editorRef = useRef<ContentEditorRef>(null);

    const [state, setState] = useState(() => ContentEditorState.create(notesContent));

    // If the parent is passing in a different `notesContent` value than what we
    // have, then reset our editor state. Could also happen when we call
    // `onNotesContentChange()` but our parent doesn't accept the update.
    if (state.getDoc() !== notesContent.doc) {
        setState(ContentEditorState.create(notesContent));
    }

    // Space at the end of our notes field we allow the user to click and focus the
    // field. Name comes from a similar property in React Native:
    // https://reactnative.dev/docs/pressable#hitslop
    const hitSlopBottom: Spacing = "8";

    return (
        <Box>
            <label
                id={labelId}
                className={sprinkles({
                    display: "inline-block",
                    paddingX: padding,
                    paddingBottom: "1",
                    color: "grey-60",
                })}
                // Affordance for mouse users. Clicking on a label focuses the editor.
                onClick={() => {
                    assertExists(editorRef.current).focus();
                }}
            >
                Notes
            </label>
            <FocusRing insetX={padding} insetBottom={hitSlopBottom} isVisibleWhenFocusWithin>
                <Box marginBottom={`-${hitSlopBottom}`}>
                    <ContentEditor
                        ref={editorRef}
                        aria-labelledby={labelId}
                        state={state}
                        onChange={(state, transaction) => {
                            // Run with immediate priority to make sure out component's state and
                            // `onNotesContentChange()` commit together synchronously.
                            runWithImmediatePriority(() => {
                                setState(state);

                                // Should be batched in the same render as the above `setState()` call. If the
                                // parent component doesn't accept this update and re-render then we'll need to
                                // revert our editor state.
                                if (transaction.docChanged) {
                                    onNotesContentChange(state.getContent());
                                }
                            });
                        }}
                        placeholder="Add more details…"
                        className={sprinkles({
                            paddingX: assertSpacing(`${parseInt(padding, 10) - 2}`),
                            paddingBottom: hitSlopBottom,
                        })}
                    />
                </Box>
            </FocusRing>
        </Box>
    );
}
