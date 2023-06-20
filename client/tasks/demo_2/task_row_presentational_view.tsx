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
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {Box} from "~/client/design/box";
import {ContextMenuActions} from "~/client/design/context_menu";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {IconButton} from "~/client/design/icon_button";
import {MenuAction} from "~/client/design/menu_button";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useSpaceContext} from "~/client/spaces/space_context";
import {getTaskStatusMenuActions} from "~/client/tasks/demo_2/internal/get_task_status_menu_actions";
import {TaskAssigneeInput} from "~/client/tasks/demo_2/internal/task_assignee_input";
import {TaskDateInput} from "~/client/tasks/demo_2/internal/task_date_input";
import {TaskGridViewCapabilities} from "~/client/tasks/demo_2/internal/task_grid_view_capabilities";
import {TaskGridViewDraggableData} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {TaskRowAssigneeCell} from "~/client/tasks/demo_2/internal/task_row_assignee_cell";
import {taskRowViewMinHeight} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/demo_2/internal/task_row_title_input";
import {TaskRowViewDroppable} from "~/client/tasks/demo_2/internal/task_row_view_droppable";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {AccountModel} from "~/shared/accounts/account_model";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, contentSchemaStyles, sprinkles, tasksStyles} from "~/shared/styles/styles";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

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
    capabilities: TaskGridViewCapabilities;
    taskRow: TaskRow | null;
    status: TaskStatus | null;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    titlePlaceholder?: string;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    parentTaskTitle: TaskTitle | null;
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
        capabilities,
        taskRow,
        status,
        onStatusChange,
        title,
        onTitleChange,
        titlePlaceholder,
        assignee,
        onAssigneeChange,
        dueDate,
        onDueDateChange,
        parentTaskTitle,
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

    const titleInputRef = useRef<TaskRowTitleInputRef>(null);
    const denseAssigneeAndDueDateRef = useRef<TaskRowViewDenseAssigneeAndDueDateFieldsRef>(null);

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

    const [isHovered, hoverRef] = useHoverWithOverlaySupport();

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

    const contextMenuActions = (() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        contextMenuActions.push([
            {
                label: "Copy link",
                onPress: () => {
                    // NOCOMMIT: Needs production implementation
                },
            },
        ]);

        if (status) {
            contextMenuActions.push(
                getTaskStatusMenuActions({
                    timeZone,
                    currentAccount,
                    status,
                    onStatusChange,
                    assignee,
                    onAssigneeChange,
                }),
            );
        }

        if (capabilities.hasDenseAssigneeAndDueDate) {
            contextMenuActions.push([
                {
                    label: assignee ? "Edit assignee" : "Add assignee",
                    onPress: () => {
                        assertExists(denseAssigneeAndDueDateRef.current).focusAssignee();
                    },
                },
                {
                    label: dueDate ? "Edit due date" : "Add due date",
                    onPress: () => {
                        assertExists(denseAssigneeAndDueDateRef.current).focusDueDate();
                    },
                },
                {
                    label: "Add priority",
                    onPress: () => {
                        // NOCOMMIT
                    },
                },
            ]);
        }

        contextMenuActions.push([
            {
                label: "Delete",
                onPress: () => {
                    // NOCOMMIT
                },
            },
        ]);

        return contextMenuActions;
    })();

    const marginLeft: RemLength = `${
        parseRemLengthNumber(spacing["5"]) +
        (!withoutPaddingLeft
            ? parseRemLengthNumber(spacing["5"]) +
              parseRemLengthNumber(spacing["6"]) +
              parseRemLengthNumber(contentSchemaStyles.listItemIndentation) * indentation
            : 0)
    }rem`;

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box
                ref={hoverRef}
                minHeight={taskRowViewMinHeight}
                position="relative"
                // NOTE(calebmer): Setting z-index here creates a new stacking context which
                // means the task row drop indicator lines can't render on top of
                // adjacent rows.
                zIndex={undefined}
            >
                <Box
                    position="absolute"
                    zIndex="-10"
                    top="0"
                    bottom="0"
                    left="5"
                    right="5"
                    pointerEvents="none"
                    style={{
                        // Draw the top and bottom border with a shadow so it:
                        //
                        // 1. Doesn't add 2px to layout
                        // 2. Adjacent borders share the same space so we don't get 2px dividers
                        boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                    }}
                />
                <Box position="relative" zIndex="0" flexGrow="1" overflow="hidden" display="flex">
                    <Box
                        position="relative"
                        flexShrink="0"
                        style={{width: marginLeft}}
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
                        {!withoutPaddingLeft && (
                            <Box
                                display="flex"
                                justifyContent="flex-end"
                                alignItems="center"
                                height={taskRowViewMinHeight}
                                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            >
                                <Box
                                    paddingRight="0.5"
                                    className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                                >
                                    {isHovered && taskRow && (
                                        <button
                                            {...mergeProps(
                                                draggableAttributes,
                                                draggableListeners ?? {},
                                                {
                                                    onPointerDown: () =>
                                                        setIsDragHandlePressed(true),
                                                    onPointerUp: () =>
                                                        setIsDragHandlePressed(false),
                                                    onPointerOut: () =>
                                                        setIsDragHandlePressed(false),
                                                },
                                            )}
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
                                    )}
                                </Box>
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
                        )}
                    </Box>
                    <Box flexGrow="1" overflow="hidden">
                        <TaskRowTitleInput
                            ref={titleInputRef}
                            capabilities={capabilities}
                            title={title}
                            onTitleChange={onTitleChange}
                            placeholder={titlePlaceholder}
                            indentation={indentation}
                            parentTaskTitle={parentTaskTitle}
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
                    {capabilities.hasColumns && (
                        <>
                            <TaskRowAssigneeCell
                                assignee={assignee}
                                onAssigneeChange={onAssigneeChange}
                            />
                            <Box flexShrink="0" width="32" paddingX="1.5" overflow="hidden"></Box>
                            <Box flexShrink="0" width="32" paddingX="1.5" overflow="hidden"></Box>
                            <Box flexShrink="0" width="48" paddingX="1.5" overflow="hidden"></Box>
                        </>
                    )}
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
                {capabilities.hasDenseAssigneeAndDueDate && (
                    <TaskRowViewDenseAssigneeAndDueDateFields
                        ref={denseAssigneeAndDueDateRef}
                        status={status}
                        assigneeAccount={assignee?.account ?? null}
                        onAssigneeAccountChange={assigneeAccount => {
                            const assignedTime = new Date();
                            const assignedDate = toCalendarDate(
                                parseAbsolute(assignedTime.toISOString(), timeZone),
                            );

                            onAssigneeChange(
                                assigneeAccount
                                    ? {
                                          account: assigneeAccount,
                                          assignerId: currentAccount.id,
                                          assignedTime,
                                          assignerTimeZone: timeZone,
                                          assignedDate,
                                          status: {type: "Inactive"},
                                      }
                                    : null,
                            );
                        }}
                        dueDate={dueDate}
                        onDueDateChange={onDueDateChange}
                        marginLeft={marginLeft}
                        focusTitleStart={focusTitleStart}
                        focusTitleEnd={focusTitleEnd}
                        focusTitleAll={focusTitleAll}
                    />
                )}
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

