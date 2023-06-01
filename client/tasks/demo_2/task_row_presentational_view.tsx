import {useDraggable} from "@dnd-kit/core";
import {CalendarDate} from "@internationalized/date";
import {ArrowsOutSimple, DotsSixVertical} from "phosphor-react";
import {
    PropsWithoutRef,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/demo_2/internal/task_row_title_input";
import {TaskRowViewDroppable} from "~/client/tasks/demo_2/internal/task_row_view_droppable";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, contentSchemaStyles, sprinkles, tasksStyles} from "~/shared/styles/styles";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [ ] Assignee field
// [ ] Due date field
// [ ] Collections field
// [ ] Custom fields
// [x] Mark as in progress
// [x] Subtasks
// [x] Open detail interaction
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

const TaskRowPresentationalViewForwardRef = forwardRef(TaskRowPresentationalView) as <TaskRow>(
    props: PropsWithoutRef<TaskRowPresentationalViewProps<TaskRow>> &
        RefAttributes<TaskRowPresentationalViewRef>,
) => ReactElement;
export {TaskRowPresentationalViewForwardRef as TaskRowPresentationalView};

type TaskRowPresentationalViewProps<TaskRow> = {
    taskRow: TaskRow | null;
    status: TaskStatus | null;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    titlePlaceholder?: string;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
    childTaskCount: number;
    closedChildTaskCount: number;
    areChildTasksCollapsed: boolean;
    onAreChildTasksCollapsedToggle: () => void;
    onExpand: (() => Promise<void>) | null;
    indentation: number;
    droppableIndentations: ReadonlyArray<number>;
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
};

function TaskRowPresentationalView<TaskRow>(
    {
        taskRow,
        status,
        onStatusChange,
        title,
        onTitleChange,
        titlePlaceholder,
        assignee,
        onAssigneeChange,
        childTaskCount,
        closedChildTaskCount,
        areChildTasksCollapsed,
        onAreChildTasksCollapsedToggle,
        onExpand,
        indentation,
        droppableIndentations,
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
    }: TaskRowPresentationalViewProps<TaskRow>,
    ref: Ref<TaskRowPresentationalViewRef>,
) {
    const rowRef = useRef<HTMLDivElement>(null);
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

    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const rowElement = assertExists(rowRef.current);

        const handlePointerEnter = () => setIsHovered(true);
        const handlePointerLeave = () => setIsHovered(false);

        rowElement.addEventListener("pointerenter", handlePointerEnter);
        rowElement.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            rowElement.removeEventListener("pointerenter", handlePointerEnter);
            rowElement.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, []);

    // If we have received a `pointerenter` event, then listen for `pointerenter`
    // events on `document` which will happen if the mouse enters an element that
    // occludes our own. If the pointer enters an occluding element we should set
    // `isHovered` to false.
    useEffect(() => {
        if (!isHovered) return;

        const rowElement = assertExists(rowRef.current);

        const handleDocumentPointerEnter = (event: PointerEvent) => {
            if (!event.currentTarget || event.currentTarget instanceof Node) {
                setIsHovered(rowElement.contains(event.currentTarget));
            }
        };

        document.addEventListener("pointerenter", handleDocumentPointerEnter);
        return () => {
            document.removeEventListener("pointerenter", handleDocumentPointerEnter);
        };
    }, [isHovered]);

    const {
        attributes: draggableAttributes,
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
    } = useDraggable({
        id: useId(),
        data: {taskRow},
        disabled: !taskRow,
    });

    const dragHandleNode = taskRow && (
        <button
            {...draggableAttributes}
            {...draggableListeners}
            ref={setDraggableNodeRef}
            className={sprinkles({
                width: "4",
                height: "4",
                padding: "0.5",
                borderRadius: "full",
                cursor: "grab",
            })}
            // Drag handle is not tab focusable. Keyboard navigation within a task grid is
            // not done with tab navigation.
            tabIndex={-1}
        >
            <DotsSixVertical size={spacing["3"]} />
        </button>
    );

    // Small naming note: The whitespace area outside of the task row border we
    // call "margin" and the whitespace area inside the task row border we
    // call "padding". Similar to the CSS box model.
    const paddingLeftNode = (
        <Box
            position="relative"
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
            {indentation > 0 && (
                <Box
                    paddingRight="0.5"
                    className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                >
                    {isHovered && dragHandleNode}
                </Box>
            )}
            <Box
                width="5"
                paddingRight="1"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
            >
                {onExpand && isHovered && (
                    <IconButton
                        size="xs"
                        description="Expand"
                        pressErrorTitle="Couldn’t expand task"
                        onPress={onExpand}
                    >
                        <ArrowsOutSimple />
                    </IconButton>
                )}
            </Box>
            <Box
                width="6"
                paddingRight="2"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
            >
                {status !== null ? (
                    <TaskStatusButton
                        status={status}
                        onStatusChange={onStatusChange}
                        assignee={assignee}
                    />
                ) : (
                    <Box
                        width="4"
                        height="4"
                        borderRadius="full"
                        border="grey-10"
                        // Needs to be an inline style to have higher precedence than parent class.
                        style={{pointerEvents: "none"}}
                    />
                )}
            </Box>
        </Box>
    );

    return (
        <Box
            ref={rowRef}
            display="flex"
            height={taskRowViewHeight}
            backgroundColor="grey-0"
            position="relative"
        >
            <Box
                flexShrink="0"
                width="5"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
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
                {indentation === 0 && (
                    <Box
                        paddingRight="0.5"
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                    >
                        {isHovered && dragHandleNode}
                    </Box>
                )}
            </Box>
            <Box
                position="relative"
                zIndex="0"
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
                        title={title}
                        onTitleChange={onTitleChange}
                        placeholder={titlePlaceholder}
                        childTaskCount={childTaskCount}
                        closedChildTaskCount={closedChildTaskCount}
                        areChildTasksCollapsed={areChildTasksCollapsed}
                        onAreChildTasksCollapsedToggle={onAreChildTasksCollapsedToggle}
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
            {droppableIndentations
                .slice()
                .sort((a, b) => a - b)
                .map((indentation, index, sortedDroppableIndentations) => (
                    <TaskRowViewDroppable
                        key={indentation}
                        taskRow={taskRow}
                        indentation={indentation}
                        nextAdjacentIndentation={sortedDroppableIndentations[index + 1] ?? null}
                        previousAdjacentIndentation={sortedDroppableIndentations[index - 1] ?? null}
                    />
                ))}
        </Box>
    );
}
