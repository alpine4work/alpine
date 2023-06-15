import {useDraggable} from "@dnd-kit/core";
import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ArrowsOutSimple, DotsSixVertical} from "phosphor-react";
import {Selection} from "prosemirror-state";
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
import {mergeProps} from "react-aria";
import {Box} from "~/client/design/box";
import {ContextMenuActions} from "~/client/design/context_menu";
import {IconButton} from "~/client/design/icon_button";
import {MenuAction} from "~/client/design/menu_button";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useSpaceContext} from "~/client/spaces/space_context";
import {TaskGridViewDraggableData} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
    taskRowTitleInputSingleLineHeight,
} from "~/client/tasks/demo_2/internal/task_row_title_input";
import {TaskRowViewDroppable} from "~/client/tasks/demo_2/internal/task_row_view_droppable";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {initialOrderKey} from "~/shared/helpers/sort/order_key";
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

export const taskRowViewMinHeight: Spacing = taskRowTitleInputSingleLineHeight;

export type TaskRowPresentationalViewRef = {
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitleCoord(coord: number): void;
    focusTitleSelection(selection: Selection): void;
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
    shouldRenderMultilineTitle: boolean;
    titlePlaceholder?: string;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    shouldShowDenseAssigneeAndDueDate: boolean;
    parentTaskTitle: TaskTitle | null;
    shouldShowParentTaskTitle: boolean;
    childTaskCount: number;
    closedChildTaskCount: number;
    areChildTasksCollapsed: boolean;
    onAreChildTasksCollapsedToggle: () => void;
    onExpand: (() => Promise<void>) | null;
    indentation: number;
    droppableIndentations: ReadonlyArray<number>;
    createTaskAbove: () => void;
    createTaskBelowAndFocus: () => void;
    createTaskChildAtStartAndFocus: () => void;
    nestWithPreviousTaskRowIfExistsAndExpand: (titleSelection: Selection) => void;
    unnestTaskIfNestedRow: (titleSelection: Selection) => void;
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
        shouldRenderMultilineTitle,
        assignee,
        onAssigneeChange,
        dueDate,
        onDueDateChange,
        // NOCOMMIT: Do something with this!
        shouldShowDenseAssigneeAndDueDate,
        parentTaskTitle,
        shouldShowParentTaskTitle,
        childTaskCount,
        closedChildTaskCount,
        areChildTasksCollapsed,
        onAreChildTasksCollapsedToggle,
        onExpand,
        indentation,
        droppableIndentations,
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
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

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

    const focusTitleCoord = useCallback((coord: number) => {
        assertExists(titleInputRef.current).focusCoord(coord);
    }, []);

    const focusTitleSelection = useCallback((selection: Selection) => {
        assertExists(titleInputRef.current).focusSelection(selection);
    }, []);

    useImperativeHandle(ref, () => ({
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
    }));

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
        data: taskRow
            ? ({type: "Row", taskRow} satisfies TaskGridViewDraggableData<TaskRow>)
            : undefined,
        disabled: !taskRow,
    });

    const [isDragHandlePressed, setIsDragHandlePressed] = useState(false);

    const dragHandleNode = taskRow && (
        <button
            {...mergeProps(draggableAttributes, draggableListeners ?? {}, {
                onPointerDown: () => setIsDragHandlePressed(true),
                onPointerUp: () => setIsDragHandlePressed(false),
                onPointerOut: () => setIsDragHandlePressed(false),
            })}
            ref={setDraggableNodeRef}
            className={sprinkles({
                display: "block",
                width: "4",
                height: "4",
                padding: "0.5",
                borderRadius: "full",
                // Dragging doesn't activate until the mouse moves. Set the grabbing cursor
                // immediately on press.
                cursor: isDragHandlePressed ? "grabbing" : "grab",
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
                onSelect: focusTitleStart,
                onSelectAll: focusTitleAll,
            })}
        >
            <Box
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                height={taskRowViewMinHeight}
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
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
                            pointerEvents="none"
                        />
                    )}
                </Box>
            </Box>
        </Box>
    );

    const contextMenuActions = (() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        if (status) {
            if (status.type === "Closed") {
                contextMenuActions.push([
                    {
                        label: "Mark open",
                        icon: <TaskStatusCircle status="Open" size="3" />,
                        onPress: () => {
                            onStatusChange({type: "Open"});
                        },
                    },
                    {
                        label: "Mark active",
                        icon: <TaskStatusCircle status="Active" size="3" />,
                        onPress: () => {
                            const assignedTime = new Date();
                            const assignedDate = toCalendarDate(
                                parseAbsolute(assignedTime.toISOString(), timeZone),
                            );

                            onStatusChange({type: "Open"});

                            onAssigneeChange({
                                account: currentAccount,
                                assignerId: currentAccount.id,
                                assignedTime,
                                assignerTimeZone: timeZone,
                                assignedDate,
                                ...assignee,
                                status: {
                                    type: "Active",
                                    orderTime: new Date(),
                                    orderKey: initialOrderKey,
                                    activatorId: currentAccount.id,
                                    activatedTime: assignedTime,
                                    activatorTimeZone: timeZone,
                                    activatedDate: assignedDate,
                                },
                            });
                        },
                    },
                ]);
            } else {
                if (assignee?.status.type === "Active") {
                    contextMenuActions.push([
                        {
                            label: "Mark inactive",
                            icon: <TaskStatusCircle status="Open" size="3" />,
                            onPress: () => {
                                onAssigneeChange({
                                    ...assignee,
                                    status: {type: "Inactive"},
                                });
                            },
                        },
                        {
                            label: "Mark closed",
                            icon: <TaskStatusCircle status="Closed" size="3" />,
                            onPress: () => {
                                const closedTime = new Date();
                                const closedDate = toCalendarDate(
                                    parseAbsolute(closedTime.toISOString(), timeZone),
                                );

                                onStatusChange({
                                    type: "Closed",
                                    closerId: currentAccount.id,
                                    closedTime,
                                    closerTimeZone: timeZone,
                                    closedDate,
                                });
                            },
                        },
                    ]);
                } else {
                    contextMenuActions.push([
                        {
                            label: "Mark active",
                            icon: <TaskStatusCircle status="Active" size="3" />,
                            onPress: () => {
                                const assignedTime = new Date();
                                const assignedDate = toCalendarDate(
                                    parseAbsolute(assignedTime.toISOString(), timeZone),
                                );

                                onAssigneeChange({
                                    account: currentAccount,
                                    assignerId: currentAccount.id,
                                    assignedTime,
                                    assignerTimeZone: timeZone,
                                    assignedDate,
                                    ...assignee,
                                    status: {
                                        type: "Active",
                                        orderTime: new Date(),
                                        orderKey: initialOrderKey,
                                        activatorId: currentAccount.id,
                                        activatedTime: assignedTime,
                                        activatorTimeZone: timeZone,
                                        activatedDate: assignedDate,
                                    },
                                });
                            },
                        },
                        {
                            label: "Mark closed",
                            icon: <TaskStatusCircle status="Closed" size="3" />,
                            onPress: () => {
                                const closedTime = new Date();
                                const closedDate = toCalendarDate(
                                    parseAbsolute(closedTime.toISOString(), timeZone),
                                );

                                onStatusChange({
                                    type: "Closed",
                                    closerId: currentAccount.id,
                                    closedTime,
                                    closerTimeZone: timeZone,
                                    closedDate,
                                });
                            },
                        },
                    ]);
                }
            }
        }

        return contextMenuActions;
    })();

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box
                ref={rowRef}
                display="flex"
                minHeight={taskRowViewMinHeight}
                backgroundColor="grey-0"
                position="relative"
            >
                <Box
                    flexShrink="0"
                    width="5"
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    className={tasksStyles.textCursorNotInheritedClassName}
                    {...useOutOfBoundsClickSelection({
                        onSelect: focusTitleStart,
                        onSelectAll: focusTitleAll,
                    })}
                >
                    {indentation === 0 && (
                        <Box
                            width="full"
                            height={taskRowViewMinHeight}
                            display="flex"
                            justifyContent="flex-end"
                            alignItems="center"
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
                            shouldRenderMultilineTitle={shouldRenderMultilineTitle}
                            placeholder={titlePlaceholder}
                            indentation={indentation}
                            parentTaskTitle={parentTaskTitle}
                            shouldShowParentTaskTitle={shouldShowParentTaskTitle}
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
                    .map((droppableIndentation, index, sortedDroppableIndentations) => (
                        <TaskRowViewDroppable
                            key={droppableIndentation}
                            taskRow={taskRow}
                            indentation={droppableIndentation}
                            nextAdjacentIndentation={sortedDroppableIndentations[index + 1] ?? null}
                            previousAdjacentIndentation={
                                sortedDroppableIndentations[index - 1] ?? null
                            }
                            isVerticallyFlipped={droppableIndentation > indentation}
                        />
                    ))}
            </Box>
        </ContextMenuActions>
    );
}