type TaskRowViewDenseAssigneeAndDueDateFieldsRef = {
    focusAssignee(): void;
    focusDueDate(): void;
};

const TaskRowViewDenseAssigneeAndDueDateFields = forwardRef(
    function TaskRowViewDenseAssigneeAndDueDateFields(
        {
            status,
            assigneeAccount,
            onAssigneeAccountChange,
            dueDate,
            onDueDateChange,
            marginLeft,
            focusTitleStart,
            focusTitleEnd,
            focusTitleAll,
        }: {
            status: TaskStatus | null;
            assigneeAccount: AccountModel | null;
            onAssigneeAccountChange: (assigneeAccount: AccountModel | null) => void;
            dueDate: CalendarDate | null;
            onDueDateChange: (dueDate: CalendarDate | null) => void;
            marginLeft: RemLength;
            focusTitleEnd: () => void;
            focusTitleStart: () => void;
            focusTitleAll: () => void;
        },
        ref: Ref<TaskRowViewDenseAssigneeAndDueDateFieldsRef>,
    ) {
        const assigneeInputRef = useRef<HTMLDivElement>(null);
        const dueDateInputRef = useRef<HTMLDivElement>(null);

        const fieldMaxWidth = `calc(50% - ${
            parseRemLengthNumber(
                addRemLengths(
                    marginLeft, // Margin left
                    spacing["2"], // Gap
                    spacing["5"], // Margin right
                ),
            ) / 2
        }rem)`;

        const [assigneeInputState, setAssigneeInputState] = useState<
            {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
        >(
            assigneeAccount
                ? {isVisible: true, shouldFocus: false, isFocused: false}
                : {isVisible: false},
        );

        if (
            assigneeInputState.isVisible &&
            !assigneeInputState.isFocused &&
            !assigneeInputState.shouldFocus &&
            !assigneeAccount
        ) {
            setAssigneeInputState({isVisible: false});
        }

        if (!assigneeInputState.isVisible && assigneeAccount) {
            setAssigneeInputState({isVisible: true, shouldFocus: false, isFocused: false});
        }

        useLayoutEffectWithoutServerSideWarning(() => {
            if (assigneeInputState.isVisible && assigneeInputState.shouldFocus) {
                assertExists(
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(assigneeInputRef.current),
                    }),
                ).focus({preventScroll: true});

                setAssigneeInputState(assigneeInputState => {
                    if (!assigneeInputState.isVisible) return assigneeInputState;
                    return {...assigneeInputState, shouldFocus: false};
                });
            }
        }, [assigneeInputState]);

        const [dueDateInputState, setDueDateInputState] = useState<
            {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
        >(dueDate ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

        if (
            dueDateInputState.isVisible &&
            !dueDateInputState.isFocused &&
            !dueDateInputState.shouldFocus &&
            !dueDate
        ) {
            setDueDateInputState({isVisible: false});
        }

        if (!dueDateInputState.isVisible && dueDate) {
            setDueDateInputState({isVisible: true, shouldFocus: false, isFocused: false});
        }

        useLayoutEffectWithoutServerSideWarning(() => {
            if (dueDateInputState.isVisible && dueDateInputState.shouldFocus) {
                assertExists(
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(dueDateInputRef.current),
                    }),
                ).focus({preventScroll: true});

                setDueDateInputState(dueDateInputState => {
                    if (!dueDateInputState.isVisible) return dueDateInputState;
                    return {...dueDateInputState, shouldFocus: false};
                });
            }
        }, [dueDateInputState]);

        useImperativeHandle(
            ref,
            () => ({
                focusAssignee: () => {
                    if (assigneeInputState.isVisible) {
                        assertExists(
                            getNextFocusableElementIfExists(null, {
                                withinElement: assertExists(assigneeInputRef.current),
                            }),
                        ).focus({preventScroll: true});
                    } else {
                        setAssigneeInputState({
                            isVisible: true,
                            shouldFocus: true,
                            isFocused: false,
                        });
                    }
                },
                focusDueDate: () => {
                    if (dueDateInputState.isVisible) {
                        assertExists(
                            getNextFocusableElementIfExists(null, {
                                withinElement: assertExists(dueDateInputRef.current),
                            }),
                        ).focus({preventScroll: true});
                    } else {
                        setDueDateInputState({
                            isVisible: true,
                            shouldFocus: true,
                            isFocused: false,
                        });
                    }
                },
            }),
            [assigneeInputState.isVisible, dueDateInputState.isVisible],
        );

        const node = (
            <Box display="flex" alignItems="stretch">
                <Box
                    flexShrink="0"
                    cursor="text"
                    style={{width: marginLeft}}
                    {...useOutOfBoundsClickSelection({
                        onSelect: focusTitleStart,
                        onSelectAll: focusTitleAll,
                    })}
                />
                <Box
                    flexGrow="1"
                    display="flex"
                    gap="5"
                    // I find some negative `marginLeft` helps the fields feel optically aligned.
                    marginLeft="-0.5"
                    // I find some negative `marginTop` helps the fields feel optically aligned.
                    // Since above us is text, not a divider line.
                    marginTop="-0.5"
                    paddingBottom="2"
                    className={tasksStyles.textCursorNotInheritedClassName}
                    {...useOutOfBoundsClickSelection({
                        onSelect: focusTitleEnd,
                        onSelectAll: focusTitleAll,
                    })}
                >
                    {assigneeInputState.isVisible && (
                        <Box
                            ref={assigneeInputRef}
                            flexShrink="0"
                            style={{maxWidth: fieldMaxWidth}}
                            className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            onFocus={() => {
                                setAssigneeInputState(assigneeInputState => {
                                    if (!assigneeInputState.isVisible) return assigneeInputState;
                                    if (assigneeInputState.isFocused) return assigneeInputState;
                                    return {...assigneeInputState, isFocused: true};
                                });
                            }}
                            onBlur={event => {
                                // If focus is moving within the element, don't unfocus.
                                if (event.currentTarget.contains(event.relatedTarget)) return;

                                setAssigneeInputState(assigneeInputState => {
                                    if (!assigneeInputState.isVisible) return assigneeInputState;
                                    if (!assigneeInputState.isFocused) return assigneeInputState;
                                    return {...assigneeInputState, isFocused: false};
                                });
                            }}
                        >
                            <TaskAssigneeInput
                                aria-label="Assignee"
                                assigneeAccount={assigneeAccount}
                                onAssigneeAccountChange={onAssigneeAccountChange}
                                color="grey-60"
                                avatarSize="4"
                                shouldDisplayShortName={true}
                            />
                        </Box>
                    )}
                    {dueDateInputState.isVisible && (
                        <Box
                            ref={dueDateInputRef}
                            flexShrink="0"
                            style={{maxWidth: fieldMaxWidth}}
                            className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            onFocus={() => {
                                setDueDateInputState(dueDateInputState => {
                                    if (!dueDateInputState.isVisible) return dueDateInputState;
                                    if (dueDateInputState.isFocused) return dueDateInputState;
                                    return {...dueDateInputState, isFocused: true};
                                });
                            }}
                            onBlur={event => {
                                // If focus is moving within the element, don't unfocus.
                                if (event.currentTarget.contains(event.relatedTarget)) return;

                                setDueDateInputState(dueDateInputState => {
                                    if (!dueDateInputState.isVisible) return dueDateInputState;
                                    if (!dueDateInputState.isFocused) return dueDateInputState;
                                    return {...dueDateInputState, isFocused: false};
                                });
                            }}
                        >
                            <TaskDateInput
                                aria-labelledby="Due date"
                                date={dueDate}
                                onDateChange={onDueDateChange}
                                shouldIncludeCalendarIcon={true}
                                shouldWarnIfAfterDate={status?.type === "Open"}
                                shouldFormatToday={true}
                                color="grey-60"
                            />
                        </Box>
                    )}
                </Box>
            </Box>
        );

        if (!assigneeInputState.isVisible && !dueDateInputState.isVisible) return null;
        return node;
    },
);
