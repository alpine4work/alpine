import {DotsThree} from "phosphor-react";
import {ReactNode, useCallback, useId, useImperativeHandle, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskDetailTitleInput} from "~/client/tasks/internal/task_detail_title_input.js";
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskPriorityInput} from "~/client/tasks/internal/task_priority_input.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Context} from "~/shared/context/context.js";
import {Spacing, assertSpacing, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {emptyTaskTitleModel, taskFallbackTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export const taskDetailViewMaxWidth: Spacing = "160";

export function TaskDetailView({
    taskSubscription,
    childrenQuery,
    initialChildrenGridViewExpansionState,
    initialBottomGhostTaskId,
}: {
    taskSubscription: TaskClientTaskSubscription;
    childrenQuery: TaskClientQuery;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const childrenGridViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const shiftRenderedRangeForChildrenGridView = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            if (!range) {
                return null;
            } else {
                const startIndex = range.startIndex - 1;
                const endIndex = range.endIndex - 1;
                if (endIndex < 0) {
                    return null;
                } else {
                    return {
                        startIndex: Math.max(0, startIndex),
                        endIndex,
                    };
                }
            }
        },
        [],
    );

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of
    // items which precede our children grid view.
    useImperativeHandle(
        childrenGridViewRef,
        () => ({
            getHeight: () => assertExists(viewRef.current).getHeight(),
            getContentHeight: () => assertExists(viewRef.current).getContentHeight(),
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: scrollOffset =>
                assertExists(viewRef.current).setScrollOffset(scrollOffset),
            getRenderedRange: () =>
                shiftRenderedRangeForChildrenGridView(
                    assertExists(viewRef.current).getRenderedRange(),
                ),
            getKeyByIndexIfExists: index =>
                assertExists(viewRef.current).getKeyByIndexIfExists(index + 1),
            getIndexByKeyIfExists: key => {
                const index = assertExists(viewRef.current).getIndexByKeyIfExists(key);
                if (index === null) return index;
                return index - 1;
            },
            getPositionByIndex: index =>
                assertExists(viewRef.current).getPositionByIndex(index + 1),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset =>
                shiftRenderedRangeForChildrenGridView(
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                ),
        }),
        [shiftRenderedRangeForChildrenGridView],
    );

    const {
        modals: childrenGridViewModals,
        itemCount: childrenGridViewItemCount,
        renderItem: renderChildrenGridViewItem,
        onRenderedRangeChange: onChildrenGridViewRenderedRangeChange,
        focusStart: focusChildrenGridViewStart,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                hasParentTaskTitle: false,
                hasMultilineTitle: true,
                hasDenseFields: true,
                hasColumns: false,
            }),
            [],
        ),
        query: childrenQuery,
        initialExpansionState: initialChildrenGridViewExpansionState,
        initialBottomGhostTaskId,
        viewRef: childrenGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            const time1 = taskSubscription.store.clock.now();
            const time2 = taskSubscription.store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {type: "UpdateParentTaskId", parentTaskId: taskSubscription.taskId},
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: getNewTaskPositionForQuerySortedByPosition(
                            time2,
                            childrenQuery,
                            position,
                        ),
                    },
                },
            ];
        },
        getMaybeRemoveTaskFromQueryActions: taskId => [
            {
                type: "UpdateTask",
                time: taskSubscription.store.clock.now(),
                taskId,
                taskAction: {type: "UpdateParentTaskId", parentTaskId: null},
            },
        ],
    });

    return (
        <>
            {childrenGridViewModals}
            <VirtualizedScrollView
                ref={viewRef}
                bufferedItemHeight={spacing[taskRowViewMinHeight]}
                itemCount={childrenGridViewItemCount + 1}
                renderItem={useCallback(
                    index => {
                        if (index === 0) {
                            return {
                                key: "TaskDetailViewMain",
                                // Initial height of:
                                //
                                // - Header (status button and more dropdown)
                                // - One line of title text
                                // - Assignee field
                                // - Collections field
                                // - Notes field
                                // - Subtasks header
                                //
                                // Often the height is larger but never smaller.
                                //
                                // NOCOMMIT: Check to make sure this value is accurate when all our UI is
                                // in place!
                                minHeight: "18.75rem",
                                node: (
                                    <TaskDetailViewMain
                                        taskSubscription={taskSubscription}
                                        focusChildrenGridViewStart={focusChildrenGridViewStart}
                                    />
                                ),
                            };
                        }

                        return renderChildrenGridViewItem(index - 1);
                    },
                    [focusChildrenGridViewStart, renderChildrenGridViewItem, taskSubscription],
                )}
                onRenderedRangeChange={range => {
                    onChildrenGridViewRenderedRangeChange(
                        shiftRenderedRangeForChildrenGridView(range),
                    );
                }}
            />
        </>
    );
}

function TaskDetailViewMain({
    taskSubscription,
    focusChildrenGridViewStart,
}: {
    taskSubscription: TaskClientTaskSubscription;
    focusChildrenGridViewStart: () => void;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const {task} = useStore(taskSubscription.taskEntryStore);
    const priority = task?.getPriority() ?? null;
    const dueDate = task?.getDueDate() ?? null;

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

    const priorityInputRef = useRef<HTMLDivElement>(null);
    const dueDateInputRef = useRef<HTMLDivElement>(null);

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

        contextMenuActions.push([
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
        ]);

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
                                    onPriorityChange={priority => {
                                        taskSubscription.store.commitTaskActionTransaction(
                                            context,
                                            [
                                                {
                                                    type: "UpdateTask",
                                                    time: taskSubscription.store.clock.now(),
                                                    taskId: taskSubscription.taskId,
                                                    taskAction: {
                                                        type: "UpdatePriority",
                                                        priority,
                                                    },
                                                },
                                            ],
                                        );
                                    }}
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
                                    onDateChange={dueDate => {
                                        taskSubscription.store.commitTaskActionTransaction(
                                            context,
                                            [
                                                {
                                                    type: "UpdateTask",
                                                    time: taskSubscription.store.clock.now(),
                                                    taskId: taskSubscription.taskId,
                                                    taskAction: {
                                                        type: "UpdateDueDate",
                                                        dueDate,
                                                    },
                                                },
                                            ],
                                        );
                                    }}
                                    shouldIncludeCalendarIcon={true}
                                    shouldWarnIfAfterDate={task?.getDisplayStatus() !== "Closed"}
                                    shouldFormatAroundToday={true}
                                    aria-labelledby={ariaLabelledBy}
                                />
                            </Box>
                        )}
                    </TaskDetailViewDenseField>
                )}
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
                    onClick={focusChildrenGridViewStart}
                >
                    <Box>Subtasks</Box>
                    {task && task.getChildTaskCount() > 0 && (
                        <Box display="flex" alignItems="center" gap="1">
                            <TaskChildTasksProgressWheel
                                childTaskCount={task.getChildTaskCount()}
                                closedChildTaskCount={task.getClosedChildTaskCount()}
                            />
                            <Box color="grey-70">
                                {task.getClosedChildTaskCount()}/{task.getChildTaskCount()}
                            </Box>
                        </Box>
                    )}
                </label>
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
