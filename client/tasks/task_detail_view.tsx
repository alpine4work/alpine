import {DotsThree, IconContext, Trash} from "phosphor-react";
import {
    CSSProperties,
    ReactNode,
    useCallback,
    useContext,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
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
import {getTaskSubscriptionAccessStore} from "~/client/tasks/internal/get_task_subscription_access_store.js";
import {TaskAssigneeInput} from "~/client/tasks/internal/task_assignee_input.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {TaskCollectionsInput} from "~/client/tasks/internal/task_collections_input.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {TaskDetailNotesField} from "~/client/tasks/internal/task_detail_notes_field.js";
import {TaskDetailTitleInput} from "~/client/tasks/internal/task_detail_title_input.js";
import {TaskGridViewDndContext} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
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
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {invertSelectionColorsClassName, sprinkles} from "~/shared/styles/styles.js";
import {emptyTaskTitleModel, taskFallbackTitle} from "~/shared/tasks/model/task_title_model.js";
import {hasTaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export const taskDetailViewMaxWidth: Spacing = "160";

export function TaskDetailView({
    taskSubscription,
    childrenQuery,
    initialChildrenGridViewExpansionState,
    initialBottomGhostTaskId,
    initialNotesVersion,
    initialNotesContent,
}: {
    taskSubscription: TaskClientTaskSubscription;
    childrenQuery: TaskClientQuery;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
}) {
    const {currentAccount} = useSpaceContext();
    const {store} = taskSubscription;

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
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
        }),
        [shiftRenderedRangeForChildrenGridView],
    );

    const hasSubtasks = useStore(
        useMemo(
            () => taskSubscription.taskEntryStore.map(({task}) => !task?.isDeleted()),
            [taskSubscription.taskEntryStore],
        ),
    );

    const readOnlyReason = useStore(
        useMemo(
            () =>
                getTaskSubscriptionAccessStore(currentAccount.id, taskSubscription).map(access => {
                    switch (access.type) {
                        case "Deleted": {
                            // TODO(calebmer): Add an "undelete" button when we support undo?
                            return {
                                icon: <Trash />,
                                message: "This task was deleted. You can’t make changes",
                            };
                        }
                        case "PermissionDenied": {
                            // TODO(calebmer): If the user removed their own access by removing a
                            // collection or changing the assignee, we should hint to them that they're
                            // allowed to undo and give them an undo button.
                            return {
                                icon: <PencilSimpleSlash />,
                                message: "You’ve lost access to this task. You can’t make changes",
                            };
                        }
                        case "PermissionGranted": {
                            if (hasTaskCollectionAccessLevel(access.level, "Edit")) return null;

                            // TODO(calebmer): If the user removed their own access by removing a
                            // collection or changing the assignee, we should hint to them that they're
                            // allowed to undo and give them an undo button.
                            return {
                                icon: <PencilSimpleSlash />,
                                message: "You’re aren’t allowed to make changes to this task",
                            };
                        }
                        default:
                            throw exhaustive(access);
                    }
                }),
            [currentAccount.id, taskSubscription],
        ),
    );

    const isReadOnly = readOnlyReason !== null;

    const {
        modals: childrenGridViewModals,
        itemCount: childrenGridViewItemCount,
        renderItem: renderChildrenGridViewItem,
        onRenderedRangeChange: onChildrenGridViewRenderedRangeChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderChildrenGridViewItemIndexes,
        insetScrollbarItemIndex: insetScrollbarChildrenGridViewItemIndex,
        focusStart: focusChildrenGridViewStart,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                isReadOnly,
                hasParentTaskTitle: false,
                hasMultilineTitle: true,
                hasDenseFields: true,
                hasColumns: false,
            }),
            [isReadOnly],
        ),
        query: childrenQuery,
        initialExpansionState: initialChildrenGridViewExpansionState,
        initialBottomGhostTaskId,
        viewRef: childrenGridViewRef,
        getMoveTaskToQueryActions: (taskId, position) => {
            const time1 = store.clock.now();
            const time2 = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskSubscription.taskId,
                    },
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
                time: store.clock.now(),
                taskId,
                taskAction: {type: "UpdateParentTaskId", parentTaskId: null},
            },
        ],
    });

    return (
        <TaskGridViewDndContext store={store}>
            {childrenGridViewModals}
            <VirtualizedScrollView
                ref={viewRef}
                bufferedItemHeight={spacing[taskRowViewMinHeight]}
                itemCount={hasSubtasks ? childrenGridViewItemCount + 1 : 1}
                alwaysRenderAdditionalItemIndexes={useMemo(
                    () => alwaysRenderChildrenGridViewItemIndexes.map(index => index + 1),
                    [alwaysRenderChildrenGridViewItemIndexes],
                )}
                insetScrollbarItemIndex={
                    insetScrollbarChildrenGridViewItemIndex !== undefined
                        ? insetScrollbarChildrenGridViewItemIndex + 1
                        : undefined
                }
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
                                minHeight: "21.75rem",
                                node: (
                                    <TaskDetailViewMain
                                        taskSubscription={taskSubscription}
                                        initialNotesVersion={initialNotesVersion}
                                        initialNotesContent={initialNotesContent}
                                        hasSubtasks={hasSubtasks}
                                        readOnlyReason={readOnlyReason}
                                        focusChildrenGridViewStart={focusChildrenGridViewStart}
                                    />
                                ),
                            };
                        }

                        return renderChildrenGridViewItem(index - 1);
                    },
                    [
                        focusChildrenGridViewStart,
                        initialNotesContent,
                        initialNotesVersion,
                        hasSubtasks,
                        readOnlyReason,
                        renderChildrenGridViewItem,
                        taskSubscription,
                    ],
                )}
                onRenderedRangeChange={range => {
                    onChildrenGridViewRenderedRangeChange(
                        shiftRenderedRangeForChildrenGridView(range),
                    );
                }}
            />
        </TaskGridViewDndContext>
    );
}

