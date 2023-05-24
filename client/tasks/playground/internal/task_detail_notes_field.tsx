import {useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {sprinkles} from "~/shared/styles/styles";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema";

export function TaskDetailNotesField({
    notesContent,
    onNotesContentChange,
}: {
    notesContent: TaskNotesContentWithReferences;
    onNotesContentChange: (notesContent: TaskNotesContentWithReferences) => void;
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

    return (
        <Box>
            <label
                id={labelId}
                className={sprinkles({
                    display: "inline-block",
                    paddingX: "5",
                    paddingBottom: "1",
                    color: "grey-50",
                })}
                // Affordance for mouse users. Clicking on a label focuses the editor.
                onClick={() => {
                    assertExists(editorRef.current).focus();
                }}
            >
                Notes
            </label>
            <ContentEditor
                ref={editorRef}
                aria-labelledby={labelId}
                state={state}
                onChange={(state, transaction) => {
                    setState(state);

                    // Should be batched in the same render as the above `setState()` call. If the
                    // parent component doesn't accept this update and re-render then we'll need to
                    // revert our editor state.
                    if (transaction.docChanged) {
                        onNotesContentChange(state.getContent());
                    }
                }}
                placeholder="Add more details…"
                containerClassName={sprinkles({
                    minHeight: "12",
                })}
                className={sprinkles({
                    paddingX: "3",
                })}
            />
        </Box>
    );
}
