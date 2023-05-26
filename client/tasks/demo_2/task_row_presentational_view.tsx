// TODO(calebmer): Needs:
//
// [ ] Title
// [ ] Open/close button
// [ ] Assignee field
// [ ] Due date field
// [ ] Collections field
// [ ] Custom fields
// [ ] Mark as in progress
// [ ] Subtasks
// [ ] Open detail interaction
// [ ] Dark mode pass

import {CalendarDate} from "@internationalized/date";
import {useRef} from "react";
import {Box} from "~/client/design/box";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/demo_2/internal/task_row_title_input";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, tasksStyles} from "~/shared/styles/styles";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

export const taskRowViewHeight: Spacing = "9";

export type TaskRowViewCell =
    | TaskRowViewAssigneeCell
    | TaskRowViewDueDateCell
    | TaskRowViewCollectionsCell;

export type TaskRowViewAssigneeCell = {
    readonly type: "Assignee";
    readonly dueDate: CalendarDate | null;
    readonly onDueDateChange: (dueDate: CalendarDate | null) => void;
};

export type TaskRowViewDueDateCell = {
    readonly type: "DueDate";
    readonly dueDate: CalendarDate | null;
    readonly onDueDateChange: (dueDate: CalendarDate | null) => void;
};

export type TaskRowViewCollectionsCell = {
    readonly type: "Collections";
    readonly collections: ReadonlyArray<LocalTaskCollection>;
};

export function TaskRowPresentationalView({
    status,
    onStatusChange,
    title,
    onTitleChange,
    assignee,
    cells,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    assignee: TaskAssignee | null;
    cells: ReadonlyArray<TaskRowViewCell>;
}) {
    const titleInputRef = useRef<TaskRowTitleInputRef>(null);

    const focusTitleStart = () => {
        assertExists(titleInputRef.current).focusStart();
    };

    const focusTitleEnd = () => {
        assertExists(titleInputRef.current).focusEnd();
    };

    const focusTitleAll = () => {
        assertExists(titleInputRef.current).focusAll();
    };

    return (
        <Box height={taskRowViewHeight} display="flex">
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                // A double click selects the task text.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleStart,
                    onSelectAll: focusTitleAll,
                })}
            />
            <Box
                position="relative"
                flexGrow="1"
                overflow="hidden"
                display="flex"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                <Box
                    flexShrink="0"
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                    style={{
                        width: `${
                            parseRemLengthNumber(spacing["5"]) + parseRemLengthNumber(spacing["6"])
                        }rem`,
                    }}
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    className={tasksStyles.textCursorNotInheritedClassName}
                    {...useOutOfBoundsClickSelection({
                        onSelect: event => {
                            // Only handle clicks on the background not covered by content.
                            if (event.target === event.currentTarget) {
                                focusTitleStart();
                            }
                        },
                        onSelectAll: event => {
                            // Only handle clicks on the background not covered by content.
                            if (event.target === event.currentTarget) {
                                focusTitleAll();
                            }
                        },
                    })}
                >
                    <Box
                        width="6"
                        paddingRight="2"
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                    >
                        <TaskStatusButton
                            status={status}
                            onStatusChange={onStatusChange}
                            assignee={assignee}
                        />
                    </Box>
                </Box>
                <Box flexGrow="1" overflow="hidden">
                    <TaskRowTitleInput
                        ref={titleInputRef}
                        status={status}
                        title={title}
                        onTitleChange={onTitleChange}
                    />
                </Box>
            </Box>
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                // A double click selects the task text.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            />
        </Box>
    );
}
