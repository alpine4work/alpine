import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {TaskNotepadGridView} from "~/client/tasks/demo_2/internal/task_notepad_grid_view";
import {TaskNotepadPaginator} from "~/client/tasks/demo_2/internal/task_notepad_paginator";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {TaskGridPresentationalViewRef} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
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
            {/* <TaskNotepadViewActiveSection /> */}
            <Box padding="5" display="flex" alignItems="center" justifyContent="space-between">
                <Box fontSize="100" fontStyle="semi-bold">
                    Notepad
                </Box>
                <TaskNotepadPaginator
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
                ref={gridViewRef}
                state={state}
                dispatch={dispatch}
                notepadPage={notepadPage}
            />
        </Box>
    );
}

function TaskNotepadViewActiveSection() {
    const cardGap: Spacing = "3";
    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[cardGap]) * (2 / 3)
    }rem)`;

    return (
        <Box padding="5">
            <Box paddingLeft="4" paddingBottom="1.5" fontSize="100" fontStyle="semi-bold">
                Active tasks
            </Box>
            <Box display="flex" gap={cardGap}>
                <Box
                    height="24"
                    maxWidth={taskCardViewMaxWidth}
                    border="grey-5"
                    borderRadius="lg"
                    style={{width: cardWidth}}
                    padding="4"
                    color="grey-50"
                >
                    No active tasks. Mark tasks you’re currently working on as active and you’ll see
                    them here.
                </Box>
            </Box>
        </Box>
    );
}
