import {useState} from "react";
import {Box} from "~/client/design/box";
import {useLocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {TaskNotepadPaginator} from "~/client/tasks/demo_2/internal/task_notepad_paginator";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {clamp} from "~/shared/helpers/number/clamp";

export function TaskNotepadView() {
    const [state, dispatch] = useLocalTasksState();
    const [page, setPage] = useState(state.database.getNotepadPageCount());

    const clampedPage = clamp(1, page, state.database.getNotepadPageCount());
    if (clampedPage !== page) setPage(clampedPage);

    return (
        <Box flexGrow="1" overflowX="hidden" overflowY="scroll" backgroundColor="grey-0">
            {/* <TaskNotepadViewActiveSection /> */}
            <Box padding="5" display="flex" alignItems="center" justifyContent="space-between">
                <Box fontSize="100" fontStyle="semi-bold">
                    Notepad
                </Box>
                <TaskNotepadPaginator
                    page={page}
                    onPageChange={setPage}
                    pageCount={state.database.getNotepadPageCount()}
                    onPageCreate={() => {
                        dispatch({type: "CreateNotepadPage"});
                        setPage(state.database.getNotepadPageCount() + 1);
                    }}
                />
            </Box>
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
