import {Box} from "~/client/web/design/box.js";
import {
    taskGridViewColumnHeaderHeight,
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewDragHandleWidthRem,
    taskRowViewExpandButtonWidthRem,
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewLastColumnPaddingRight,
} from "~/client/web/styles/tasks_shared_styles.js";

export function TaskGridViewColumnHeader({withoutAssigneeField}: {withoutAssigneeField?: boolean}) {
    return (
        <Box height={taskGridViewColumnHeaderHeight} display="flex">
            <Box
                flexShrink="0"
                width="32"
                paddingBottom="1"
                color="grey-40"
                fontSize="50"
                style={{
                    paddingLeft: `${
                        taskRowViewDragHandleWidthRem + taskRowViewExpandButtonWidthRem
                    }rem`,
                }}
            >
                Name
            </Box>
            <Box flexGrow="1" />
            {!withoutAssigneeField && (
                <Box
                    flexShrink="0"
                    paddingX={taskRowViewColumnPaddingX}
                    paddingBottom="1"
                    color="grey-40"
                    fontSize="50"
                    style={{
                        width: taskRowViewFirstColumnWidth,
                        paddingLeft: taskRowViewFirstColumnPaddingLeft,
                    }}
                >
                    Assignee
                </Box>
            )}
            <Box
                flexShrink="0"
                paddingX={taskRowViewColumnPaddingX}
                paddingBottom="1"
                color="grey-40"
                fontSize="50"
                style={{width: taskRowViewColumnWidth}}
            >
                Priority
            </Box>
            <Box
                flexShrink="0"
                paddingX={taskRowViewColumnPaddingX}
                paddingBottom="1"
                color="grey-40"
                fontSize="50"
                style={{width: taskRowViewColumnWidth}}
            >
                Due date
            </Box>
            <Box
                flexShrink="0"
                paddingLeft={taskRowViewColumnPaddingX}
                paddingRight={taskRowViewLastColumnPaddingRight}
                paddingBottom="1"
                color="grey-40"
                fontSize="50"
                style={{width: taskRowViewCollectionsColumnWidth}}
            >
                Collections
            </Box>
            <Box flexShrink="0" width="5" />
        </Box>
    );
}