function TaskDetailViewMain({
    taskSubscription,
    initialNotesVersion,
    initialNotesContent,
    hasSubtasks,
    readOnlyReason,
    focusChildrenGridViewStart,
}: {
    taskSubscription: TaskClientTaskSubscription;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
    hasSubtasks: boolean;
    readOnlyReason: {icon: ReactNode; message: string} | null;
    focusChildrenGridViewStart: () => void;
}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const isReadOnly = readOnlyReason !== null;

    const {store, taskId, taskEntryStore} = taskSubscription;
    const {task} = useStore(taskEntryStore);
    const assigneeAccountStore = task ? store.getTaskAssigneeAccountStore(task) : null;
    const assigneeAccountData = useStore(assigneeAccountStore);
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
                    store.getTaskUpdateTitleActionTransactionBuilder(taskId, titleUpdate);
            }
            return;
        }

        const time = store.clock.now();

        const commitPromise = store.commitTaskActionTransaction(context, [
            {
                type: "UpdateTask",
                time,
                taskId,
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

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

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
        }

        if (!isReadOnly) {
            if (task) {
                contextMenuActions.push(
                    getTaskStatusMenuActions({
                        context,
                        timeZone,
                        currentAccount,
                        store,
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

            contextMenuActions.push([
                {
                    label: "Delete",
                    onPress: () => {
                        setTaskDeleteConfirmationState({
                            taskId,
                            onAfterDelete: () => {
                                // If the task is open in a peek this will close the peek.
                                void navigate(-1);
                            },
                        });
                    },
                },
            ]);
        }

        return contextMenuActions;
    })();

    return (
        <>
            {readOnlyReason && (
                // TODO(calebmer): This should really be a sticky header. We should probably
                // have a sticky header for the task title too.
                <Box
                    className={invertSelectionColorsClassName}
                    height="8"
                    paddingX="2"
                    color="grey-0"
                    backgroundColor={{light: "grey-80", dark: "grey-90"}}
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                >
                    <IconContext.Provider value={{color: "currentColor", size: spacing["4"]}}>
                        {readOnlyReason.icon}
                    </IconContext.Provider>
                    <Box userSelect="text">{readOnlyReason.message}</Box>
                </Box>
            )}
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
                            <TaskStatusButton
                                size="5"
                                store={store}
                                task={task}
                                isDisabled={isReadOnly}
                            />
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
                            isReadOnly={isReadOnly}
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
                    <TaskDetailViewDenseField label="Assignee">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <TaskAssigneeInput
                                isReadOnly={isReadOnly}
                                aria-labelledby={ariaLabelledBy}
                                assigneeAccountData={assigneeAccountData}
                                onAssigneeAccountChange={assigneeAccount => {
                                    const time = store.clock.now();

                                    store.commitTaskActionTransaction(context, [
                                        {
                                            type: "UpdateTask",
                                            time,
                                            taskId,
                                            taskAction: {
                                                type: "UpdateAssignee",
                                                assignee: assigneeAccount
                                                    ? {
                                                          assigneeId: assigneeAccount.id,
                                                          assignerId: currentAccount.id,
                                                          assignedTime: new TaskFilterableTime({
                                                              absoluteTime: time,
                                                              setterTimeZone: timeZone,
                                                          }),
                                                      }
                                                    : null,
                                            },
                                        },
                                    ]);
                                }}
                            />
                        )}
                    </TaskDetailViewDenseField>
                    <TaskDetailViewDenseField label="Collections">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <TaskCollectionsInput
                                referencesSubscription={taskSubscription}
                                task={task}
                                aria-labelledby={ariaLabelledBy}
                                isReadOnly={isReadOnly}
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
                                            if (priorityInputState.isFocused)
                                                return priorityInputState;
                                            return {...priorityInputState, isFocused: true};
                                        });
                                    }}
                                    onBlur={event => {
                                        // If focus is moving within the element, don't unfocus.
                                        if (event.currentTarget.contains(event.relatedTarget))
                                            return;

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
                                        isReadOnly={isReadOnly}
                                        priority={priority}
                                        onPriorityChange={priority => {
                                            store.commitTaskActionTransaction(context, [
                                                {
                                                    type: "UpdateTask",
                                                    time: store.clock.now(),
                                                    taskId,
                                                    taskAction: {
                                                        type: "UpdatePriority",
                                                        priority,
                                                    },
                                                },
                                            ]);
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
                                            if (!dueDateInputState.isVisible)
                                                return dueDateInputState;
                                            if (dueDateInputState.isFocused)
                                                return dueDateInputState;
                                            return {...dueDateInputState, isFocused: true};
                                        });
                                    }}
                                    onBlur={event => {
                                        // If focus is moving within the element, don't unfocus.
                                        if (event.currentTarget.contains(event.relatedTarget))
                                            return;

                                        setDueDateInputState(dueDateInputState => {
                                            if (!dueDateInputState.isVisible)
                                                return dueDateInputState;
                                            if (!dueDateInputState.isFocused)
                                                return dueDateInputState;
                                            return {...dueDateInputState, isFocused: false};
                                        });
                                    }}
                                >
                                    <TaskDateInput
                                        isReadOnly={isReadOnly}
                                        date={dueDate}
                                        onDateChange={dueDate => {
                                            store.commitTaskActionTransaction(context, [
                                                {
                                                    type: "UpdateTask",
                                                    time: store.clock.now(),
                                                    taskId,
                                                    taskAction: {
                                                        type: "UpdateDueDate",
                                                        dueDate,
                                                    },
                                                },
                                            ]);
                                        }}
                                        shouldIncludeCalendarIcon={true}
                                        shouldWarnIfAfterDate={
                                            task?.getDisplayStatus() !== "Closed"
                                        }
                                        shouldFormatAroundToday={true}
                                        aria-labelledby={ariaLabelledBy}
                                    />
                                </Box>
                            )}
                        </TaskDetailViewDenseField>
                    )}
                </Box>
                <Spacer space="8" />
                <TaskDetailNotesField
                    taskId={taskId}
                    initialNotesVersion={initialNotesVersion}
                    initialNotesContent={initialNotesContent}
                    isReadOnly={isReadOnly}
                    padding={padding}
                />
                {hasSubtasks && (
                    <>
                        <Spacer space="8" />
                        <Box>
                            <span
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
                                            {task.getClosedChildTaskCount()}/
                                            {task.getChildTaskCount()}
                                        </Box>
                                    </Box>
                                )}
                            </span>
                        </Box>
                    </>
                )}
            </Box>
            {taskDeleteConfirmationState && (
                <TaskDeleteConfirmationModalDialog
                    store={store}
                    taskId={taskDeleteConfirmationState.taskId}
                    onClose={() => setTaskDeleteConfirmationState(null)}
                    onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
                />
            )}
        </>
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
            <span
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
            </span>
            <Box ref={valueRef}>
                {typeof children === "function" ? children({"aria-labelledby": labelId}) : children}
            </Box>
        </>
    );
}

// NOTE(calebmer): The `<PencilSimpleSlash>` icon is in Phosphor v2. Upgrading
// to v2 looks difficult so for now, inlining the SVG.
function PencilSimpleSlash({
    color,
    size,
    style,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
}) {
    const {
        color: contextColor,
        size: contextSize,
        weight,
        mirrored,
        ...context
    } = useContext(IconContext);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill={color ?? contextColor}
            viewBox="0 0 256 256"
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <path d="M53.92 34.62a8 8 0 1 0-11.84 10.76l48.2 53L36.68 152A15.89 15.89 0 0 0 32 163.31V208a16 16 0 0 0 16 16h44.69a15.86 15.86 0 0 0 11.31-4.69l50.4-50.39 47.69 52.46a8 8 0 1 0 11.84-10.76ZM92.69 208H48v-44.69l53.06-53 42.56 46.81ZM227.32 73.37l-44.69-44.68a16 16 0 0 0-22.63 0l-41.67 41.67a8 8 0 0 0 11.32 11.31l6.35-6.36L180.69 120l-9 9A8 8 0 0 0 183 140.34L227.32 96a16 16 0 0 0 0-22.63ZM192 108.69 147.32 64l24-24L216 84.69Z" />
        </svg>
    );
}
