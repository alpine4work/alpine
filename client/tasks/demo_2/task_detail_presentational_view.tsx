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
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {Spacer} from "~/client/design/spacer";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {useSpaceContext} from "~/client/spaces/space_context";
import {getTaskStatusMenuActions} from "~/client/tasks/demo_2/internal/get_task_status_menu_actions";
import {TaskAssigneeInput} from "~/client/tasks/demo_2/internal/task_assignee_input";
import {TaskChildTasksProgressWheel} from "~/client/tasks/demo_2/internal/task_child_tasks_progress_wheel";
import {TaskDateInput} from "~/client/tasks/demo_2/internal/task_date_input";
import {TaskDetailCollectionsField} from "~/client/tasks/demo_2/internal/task_detail_collections_field";
import {TaskDetailNotesField} from "~/client/tasks/demo_2/internal/task_detail_notes_field";
import {TaskDetailTitleInput} from "~/client/tasks/demo_2/internal/task_detail_title_input";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
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
};

function TaskDetailPresentationalView<ChildTaskRow>(
    {
        status,
        onStatusChange,
        title,
        onTitleChange,
        assignee,
        onAssigneeChange,
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
    }: TaskDetailPresentationalViewProps<ChildTaskRow>,
    ref: Ref<TaskDetailPresentationalViewRef>,
) {
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const padding: Spacing = isMobile ? "3" : "5";

    const denseFieldsRef = useRef<TaskDetailViewDenseFieldsRef>(null);
    const childTasksGridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            getChildTasksGridView: () => assertExists(childTasksGridViewRef.current),
        }),
        [],
    );

    return (
        <Box
            width="full"
            overflow="hidden"
            maxWidth={taskDetailPresentationalViewMaxWidth}
            paddingY={padding}
            display="flex"
            flexDirection="column"
            position="relative"
        >
            <Box paddingX={padding} display="flex" flexDirection="column" gap="3">
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
                    <MenuButton
                        actions={[
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
                                    label: "Add due date",
                                    onPress: () => {
                                        assertExists(denseFieldsRef.current).focusDueDate();
                                    },
                                },
                                {
                                    label: "Add priority",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Delete",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                            ],
                        ]}
                    >
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
            <Spacer space="8" />
            <TaskDetailViewDenseFields
                ref={denseFieldsRef}
                status={status}
                assignee={assignee}
                onAssigneeChange={onAssigneeChange}
                dueDate={dueDate}
                onDueDateChange={onDueDateChange}
                allCollections={allCollections}
                collections={collections}
                createCollectionAndAddToTask={createCollectionAndAddToTask}
                addCollectionToTask={addCollectionToTask}
                removeCollectionFromTask={removeCollectionFromTask}
                padding={padding}
            />
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

type TaskDetailViewDenseFieldsRef = {
    focusDueDate(): void;
};

/**
 * IMPORTANT: While programming task detail fields, keep the following in mind:
 *
 * - The cursor hit box of a task field should not extend beyond the content of
 *   the task field. We are using borderless inputs, it would be confusing to
 *   the user if empty whitespace was clickable.
 *
 * - Make sure field content that extends beyond the screen width is
 *   appropriately truncated. Our use of CSS grid may mean you need to fiddle
 *   around a bit to get truncation right.
 */
const TaskDetailViewDenseFields = forwardRef(function TaskDetailViewDenseFields(
    {
        status,
        assignee,
        onAssigneeChange,
        dueDate,
        onDueDateChange,
        allCollections,
        collections,
        createCollectionAndAddToTask,
        addCollectionToTask,
        removeCollectionFromTask,
        padding,
    }: {
        status: TaskStatus;
        assignee: TaskAssignee | null;
        onAssigneeChange: (assignee: TaskAssignee | null) => void;
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
        padding: Spacing;
    },
    ref: Ref<TaskDetailViewDenseFieldsRef>,
) {
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const dueDateInputRef = useRef<HTMLDivElement>(null);

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

    useImperativeHandle(
        ref,
        () => ({
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
        [dueDateInputState.isVisible],
    );

    return (
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
            <TaskDetailViewField label="Assignee">
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
            </TaskDetailViewField>
            <TaskDetailViewField label="Collections">
                {({"aria-labelledby": ariaLabelledBy}) => (
                    <TaskDetailCollectionsField
                        allCollections={allCollections}
                        collections={collections}
                        createCollectionAndAddToTask={createCollectionAndAddToTask}
                        addCollectionToTask={addCollectionToTask}
                        removeCollectionFromTask={removeCollectionFromTask}
                        aria-labelledby={ariaLabelledBy}
                    />
                )}
            </TaskDetailViewField>
            {dueDateInputState.isVisible && (
                <TaskDetailViewField label="Due date">
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
                                shouldFormatToday={true}
                                aria-labelledby={ariaLabelledBy}
                            />
                        </Box>
                    )}
                </TaskDetailViewField>
            )}
        </Box>
    );
});

function TaskDetailViewField({
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
