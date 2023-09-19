import {DotsThree} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useId, useImperativeHandle, useRef} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskDetailTitleInput} from "~/client/tasks/internal/task_detail_title_input.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {Context} from "~/shared/context/context.js";
import {Spacing, assertSpacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {emptyTaskTitleModel, taskFallbackTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export const taskDetailViewMaxWidth: Spacing = "160";

export type TaskDetailViewRef = {
    // NOCOMMIT:
    // getChildTasksGridView(): TaskGridPresentationalViewRef;
};

const TaskDetailViewForwardRef = forwardRef(TaskDetailView);
export {TaskDetailViewForwardRef as TaskDetailView};

function TaskDetailView(
    {
        taskSubscription,
        childrenQuery,
    }: {
        taskSubscription: TaskClientTaskSubscription;
        childrenQuery: TaskClientQuery;
    },
    ref: Ref<TaskDetailViewRef>,
) {
    const context = useAppContext();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {space, currentAccount} = useSpaceContext();

    const {task} = useStore(taskSubscription.taskEntryStore);

    const titleCommitStateRef = useRef<{
        pendingActionTransactionBuilder: {
            add: (titleUpdate: TaskTitleUpdate) => void;
            commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
                finally: (callback: () => void) => void;
            };
        } | null;
    } | null>(null);

    const onTitleChange = (titleUpdate: TaskTitleUpdate) => {
        if (!task) return;

        // When our commit promise finishes, commit the pending update title action if
        // there is one.
        const handleCommitPromise = (commitPromise: {finally: (callback: () => void) => void}) => {
            assert(!titleCommitStateRef.current);

            titleCommitStateRef.current = {
                pendingActionTransactionBuilder: null,
            };

            commitPromise.finally(() => {
                assert(titleCommitStateRef.current);

                const {pendingActionTransactionBuilder} = titleCommitStateRef.current;
                titleCommitStateRef.current = null;

                if (pendingActionTransactionBuilder) {
                    const commitPromise = pendingActionTransactionBuilder.commit(context);
                    handleCommitPromise(commitPromise);
                }
            });
        };

        // If we are currently committing the title then add our update to our pending
        // action transaction builder. We'll commit the pending action after our
        // current action commits.
        if (titleCommitStateRef.current) {
            if (titleCommitStateRef.current.pendingActionTransactionBuilder) {
                titleCommitStateRef.current.pendingActionTransactionBuilder.add(titleUpdate);
            } else {
                titleCommitStateRef.current.pendingActionTransactionBuilder =
                    taskSubscription.store.getTaskUpdateTitleActionTransactionBuilder(
                        taskSubscription.taskId,
                        titleUpdate,
                    );
            }
            return;
        }

        const time = taskSubscription.store.clock.now();

        const commitPromise = taskSubscription.store.commitTaskActionTransaction(context, [
            {
                type: "UpdateTask",
                time,
                taskId: taskSubscription.taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate,
                },
            },
        ]);

        handleCommitPromise(commitPromise);
    };

    const padding: Spacing = isMobile ? "3" : "5";

    // NOCOMMIT:
    // const priorityInputRef = useRef<HTMLDivElement>(null);
    // const dueDateInputRef = useRef<HTMLDivElement>(null);
    // const childTasksGridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            // NOCOMMIT:
            // getChildTasksGridView: () => assertExists(childTasksGridViewRef.current),
        }),
        [],
    );

    // NOCOMMIT:
    // const [priorityInputState, setPriorityInputState] = useState<
    //     {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    // >(priority ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});
    //
    // if (
    //     priorityInputState.isVisible &&
    //     !priorityInputState.isFocused &&
    //     !priorityInputState.shouldFocus &&
    //     !priority
    // ) {
    //     // In task row dense fields we hide the priority field when the value is set to
    //     // null. But since the user may actively be editing the field in detail view,
    //     // keep it around.
    // }
    //
    // if (!priorityInputState.isVisible && priority) {
    //     setPriorityInputState({isVisible: true, shouldFocus: false, isFocused: false});
    // }
    //
    // useLayoutEffectWithoutServerSideWarning(() => {
    //     if (priorityInputState.isVisible && priorityInputState.shouldFocus) {
    //         assertExists(
    //             getNextFocusableElementIfExists(null, {
    //                 withinElement: assertExists(priorityInputRef.current),
    //             }),
    //         ).focus({preventScroll: true});
    //
    //         setPriorityInputState(priorityInputState => {
    //             if (!priorityInputState.isVisible) return priorityInputState;
    //             return {...priorityInputState, shouldFocus: false};
    //         });
    //     }
    // }, [priorityInputState]);

    // NOCOMMIT:
    // const [dueDateInputState, setDueDateInputState] = useState<
    //     {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
    // >(dueDate ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});
    //
    // if (
    //     dueDateInputState.isVisible &&
    //     !dueDateInputState.isFocused &&
    //     !dueDateInputState.shouldFocus &&
    //     !dueDate
    // ) {
    //     // In task row dense fields we hide the due date field when the value is set to
    //     // null. But since the user may actively be editing the field in detail view,
    //     // keep it around.
    // }
    //
    // if (!dueDateInputState.isVisible && dueDate) {
    //     setDueDateInputState({isVisible: true, shouldFocus: false, isFocused: false});
    // }
    //
    // useLayoutEffectWithoutServerSideWarning(() => {
    //     if (dueDateInputState.isVisible && dueDateInputState.shouldFocus) {
    //         assertExists(
    //             getNextFocusableElementIfExists(null, {
    //                 withinElement: assertExists(dueDateInputRef.current),
    //             }),
    //         ).focus({preventScroll: true});
    //
    //         setDueDateInputState(dueDateInputState => {
    //             if (!dueDateInputState.isVisible) return dueDateInputState;
    //             return {...dueDateInputState, shouldFocus: false};
    //         });
    //     }
    // }, [dueDateInputState]);

    const contextMenuActions = (() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        if (task) {
            contextMenuActions.push([
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy task link",
                    onPress: async () => {
                        const url = new URL(
                            `/s/${task.getSpaceId()}/tasks/${task.id}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ]);

            contextMenuActions.push(
                getTaskStatusMenuActions({
                    context,
                    timeZone,
                    currentAccount,
                    store: taskSubscription.store,
                    task,
                }),
            );
        }

        // NOCOMMIT:
        // [
        //     {
        //         label: priorityInputState.isVisible ? "Edit priority" : "Add priority",
        //         onPress: () => {
        //             if (priorityInputState.isVisible) {
        //                 assertExists(
        //                     getNextFocusableElementIfExists(null, {
        //                         withinElement: assertExists(priorityInputRef.current),
        //                     }),
        //                 ).focus({preventScroll: true});
        //             } else {
        //                 setPriorityInputState({
        //                     isVisible: true,
        //                     shouldFocus: true,
        //                     isFocused: false,
        //                 });
        //             }
        //         },
        //     },
        //     {
        //         label: dueDateInputState.isVisible ? "Edit due date" : "Add due date",
        //         onPress: () => {
        //             if (dueDateInputState.isVisible) {
        //                 assertExists(
        //                     getNextFocusableElementIfExists(null, {
        //                         withinElement: assertExists(dueDateInputRef.current),
        //                     }),
        //                 ).focus({preventScroll: true});
        //             } else {
        //                 setDueDateInputState({
        //                     isVisible: true,
        //                     shouldFocus: true,
        //                     isFocused: false,
        //                 });
        //             }
        //         },
        //     },
        // ],
        // NOCOMMIT:
        // [
        //     {
        //         label: "Delete",
        //         onPress: () => {
        //             deleteTaskAndAllChildrenMaybeWithConfirmation({
        //                 // If the task is open in a peek this will close the peek.
        //                 onAfterDelete: () => {
        //                     void navigate(-1);
        //                 },
        //             });
        //         },
        //     },
        // ],

        return contextMenuActions;
    })();

    return (
        <Box
            width="full"
            overflow="hidden"
            maxWidth={taskDetailViewMaxWidth}
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
                    {task ? (
                        <TaskStatusButton size="5" store={taskSubscription.store} task={task} />
                    ) : (
                        <Box
                            width="5"
                            height="5"
                            borderRadius="full"
                            border="grey-10"
                            pointerEvents="none"
                        />
                    )}
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
                        title={task?.getTitle() ?? emptyTaskTitleModel.get()}
                        onTitleChange={onTitleChange}
                        placeholder={taskFallbackTitle}
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
                {/* NOCOMMIT: <TaskDetailViewDenseField label="Assignee">
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
                </TaskDetailViewDenseField> */}
                {/* NOCOMMIT: <TaskDetailViewDenseField label="Collections">
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
                </TaskDetailViewDenseField> */}
                {/* NOCOMMIT: {priorityInputState.isVisible && (
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
                )} */}
                {/* NOCOMMIT: {dueDateInputState.isVisible && (
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
                )} */}
            </Box>
            <Spacer space="9" />
            {/* NOCOMMIT: <TaskDetailNotesField
                notesContent={notesContent}
                onNotesContentChange={onNotesContentChange}
                padding={padding}
            />
            <Spacer space="10" /> */}
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
                        // NOCOMMIT:
                        // assertExists(childTasksGridViewRef.current).focusStart();
                    }}
                >
                    <Box>Subtasks</Box>
                    {/* NOCOMMIT: {childTaskCount > 0 && (
                        <Box display="flex" alignItems="center" gap="1">
                            <TaskChildTasksProgressWheel
                                childTaskCount={childTaskCount}
                                closedChildTaskCount={closedChildTaskCount}
                            />
                            <Box color="grey-70">
                                {closedChildTaskCount}/{childTaskCount}
                            </Box>
                        </Box>
                    )} */}
                </label>
                {/* NOCOMMIT: {useElementWithRef(childTasksGridView, childTasksGridViewRef)} */}
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
