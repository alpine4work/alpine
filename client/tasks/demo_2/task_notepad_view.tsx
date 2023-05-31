import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {TaskNotepadGridView} from "~/client/tasks/demo_2/internal/task_notepad_grid_view";
import {TaskNotepadViewActiveSection} from "~/client/tasks/demo_2/internal/task_notepad_view_active_section";
import {TaskNotepadViewPaginator} from "~/client/tasks/demo_2/internal/task_notepad_view_paginator";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {clamp} from "~/shared/helpers/number/clamp";
import {tasksStyles} from "~/shared/styles/styles";

// TODO(calebmer): Some stuff this view needs:
//
// - Shift-tab on a task that's about to move keeps it in place then animate
// - Drag to reorder
// - Due date
// - Assignee
// - Drag selection should select multiple tasks
// - Select all
// - Undo
// - Save expanded tasks on server for browser so we can re-expand them on reload
//
// Generally I should overview a list of document shortcuts and keyboard
// shortcuts and incorporate all that make sense.

export function TaskNotepadView() {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);
    const [state, dispatch] = useLocalTasksState();
    const [notepadPage, setNotepadPage] = useState(state.database.getNotepadPageCount());

    const clampedNotepadPage = clamp(1, notepadPage, state.database.getNotepadPageCount());
    if (clampedNotepadPage !== notepadPage) setNotepadPage(clampedNotepadPage);

    return (
        <Box
            flexGrow="1"
            overflowX="hidden"
            overflowY="scroll"
            backgroundColor="grey-0"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: event => {
                    // Only select from clicks on area without children.
                    if (event.target !== event.currentTarget) return;
                    assertExists(gridViewRef.current).focusEnd();
                },
                onSelectAll: event => {
                    // Only select from clicks on area without children.
                    if (event.target !== event.currentTarget) return;
                    assertExists(gridViewRef.current).focusEnd();
                },
            })}
        >
            <Box height="5" />
            <TaskNotepadViewActiveSection />
            <Box height="16" />
            <Box
                paddingX="5"
                paddingBottom="4"
                display="flex"
                alignItems="center"
                justifyContent="space-between"
            >
                <Box fontSize="100" fontStyle="semi-bold">
                    Notepad
                </Box>
                <TaskNotepadViewPaginator
                    notepadPage={notepadPage}
                    onNotepadPageChange={setNotepadPage}
                    notepadPageCount={state.database.getNotepadPageCount()}
                    onNotepadPageCreate={() => {
                        dispatch({type: "CreateNotepadPage"});
                        setNotepadPage(state.database.getNotepadPageCount() + 1);
                    }}
                />
            </Box>
            <TaskNotepadGridView
                // Remount when the notepad page changes...
                key={notepadPage}
                ref={gridViewRef}
                state={state}
                dispatch={dispatch}
                notepadPage={notepadPage}
            />
        </Box>
    );
}
