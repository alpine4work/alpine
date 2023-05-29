import {useState} from "react";
import {Box} from "~/client/design/box";
import {TaskNotepadPaginator} from "~/client/tasks/demo_2/internal/task_notepad_paginator";
import {taskCardViewMaxWidth} from "~/client/tasks/demo_2/task_card_presentational_view";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";

export function TaskNotepadView() {
    const [page, setPage] = useState(3);

    return (
        <Box flexGrow="1" overflowX="hidden" overflowY="scroll" backgroundColor="grey-0">
            {/* <TaskNotepadViewActiveSection /> */}
            <Box padding="5" display="flex" alignItems="center" justifyContent="space-between">
                <Box fontSize="100" fontStyle="semi-bold">
                    Notepad
                </Box>
                <TaskNotepadPaginator page={page} onPageChange={setPage} pageCount={5} />
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
