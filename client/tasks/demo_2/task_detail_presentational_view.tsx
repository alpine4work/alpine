import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {DotsThree} from "phosphor-react";
import {
    PropsWithoutRef,
    ReactElement,
    ReactNode,
    Ref,
    RefAttributes,
    forwardRef,
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {ContextMenuActions} from "~/client/design/context_menu";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {IconButton} from "~/client/design/icon_button";
import {MenuAction, MenuButton} from "~/client/design/menu_button";
import {Spacer} from "~/client/design/spacer";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {getTaskStatusMenuActions} from "~/client/tasks/demo_2/internal/get_task_status_menu_actions";
import {TaskAssigneeInput} from "~/client/tasks/demo_2/internal/task_assignee_input";
import {TaskChildTasksProgressWheel} from "~/client/tasks/demo_2/internal/task_child_tasks_progress_wheel";
import {TaskCollectionsInput} from "~/client/tasks/demo_2/internal/task_collections_input";
import {TaskDateInput} from "~/client/tasks/demo_2/internal/task_date_input";
import {TaskDetailNotesField} from "~/client/tasks/demo_2/internal/task_detail_notes_field";
import {TaskDetailTitleInput} from "~/client/tasks/demo_2/internal/task_detail_title_input";
import {TaskPriorityInput} from "~/client/tasks/demo_2/internal/task_priority_input";
import {LocalTaskCollection, TaskPriority} from "~/client/tasks/demo_2/local_tasks_state";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewProps,
    TaskGridPresentationalViewRef,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {Spacing, assertSpacing} from "~/shared/design/spacing";
import {ThemeColor} from "~/shared/design/theme_colors";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {sprinkles} from "~/shared/styles/styles";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

export const taskDetailPresentationalViewMaxWidth: Spacing = "160";

export type TaskDetailPresentationalViewRef = {
    getChildTasksGridView(): TaskGridPresentationalViewRef;
};

const TaskDetailPresentationalViewForwardRef = forwardRef(TaskDetailPresentationalView) as <
    ChildTaskRow,
>(
    props: PropsWithoutRef<TaskDetailPresentationalViewProps<ChildTaskRow>> &
        RefAttributes<TaskDetailPresentationalViewRef>,
) => ReactElement;
export {TaskDetailPresentationalViewForwardRef as TaskDetailPresentationalView};

export type TaskDetailPresentationalViewProps<ChildTaskRow> = {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
    priority: TaskPriority | null;
    onPriorityChange: (priority: TaskPriority | null) => void;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    allCollections: ReadonlyArray<LocalTaskCollection>;
    collections: ReadonlyArray<LocalTaskCollection>;
    createCollectionAndAddToTask: (collection: {
        id: LocalTaskCollectionId;
        name: string;
        color: ThemeColor;
    }) => void;
    addCollectionToTask: (collectionId: LocalTaskCollectionId) => void;
    removeCollectionFromTask: (collectionId: LocalTaskCollectionId) => void;
    notesContent: TaskNotesContentWithReferences;
    onNotesContentChange: (notesContent: TaskNotesContentWithReferences) => void;
    childTaskCount: number;
    closedChildTaskCount: number;
    childTasksGridView: ReactElement<
        TaskGridPresentationalViewProps<ChildTaskRow>,
        typeof TaskGridPresentationalView
    >;
    deleteTaskAndAllChildrenMaybeWithConfirmation: (options?: {onAfterDelete?: () => void}) => void;
};

function TaskDetailPresentationalView<ChildTaskRow>(
    {
        status,
        onStatusChange,
        title,
        onTitleChange,
        assignee,
        onAssigneeChange,
        priority,
        onPriorityChange,
        dueDate,
        onDueDateChange,
        allCollections,
        collections,
        createCollectionAndAddToTask,
        addCollectionToTask,
        removeCollectionFromTask,
        notesContent,
        onNotesContentChange,
        childTaskCount,
        closedChildTaskCount,
        childTasksGridView,
        deleteTaskAndAllChildrenMaybeWithConfirmation,
    }: TaskDetailPresentationalViewProps<ChildTaskRow>,
    ref: Ref<TaskDetailPresentationalViewRef>,
) {
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const padding: Spacing = isMobile ? "3" : "5";

    const priorityInputRef = useRef<HTMLDivElement>(null);
    const dueDateInputRef = useRef<HTMLDivElement>(null);
    const childTasksGridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            getChildTasksGridView: () => assertExists(childTasksGridViewRef.current),
        }),
        [],
    );

    const [priorityInputState, setPriorityInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(priority ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

    if (
        priorityInputState.isVisible &&
        !priorityInputState.isFocused &&
        !priorityInputState.shouldFocus &&
        !priority
    ) {
        // In task row dense fields we hide the priority field when the value is set to
        // null. But since the user may actively be editing the field in detail view,
        // keep it around.
    }

    if (!priorityInputState.isVisible && priority) {
        setPriorityInputState({isVisible: true, shouldFocus: false, isFocused: false});
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (priorityInputState.isVisible && priorityInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(priorityInputRef.current),
                }),
            ).focus({preventScroll: true});

            setPriorityInputState(priorityInputState => {
                if (!priorityInputState.isVisible) return priorityInputState;
                return {...priorityInputState, shouldFocus: false};
            });
        }
    }, [priorityInputState]);

    const [dueDateInputState, setDueDateInputState] = useState<
        {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    >(dueDate ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

    if (
        dueDateInputState.isVisible &&
        !dueDateInputState.isFocused &&
        !dueDateInputState.shouldFocus &&
        !dueDate
    ) {
        // In task row dense fields we hide the due date field when the value is set to
        // null. But since the user may actively be editing the field in detail view,
        // keep it around.
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

    const contextMenuActions: ReadonlyArray<ReadonlyArray<MenuAction>> = [
        [
            {
                label: "Copy link",
                onPress: () => {
                    // NOCOMMIT: Needs production implementation
                },
            },
        ],
        getTaskStatusMenuActions({
            timeZone,
            currentAccount,
            status,
            onStatusChange,
            assignee,
            onAssigneeChange,
        }),
        [
            {
                label: priorityInputState.isVisible ? "Edit priority" : "Add priority",
                onPress: () => {
                    if (priorityInputState.isVisible) {
                        assertExists(
                            getNextFocusableElementIfExists(null, {
                                withinElement: assertExists(priorityInputRef.current),
                            }),
                        ).focus({preventScroll: true});
                    } else {
                        setPriorityInputState({
                            isVisible: true,
                            shouldFocus: true,
                            isFocused: false,
                        });
                    }
                },
            },
            {
                label: dueDateInputState.isVisible ? "Edit due date" : "Add due date",
                onPress: () => {
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
            },
        ],
        [
            {
                label: "Delete",
                onPress: () => {
                    deleteTaskAndAllChildrenMaybeWithConfirmation({
                        // If the task is open in a peek this will close the peek.
                        onAfterDelete: () => {
                            void navigate(-1);
                        },
                    });
                },
            },
        ],
    ];

    return (
        <Box
            width="full"
            overflow="hidden"
            maxWidth={taskDetailPresentationalViewMaxWidth}
            display="flex"
            flexDirection="column"
            position="relative"
        >
            <ContextMenuActions actions={contextMenuActions}>
                <Box
                    paddingTop={padding}
                    paddingBottom="8"
                    paddingX={padding}
                    display="flex"
                    flexDirection="column"
                    gap="3"
                >
                    <TaskStatusButton
                        size="5"
                        status={status}
                        onStatusChange={onStatusChange}
                        assignee={assignee}
                    />
                    <Box
                        position="absolute"
                        top={assertSpacing(`${parseInt(padding, 10) - 2}`)}
                        right={assertSpacing(`${parseInt(padding, 10) - 2}`)}
                    >
                        <MenuButton actions={contextMenuActions}>
                            <IconButton size="md" description="More" withoutTooltip={true}>
                                <DotsThree />
                            </IconButton>
                        </MenuButton>
                    </Box>
                    <TaskDetailTitleInput
                        title={title}
                        onTitleChange={onTitleChange}
                        placeholder="Untitled task"
                    />
                </Box>
            </ContextMenuActions>
            <Box
                paddingX={padding}
                display="grid"
                gap="5"
                style={{
                    gridTemplateColumns: "auto minmax(0, 1fr)",
                    gridTemplateRows: "repeat(auto-fill, auto)",
                    gridAutoFlow: "row dense",
                }}
            >
                <TaskDetailViewDenseField label="Assignee">
                    {({"aria-labelledby": ariaLabelledBy}) => (
                        <TaskAssigneeInput
                            aria-labelledby={ariaLabelledBy}
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
                        />
                    )}
                </TaskDetailViewDenseField>
                <TaskDetailViewDenseField label="Collections">
                    {({"aria-labelledby": ariaLabelledBy}) => (
                        <TaskCollectionsInput
                            allCollections={allCollections}
                            collections={collections}
                            createCollectionAndAddToTask={createCollectionAndAddToTask}
                            addCollectionToTask={addCollectionToTask}
                            removeCollectionFromTask={removeCollectionFromTask}
                            aria-labelledby={ariaLabelledBy}
                        />
                    )}
                </TaskDetailViewDenseField>
                {priorityInputState.isVisible && (
                    <TaskDetailViewDenseField label="Priority">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <Box
                                ref={priorityInputRef}
                                onFocus={() => {
                                    setPriorityInputState(priorityInputState => {
                                        if (!priorityInputState.isVisible)
                                            return priorityInputState;
                                        if (priorityInputState.isFocused) return priorityInputState;
                                        return {...priorityInputState, isFocused: true};
                                    });
                                }}
                                onBlur={event => {
                                    // If focus is moving within the element, don't unfocus.
                                    if (event.currentTarget.contains(event.relatedTarget)) return;

                                    setPriorityInputState(priorityInputState => {
                                        if (!priorityInputState.isVisible)
                                            return priorityInputState;
                                        if (!priorityInputState.isFocused)
                                            return priorityInputState;
                                        return {...priorityInputState, isFocused: false};
                                    });
                                }}
                            >
                                <TaskPriorityInput
                                    priority={priority}
                                    onPriorityChange={onPriorityChange}
                                    aria-labelledby={ariaLabelledBy}
                                />
                            </Box>
                        )}
                    </TaskDetailViewDenseField>
                )}
                {dueDateInputState.isVisible && (
                    <TaskDetailViewDenseField label="Due date">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <Box
                                ref={dueDateInputRef}
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
                                    date={dueDate}
                                    onDateChange={onDueDateChange}
                                    shouldIncludeCalendarIcon={true}
                                    shouldWarnIfAfterDate={status.type === "Open"}
                                    shouldFormatAroundToday={true}
                                    aria-labelledby={ariaLabelledBy}
                                />
                            </Box>
                        )}
                    </TaskDetailViewDenseField>
                )}
            </Box>
            <Spacer space="9" />
            <TaskDetailNotesField
                notesContent={notesContent}
                onNotesContentChange={onNotesContentChange}
                padding={padding}
            />
            <Spacer space="10" />
            <Box>
                <label
                    className={sprinkles({
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3",
                        paddingX: padding,
                        paddingBottom: "2",
                        color: "grey-60",
                    })}
                    // Affordance for mouse users. Clicking on a label focuses child tasks.
                    onClick={() => {
                        assertExists(childTasksGridViewRef.current).focusStart();
                    }}
                >
                    <Box>Subtasks</Box>
                    {childTaskCount > 0 && (
                        <Box display="flex" alignItems="center" gap="1">
                            <TaskChildTasksProgressWheel
                                childTaskCount={childTaskCount}
                                closedChildTaskCount={closedChildTaskCount}
                            />
                            <Box color="grey-70">
                                {closedChildTaskCount}/{childTaskCount}
                            </Box>
                        </Box>
                    )}
                </label>
                {useElementWithRef(childTasksGridView, childTasksGridViewRef)}
            </Box>
        </Box>
    );
}

function TaskDetailViewDenseField({
    label,
    children,
}: {
    label: string;
    children?: ReactNode | ((props: {"aria-labelledby": string}) => ReactNode);
}) {
    const labelId = useId();
    const valueRef = useRef<HTMLDivElement>(null);

    return (
        // Doesn't have a parent to horizontally align elements since we layout fields
        // with CSS grid.
        <>
            <label
                id={labelId}
                className={sprinkles({
                    display: "block",
                    maxWidth: "24",
                    fontStyle: "truncate",
                    color: "grey-60",
                })}
                // As an affordance for mouse users, when the label is clicked we focus
                // the first element in the input.
                onClick={() => {
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(valueRef.current),
                    })?.focus();
                }}
            >
                {label}
            </label>
            <Box ref={valueRef}>
                {typeof children === "function" ? children({"aria-labelledby": labelId}) : children}
            </Box>
        </>
    );
}
