import {Box} from "~/client/web/design/box.js";
import {
    taskGridViewColumnHeaderHeight,
    taskGridViewColumnHeaderLabelColor,
    taskGridViewColumnHeaderLabelFontSize,
    taskGridViewColumnHeaderLabelMarginBottom,
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewDragHandleWidthRem,
    taskRowViewExpandButtonWidthRem,
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewLastColumnPaddingRight,
} from "~/client/web/styles/tasks_shared_styles.js";

export function TaskGridViewColumnHeader({
    withoutAssigneeField,
    titleFieldLabel = "Name",
}: {
    withoutAssigneeField?: boolean;
    titleFieldLabel?: string;
}) {
    return (
        <Box height={taskGridViewColumnHeaderHeight} display="flex">
            <Box
                flexShrink="0"
                width="32"
                paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                color={taskGridViewColumnHeaderLabelColor}
                fontSize={taskGridViewColumnHeaderLabelFontSize}
                style={{
                    paddingLeft: `${
                        taskRowViewDragHandleWidthRem + taskRowViewExpandButtonWidthRem
                    }rem`,
                }}
            >
                {titleFieldLabel}
            </Box>
            <Box flexGrow="1" />
            {!withoutAssigneeField && (
                <Box
                    flexShrink="0"
                    paddingX={taskRowViewColumnPaddingX}
                    paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                    color={taskGridViewColumnHeaderLabelColor}
                    fontSize={taskGridViewColumnHeaderLabelFontSize}
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
                paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                color={taskGridViewColumnHeaderLabelColor}
                fontSize={taskGridViewColumnHeaderLabelFontSize}
                style={{width: taskRowViewColumnWidth}}
            >
                Priority
            </Box>
            <Box
                flexShrink="0"
                paddingX={taskRowViewColumnPaddingX}
                paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                color={taskGridViewColumnHeaderLabelColor}
                fontSize={taskGridViewColumnHeaderLabelFontSize}
                style={{width: taskRowViewColumnWidth}}
            >
                Due date
            </Box>
            <Box
                flexShrink="0"
                paddingLeft={taskRowViewColumnPaddingX}
                paddingRight={taskRowViewLastColumnPaddingRight}
                paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                color={taskGridViewColumnHeaderLabelColor}
                fontSize={taskGridViewColumnHeaderLabelFontSize}
                style={{width: taskRowViewCollectionsColumnWidth}}
            >
                Collections
            </Box>
            <Box flexShrink="0" width="5" />
        </Box>
    );
}
