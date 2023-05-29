import {CalendarDate} from "@internationalized/date";
import {CaretRight} from "phosphor-react";
import {Ref, forwardRef, useCallback, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/demo_2/internal/task_row_title_input";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, contentSchemaStyles, tasksStyles} from "~/shared/styles/styles";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [ ] Assignee field
// [ ] Due date field
// [ ] Collections field
// [ ] Custom fields
// [ ] Mark as in progress
// [ ] Subtasks
// [ ] Open detail interaction
// [ ] Dark mode pass

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

export type TaskRowPresentationalViewRef = {
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitleCoord(coord: number): void;
};

const TaskRowPresentationalViewForwardRef = forwardRef(TaskRowPresentationalView);
export {TaskRowPresentationalViewForwardRef as TaskRowPresentationalView};

function TaskRowPresentationalView(
    {
        status,
        onStatusChange,
        title,
        onTitleChange,
        titlePlaceholder,
        assignee,
        childTaskCount,
        areChildTasksCollapsed,
        onAreChildTasksCollapsedToggle,
        indentation,
        cells,
        createTaskAbove,
        createTaskBelowAndFocus,
        createTaskChildAtStartAndFocus,
        nestWithPreviousTaskRowIfExistsAndExpand,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        focusNextTaskTitleCoord,
        focusPreviousTaskTitleCoord,
        focusFirstTaskTitleStart,
        focusLastTaskTitleEnd,
        withoutPaddingLeft,
    }: {
        status: TaskStatus | null;
        onStatusChange: (status: TaskStatus) => void;
        title: TaskTitle;
        onTitleChange: (title: TaskTitle) => void;
        titlePlaceholder?: string;
        assignee: TaskAssignee | null;
        childTaskCount: number;
        areChildTasksCollapsed: boolean;
        onAreChildTasksCollapsedToggle: () => void;
        indentation: number;
        cells: ReadonlyArray<TaskRowViewCell>;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        createTaskChildAtStartAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: () => void;
        unnestTaskIfNestedRow: () => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: () => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        focusFirstTaskTitleStart: () => void;
        focusLastTaskTitleEnd: () => void;
        withoutPaddingLeft?: boolean;
    },
    ref: Ref<TaskRowPresentationalViewRef>,
) {
    const titleInputRef = useRef<TaskRowTitleInputRef>(null);

    const focusTitleStart = useCallback(() => {
        assertExists(titleInputRef.current).focusStart();
    }, []);

    const focusTitleEnd = useCallback(() => {
        assertExists(titleInputRef.current).focusEnd();
    }, []);

    const focusTitleAll = useCallback(() => {
        assertExists(titleInputRef.current).focusAll();
    }, []);

    const focusTitleCoord = useCallback((left: number) => {
        assertExists(titleInputRef.current).focusCoord(left);
    }, []);

    useImperativeHandle(
        ref,
        () => ({focusTitleStart, focusTitleEnd, focusTitleAll, focusTitleCoord}),
        [focusTitleAll, focusTitleCoord, focusTitleEnd, focusTitleStart],
    );

    // Small naming note: The whitespace area outside of the task row border we
    // call "margin" and the whitespace area inside the task row border we
    // call "padding". Similar to the CSS box model.
    const paddingLeftNode = (
        <Box
            flexShrink="0"
            display="flex"
            justifyContent="flex-end"
            alignItems="center"
            style={{
                width: `${
                    parseRemLengthNumber(spacing["5"]) +
                    parseRemLengthNumber(spacing["6"]) +
                    parseRemLengthNumber(contentSchemaStyles.listItemIndentation) * indentation
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
                width="5"
                paddingRight="1"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
            >
                {childTaskCount > 0 && (
                    <IconButton
                        size="xs"
                        description={
                            areChildTasksCollapsed ? "Expand subtasks" : "Collapse subtasks"
                        }
                        onPress={onAreChildTasksCollapsedToggle}
                    >
                        <CaretRight
                            style={{
                                transform: areChildTasksCollapsed
                                    ? "rotate(0deg)"
                                    : "rotate(90deg)",
                                transition: "transform 100ms ease",
                            }}
                        />
                    </IconButton>
                )}
            </Box>
            <Box
                width="6"
                paddingRight="2"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
            >
                {status !== null && (
                    <TaskStatusButton
                        status={status}
                        onStatusChange={onStatusChange}
                        assignee={assignee}
                    />
                )}
            </Box>
        </Box>
    );

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
                {!withoutPaddingLeft && paddingLeftNode}
                <Box flexGrow="1" overflow="hidden">
                    <TaskRowTitleInput
                        ref={titleInputRef}
                        status={status}
                        title={title}
                        onTitleChange={onTitleChange}
                        placeholder={titlePlaceholder}
                        childTaskCount={childTaskCount}
                        areChildTasksCollapsed={areChildTasksCollapsed}
                        createTaskAbove={createTaskAbove}
                        createTaskBelowAndFocus={createTaskBelowAndFocus}
                        createTaskChildAtStartAndFocus={createTaskChildAtStartAndFocus}
                        nestWithPreviousTaskRowIfExistsAndExpand={
                            nestWithPreviousTaskRowIfExistsAndExpand
                        }
                        unnestTaskIfNestedRow={unnestTaskIfNestedRow}
                        deleteTaskAndAllChildrenAndFocusPreviousRow={
                            deleteTaskAndAllChildrenAndFocusPreviousRow
                        }
                        focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                        focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                        focusFirstTaskTitleStart={focusFirstTaskTitleStart}
                        focusLastTaskTitleEnd={focusLastTaskTitleEnd}
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
