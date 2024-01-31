import {setInteractionModality} from "@react-aria/interactions";
import {CaretLeft, CaretRight, DotsThree, IconContext, Lock, Trash} from "phosphor-react";
import {redo, undo} from "prosemirror-history";
import {
    Memo,
    ReactNode,
    Ref,
    SetStateAction,
    forwardRef,
    memo,
    useCallback,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/use_navigation_bar.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    computeTaskEntryAccess,
    createTaskEntryAccessStore,
} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActionsWithoutFullTask} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {PencilSimpleSlash} from "~/client/tasks/internal/pencil_simple_slash.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/internal/task_assignee_input.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {
    TaskCollectionsInput,
    TaskCollectionsInputRef,
} from "~/client/tasks/internal/task_collections_input.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {
    TaskDetailNotesField,
    TaskDetailNotesFieldRef,
} from "~/client/tasks/internal/task_detail_notes_field.js";
import {
    TaskDetailTitleInput,
    TaskDetailTitleInputRef,
} from "~/client/tasks/internal/task_detail_title_input.js";
import {TaskPriorityInput} from "~/client/tasks/internal/task_priority_input.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/use_task_grid_view_virtualized_list.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStoreSearchEntityAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Context} from "~/shared/context/context.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {invertSelectionColorsClassName, sprinkles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {emptyTaskTitleModel, taskFallbackTitle} from "~/shared/tasks/model/task_title_model.js";
import {hasTaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export const taskDetailViewMaxWidth: Spacing = "160";
const taskDetailViewPaddingTop: Spacing = "5";

export function TaskDetailView({
    taskSubscription,
    childrenQuery,
    affinityManager,
    initialChildrenGridViewExpansionState,
    initialBottomGhostTaskId,
    initialNotesVersion,
    initialNotesContent,
}: {
    taskSubscription: TaskClientTaskSubscription;
    childrenQuery: TaskClientQuery;
    affinityManager: TaskClientStoreSearchEntityAffinityManager;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialBottomGhostTaskId: TaskId;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
}) {
    const navigate = useNavigate();
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const isMobile = useIsMobile();
    const {
        space: {id: spaceId},
        currentAccount,
    } = useSpaceContext();
    const {store, taskId, taskEntryStore} = taskSubscription;

    const mainRef = useRef<TaskDetailViewMainRef>(null);

    const showSubtasks = useStore(
        useMemo(
            () => taskSubscription.taskEntryStore.map(({task}) => !task?.isDeleted()),
            [taskSubscription.taskEntryStore],
        ),
    );

    const readOnlyReason = useStore(
        useMemo(
            () =>
                createTaskEntryAccessStore(
                    currentAccount.id,
                    taskSubscription,
                    taskSubscription.taskEntryStore,
                ).map(access => {
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
            scrollToIndex: (index, options) =>
                assertExists(viewRef.current).scrollToIndex(index + 1, options),
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
            getPositionByKeyIfExists: key =>
                assertExists(viewRef.current).getPositionByKeyIfExists(key),
            peekRenderedRangeAfterSetScrollOffset: scrollOffset =>
                shiftRenderedRangeForChildrenGridView(
                    assertExists(viewRef.current).peekRenderedRangeAfterSetScrollOffset(
                        scrollOffset,
                    ),
                ),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getItemElementByKeyIfExists: key =>
                assertExists(viewRef.current).getItemElementByKeyIfExists(key),
        }),
        [shiftRenderedRangeForChildrenGridView],
    );

    const {
        stateKey: childrenGridViewStateKey,
        bufferedItemHeight: childrenGridViewBufferedItemHeight,
        modals: childrenGridViewModals,
        itemCount: childrenGridViewItemCount,
        renderItem: renderChildrenGridViewItem,
        onRenderedRangeChange: onChildrenGridViewRenderedRangeChange,
        onRenderedRangeLayoutChange: onChildrenGridViewRenderedRangeLayoutChange,
        alwaysRenderAdditionalItemIndexes: alwaysRenderChildrenGridViewItemIndexes,
        scrollbarInsetTopItemIndex: scrollbarInsetTopChildrenGridViewItemIndex,
        onGlobalKeyDown: onChildrenGridViewGlobalKeyDown,
        focusStart: focusChildrenGridViewStart,
        // We use the grid view's undo stack as our full task detail view undo stack.
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
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
        store,
        query: {
            query: childrenQuery,
            initialGridViewExpansionState: initialChildrenGridViewExpansionState,
            initialBottomGhostTaskId,
        },
        affinityManager,
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
        onApplyUndoStackEntry: ({type, target, entry, undoManager}) => {
            if (target.taskId !== taskSubscription.taskId) return false;

            switch (entry.type) {
                case "Actions": {
                    store.commitTaskActionTransaction(context, entry.undoActions.get(store.clock), {
                        undoManager,
                        affinityManager,
                        leaseId: entry.leaseId,
                    });
                    break;
                }
                case "YDoc": {
                    if (type === "Undo") {
                        entry.yUndoManager.undo();
                    } else {
                        entry.yUndoManager.redo();
                    }
                    break;
                }
                case "Notes": {
                    const contentEditor = entry.contentEditorRef.current;

                    // If the content editor has unmounted, we can't handle this entry.
                    if (!contentEditor) return false;

                    if (type === "Undo") {
                        contentEditor.dispatchCommand(undo);
                    } else {
                        contentEditor.dispatchCommand(redo);
                    }
                    break;
                }
                default:
                    throw exhaustive(entry);
            }

            assertExists(viewRef.current).scrollToIndex(0, {withAnchor: false});

            // Make sure we render focus rings!
            setInteractionModality("keyboard");

            if (entry.type === "Notes") {
                assertExists(mainRef.current).focusNotesInput();
            } else {
                switch (target.column) {
                    // No such thing in detail view. Isn't really picked as an undo target anyway.
                    case "ExpandButton":
                        break;

                    case "StatusButton": {
                        assertExists(mainRef.current).focusStatusButton();
                        break;
                    }
                    case "Title": {
                        assertExists(mainRef.current).focusTitleInput();
                        break;
                    }
                    case "Assignee": {
                        assertExists(mainRef.current).focusAssigneeInput();
                        break;
                    }
                    case "Priority": {
                        focusPriorityInput({preventScroll: false});
                        break;
                    }
                    case "DueDate": {
                        focusDueDateInput({preventScroll: false});
                        break;
                    }
                    case "Collections": {
                        assertExists(mainRef.current).focusCollectionsInput();
                        break;
                    }
                    default:
                        throw exhaustive(target.column);
                }
            }

            return true;
        },
    });

    const displayStatus = useStore(
        useMemo(
            () => taskEntryStore.map(({task}) => task?.getDisplayStatus() ?? "OpenInactive"),
            [taskEntryStore],
        ),
    );
    const isPriorityDefined = useStore(
        useMemo(() => taskEntryStore.map(({task}) => !!task?.getPriority()), [taskEntryStore]),
    );
    const isDueDateDefined = useStore(
        useMemo(() => taskEntryStore.map(({task}) => !!task?.getDueDate()), [taskEntryStore]),
    );

    const priorityInputRef = useRef<HTMLDivElement>(null);
    const dueDateInputRef = useRef<HTMLDivElement>(null);

    const [priorityInputState, setPriorityInputState] = useState<TaskDetailViewInputState>(
        isPriorityDefined
            ? initialVisibleTaskDetailViewInputState
            : initialNotVisibleTaskDetailViewInputState,
    );

    if (
        priorityInputState.isVisible &&
        !priorityInputState.isFocused &&
        !priorityInputState.shouldFocus &&
        !isPriorityDefined
    ) {
        // In task row dense fields we hide the priority field when the value is set to
        // null. But since the user may actively be editing the field in detail view,
        // keep it around.
    }

    if (!priorityInputState.isVisible && isPriorityDefined) {
        setPriorityInputState(initialVisibleTaskDetailViewInputState);
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (priorityInputState.isVisible && priorityInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(priorityInputRef.current),
                }),
            ).focus({preventScroll: priorityInputState.shouldFocusPreventScroll});

            setPriorityInputState(priorityInputState => {
                if (!priorityInputState.isVisible) return priorityInputState;
                return {...priorityInputState, shouldFocus: false, shouldFocusPreventScroll: false};
            });
        }
    }, [priorityInputState]);

    const [dueDateInputState, setDueDateInputState] = useState<TaskDetailViewInputState>(
        isDueDateDefined
            ? initialVisibleTaskDetailViewInputState
            : initialNotVisibleTaskDetailViewInputState,
    );

    if (
        dueDateInputState.isVisible &&
        !dueDateInputState.isFocused &&
        !dueDateInputState.shouldFocus &&
        !isDueDateDefined
    ) {
        // In task row dense fields we hide the due date field when the value is set to
        // null. But since the user may actively be editing the field in detail view,
        // keep it around.
    }

    if (!dueDateInputState.isVisible && isDueDateDefined) {
        setDueDateInputState(initialVisibleTaskDetailViewInputState);
    }

    useLayoutEffectWithoutServerSideWarning(() => {
        if (dueDateInputState.isVisible && dueDateInputState.shouldFocus) {
            assertExists(
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(dueDateInputRef.current),
                }),
            ).focus({preventScroll: dueDateInputState.shouldFocusPreventScroll});

            setDueDateInputState(dueDateInputState => {
                if (!dueDateInputState.isVisible) return dueDateInputState;
                return {...dueDateInputState, shouldFocus: false, shouldFocusPreventScroll: false};
            });
        }
    }, [dueDateInputState]);

    const {focusPriorityInput, focusDueDateInput} = useEvents({
        focusPriorityInput: ({preventScroll}: {preventScroll: boolean}) => {
            if (priorityInputState.isVisible) {
                assertExists(
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(priorityInputRef.current),
                    }),
                ).focus({preventScroll});
            } else {
                setPriorityInputState({
                    isVisible: true,
                    shouldFocus: true,
                    shouldFocusPreventScroll: preventScroll,
                    isFocused: false,
                });
            }
        },
        focusDueDateInput: ({preventScroll}: {preventScroll: boolean}) => {
            if (dueDateInputState.isVisible) {
                assertExists(
                    getNextFocusableElementIfExists(null, {
                        withinElement: assertExists(dueDateInputRef.current),
                    }),
                ).focus({preventScroll});
            } else {
                setDueDateInputState({
                    isVisible: true,
                    shouldFocus: true,
                    shouldFocusPreventScroll: preventScroll,
                    isFocused: false,
                });
            }
        },
    });

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

    const undoManager: TaskClientStoreUndoManager = useMemo(
        () => ({
            pushUndoStackEntry: ({undoActions, removedFromQueries, leaseId, release}) => {
                pushUndoStackEntry({
                    type: "Actions",
                    rootParentTaskId: taskId,
                    undoActions,
                    removedFromQueries,
                    leaseId,
                    release,
                });
            },
        }),
        [pushUndoStackEntry, taskId],
    );

    const contextMenuActions = useMemo(() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        contextMenuActions.push([
            {
                label: "Copy link",
                pressErrorTitle: "Couldn’t copy task link",
                onPress: async () => {
                    const url = new URL(`/s/${spaceId}/tasks/${taskId}`, window.location.href);
                    await writeTextToClipboard(url.toString());
                },
            },
        ]);

        if (!isReadOnly) {
            contextMenuActions.push(
                getTaskStatusMenuActionsWithoutFullTask({
                    context,
                    timeZone,
                    currentAccount,
                    store,
                    undoManager,
                    affinityManager,
                    taskId,
                    displayStatus,
                    getAssigneeSnapshot: () =>
                        taskEntryStore.getSnapshot().task?.getAssignee() ?? null,
                }),
            );

            contextMenuActions.push([
                {
                    label: priorityInputState.isVisible ? "Edit priority" : "Add priority",
                    onPress: () => focusPriorityInput({preventScroll: false}),
                },
                {
                    label: dueDateInputState.isVisible ? "Edit due date" : "Add due date",
                    onPress: () => focusDueDateInput({preventScroll: false}),
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
    }, [
        affinityManager,
        context,
        currentAccount,
        displayStatus,
        dueDateInputState.isVisible,
        focusDueDateInput,
        focusPriorityInput,
        isReadOnly,
        navigate,
        priorityInputState.isVisible,
        spaceId,
        store,
        taskEntryStore,
        taskId,
        timeZone,
        undoManager,
    ]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        left: isMobile && (
            <IconButton
                size="base"
                description="Back"
                withoutTooltip={true}
                onPress={() => navigate(-1)}
            >
                <CaretLeft />
            </IconButton>
        ),
        right: (
            <MenuButton actions={contextMenuActions}>
                <IconButton
                    size={isMobile ? "base" : "md"}
                    description="More"
                    withoutTooltip={true}
                >
                    <DotsThree />
                </IconButton>
            </MenuButton>
        ),
    });

    return (
        <>
            {childrenGridViewModals}
            <GlobalKeyDownEvent onGlobalKeyDown={onChildrenGridViewGlobalKeyDown}>
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    scrollbarInsetTop={scrollbarInsetTop}
                    stateKey={childrenGridViewStateKey}
                    bufferedItemHeight={childrenGridViewBufferedItemHeight}
                    itemCount={showSubtasks ? childrenGridViewItemCount + 1 : 1}
                    alwaysRenderAdditionalItemIndexes={useMemo(
                        () => [
                            // Always render `<TaskDetailViewMain>` regardless of where we've scrolled.
                            // We can return focus there at any moment.
                            0,
                            ...alwaysRenderChildrenGridViewItemIndexes.map(index => index + 1),
                        ],
                        [alwaysRenderChildrenGridViewItemIndexes],
                    )}
                    scrollbarInsetTopItemIndex={
                        scrollbarInsetTopChildrenGridViewItemIndex !== undefined
                            ? scrollbarInsetTopChildrenGridViewItemIndex + 1
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
                                        <TaskDetailViewMainMemo
                                            ref={mainRef}
                                            taskSubscription={taskSubscription}
                                            undoManager={undoManager}
                                            affinityManager={affinityManager}
                                            initialNotesVersion={initialNotesVersion}
                                            initialNotesContent={initialNotesContent}
                                            showSubtasks={showSubtasks}
                                            readOnlyReason={readOnlyReason}
                                            focusChildrenGridViewStart={focusChildrenGridViewStart}
                                            pushUndoStackEntry={pushUndoStackEntry}
                                            pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                                            pushRedoStackEntry={pushRedoStackEntry}
                                            contextMenuActions={contextMenuActions}
                                            priorityInputRef={priorityInputRef}
                                            isPriorityInputVisible={priorityInputState.isVisible}
                                            setPriorityInputState={setPriorityInputState}
                                            focusPriorityInput={focusPriorityInput}
                                            dueDateInputRef={dueDateInputRef}
                                            isDueDateInputVisible={dueDateInputState.isVisible}
                                            setDueDateInputState={setDueDateInputState}
                                            focusDueDateInput={focusDueDateInput}
                                        />
                                    ),
                                };
                            }

                            return renderChildrenGridViewItem(index - 1);
                        },
                        [
                            renderChildrenGridViewItem,
                            taskSubscription,
                            undoManager,
                            affinityManager,
                            initialNotesVersion,
                            initialNotesContent,
                            showSubtasks,
                            readOnlyReason,
                            focusChildrenGridViewStart,
                            pushUndoStackEntry,
                            pushUndoStackEntryFromRedo,
                            pushRedoStackEntry,
                            contextMenuActions,
                            priorityInputState.isVisible,
                            focusPriorityInput,
                            dueDateInputState.isVisible,
                            focusDueDateInput,
                        ],
                    )}
                    onRenderedRangeChange={range => {
                        onChildrenGridViewRenderedRangeChange(
                            shiftRenderedRangeForChildrenGridView(range),
                        );
                    }}
                    onRenderedRangeLayoutChange={range => {
                        onChildrenGridViewRenderedRangeLayoutChange(
                            shiftRenderedRangeForChildrenGridView(range),
                        );
                    }}
                    extraChildren={navigationBar}
                />
            </GlobalKeyDownEvent>
            {taskDeleteConfirmationState && (
                <TaskDeleteConfirmationModalDialog
                    store={store}
                    undoManager={undoManager}
                    taskId={taskDeleteConfirmationState.taskId}
                    onClose={() => setTaskDeleteConfirmationState(null)}
                    onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
                />
            )}
        </>
    );
}

type TaskDetailViewInputState =
    | {readonly isVisible: false}
    | {
          readonly isVisible: true;
          readonly shouldFocus: true;
          readonly shouldFocusPreventScroll: boolean;
          readonly isFocused: false;
      }
    | {
          readonly isVisible: true;
          readonly shouldFocus: false;
          readonly shouldFocusPreventScroll: false;
          readonly isFocused: boolean;
      };

const initialNotVisibleTaskDetailViewInputState: TaskDetailViewInputState = {
    isVisible: false,
};

const initialVisibleTaskDetailViewInputState: TaskDetailViewInputState = {
    isVisible: true,
    shouldFocus: false,
    shouldFocusPreventScroll: false,
    isFocused: false,
};

type TaskDetailViewMainRef = {
    focusStatusButton(): void;
    focusTitleInput(): void;
    focusAssigneeInput(): void;
    focusCollectionsInput(): void;
    focusNotesInput(): void;
};

const TaskDetailViewMainMemo = memo(forwardRef(TaskDetailViewMain));

function TaskDetailViewMain(
    {
        taskSubscription,
        undoManager,
        affinityManager,
        initialNotesVersion,
        initialNotesContent,
        showSubtasks,
        readOnlyReason,
        focusChildrenGridViewStart,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        contextMenuActions,
        priorityInputRef,
        isPriorityInputVisible,
        setPriorityInputState,
        focusPriorityInput,
        dueDateInputRef,
        isDueDateInputVisible,
        setDueDateInputState,
        focusDueDateInput,
    }: {
        taskSubscription: TaskClientTaskSubscription;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchEntityAffinityManager;
        initialNotesVersion: number;
        initialNotesContent: TaskNotesContentWithReferences;
        showSubtasks: boolean;
        readOnlyReason: Memo<{icon: ReactNode; message: string}> | null;
        focusChildrenGridViewStart: Memo<() => void>;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        contextMenuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
        priorityInputRef: Ref<HTMLDivElement>;
        isPriorityInputVisible: boolean;
        setPriorityInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusPriorityInput: Memo<(options: {preventScroll: boolean}) => void>;
        dueDateInputRef: Ref<HTMLDivElement>;
        isDueDateInputVisible: boolean;
        setDueDateInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusDueDateInput: Memo<(options: {preventScroll: boolean}) => void>;
    },
    ref: Ref<TaskDetailViewMainRef>,
) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const paddingX: Spacing = isMobile ? "4" : "5";

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
                    store.getTaskUpdateTitleActionTransactionBuilder(taskId, titleUpdate, {
                        affinityManager,
                    });
            }
            return;
        }

        const time = store.clock.now();

        const commitPromise = store.commitTaskActionTransaction(
            context,
            [
                {
                    type: "UpdateTask",
                    time,
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                },
            ],
            {undoManager, affinityManager},
        );

        handleCommitPromise(commitPromise);
    };

    // Naming nit: An "input" is some editable component without a label. A "field"
    // is the combination of both a label and an input.
    const statusButtonRef = useRef<HTMLElement>(null);
    const titleInputRef = useRef<TaskDetailTitleInputRef>(null);
    const assigneeInputRef = useRef<TaskAssigneeInputRef>(null);
    const collectionsInputRef = useRef<TaskCollectionsInputRef>(null);
    const notesFieldRef = useRef<TaskDetailNotesFieldRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            focusStatusButton: () => {
                assertExists(statusButtonRef.current).focus();
            },
            focusTitleInput: () => {
                const titleInput = assertExists(titleInputRef.current);
                if (!titleInput.isFocused()) {
                    titleInput.focusAll();
                }
            },
            focusAssigneeInput: () => {
                assertExists(assigneeInputRef.current).focus();
            },
            focusCollectionsInput: () => {
                const collectionsInput = assertExists(collectionsInputRef.current);
                if (!collectionsInput.isFocusWithin()) {
                    collectionsInput.focusStart();
                }
            },
            focusPriorityInput,
            focusDueDateInput,
            focusNotesInput: () => {
                const notesField = assertExists(notesFieldRef.current);
                if (!notesField.isFocused()) {
                    notesField.focus();
                }
            },
        }),
        [focusDueDateInput, focusPriorityInput],
    );

    return (
        <>
            {isMobile && (
                // NOCOMMIT: How does this look with the read-only bar?
                <Box style={{height: "var(--safe-area-inset-top)"}} />
            )}
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
                data-testid="TaskDetailViewMain"
                width="full"
                overflow="hidden"
                maxWidth={taskDetailViewMaxWidth}
                display="flex"
                flexDirection="column"
                position="relative"
            >
                {isMobile && (
                    // On mobile, create some space for the navigation bar since it's back button
                    // will conflict with the status button.
                    <Spacer space={navigationBarHeight} />
                )}
                <ContextMenuActions actions={contextMenuActions}>
                    <Box
                        paddingTop={taskDetailViewPaddingTop}
                        paddingBottom="8"
                        paddingX={paddingX}
                        display="flex"
                        flexDirection="column"
                        gap="3"
                    >
                        {task ? (
                            <TaskStatusButton
                                ref={statusButtonRef}
                                size={isMobile ? "7" : "5"}
                                store={store}
                                undoManager={undoManager}
                                affinityManager={affinityManager}
                                task={task}
                                isDisabled={isReadOnly}
                            />
                        ) : (
                            <Box
                                ref={statusButtonRef as Ref<HTMLDivElement>}
                                width={isMobile ? "7" : "5"}
                                height={isMobile ? "7" : "5"}
                                borderRadius="full"
                                border="grey-10"
                                pointerEvents="none"
                            />
                        )}
                        <Box>
                            <TaskDetailViewParentBreadcrumbs
                                task={task}
                                taskSubscription={taskSubscription}
                            />
                            <TaskDetailTitleInput
                                ref={titleInputRef}
                                isReadOnly={isReadOnly}
                                title={task?.getTitle() ?? emptyTaskTitleModel.get()}
                                onTitleChange={onTitleChange}
                                placeholder={taskFallbackTitle}
                                pushUndoStackYDocEntry={entry => {
                                    pushUndoStackEntry({
                                        type: "YDoc",
                                        rootParentTaskId: taskId,
                                        taskId,
                                        yUndoManager: entry.yUndoManager,
                                        release: entry.release,
                                    });
                                }}
                                pushUndoStackYDocEntryFromRedo={entry => {
                                    pushUndoStackEntryFromRedo({
                                        type: "YDoc",
                                        rootParentTaskId: taskId,
                                        taskId,
                                        yUndoManager: entry.yUndoManager,
                                        release: entry.release,
                                    });
                                }}
                                pushRedoStackYDocEntry={entry => {
                                    pushRedoStackEntry({
                                        type: "YDoc",
                                        rootParentTaskId: taskId,
                                        taskId,
                                        yUndoManager: entry.yUndoManager,
                                        release: entry.release,
                                    });
                                }}
                            />
                        </Box>
                    </Box>
                </ContextMenuActions>
                <Box
                    paddingX={paddingX}
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
                                ref={assigneeInputRef}
                                isReadOnly={isReadOnly}
                                aria-labelledby={ariaLabelledBy}
                                assigneeAccountData={assigneeAccountData}
                                onAssigneeAccountChange={assigneeAccount => {
                                    const time = store.clock.now();

                                    store.commitTaskActionTransaction(
                                        context,
                                        [
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
                                        ],
                                        {undoManager, affinityManager},
                                    );
                                }}
                            />
                        )}
                    </TaskDetailViewDenseField>
                    <TaskDetailViewDenseField label="Collections">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <TaskCollectionsInput
                                ref={collectionsInputRef}
                                referencesSubscription={taskSubscription}
                                undoManager={undoManager}
                                affinityManager={affinityManager}
                                task={task}
                                aria-labelledby={ariaLabelledBy}
                                isReadOnly={isReadOnly}
                                shouldAlignWithDetailViewInputsIfEmpty={true}
                            />
                        )}
                    </TaskDetailViewDenseField>
                    {isPriorityInputVisible && (
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

                                            return {
                                                ...priorityInputState,
                                                isFocused: true,
                                                shouldFocus: false,
                                                shouldFocusPreventScroll: false,
                                            };
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
                                        // If a task is closed, suppress the urgent warning.
                                        shouldHighlightUrgent={
                                            task?.getDisplayStatus() !== "Closed"
                                        }
                                        priority={priority}
                                        onPriorityChange={priority => {
                                            store.commitTaskActionTransaction(
                                                context,
                                                [
                                                    {
                                                        type: "UpdateTask",
                                                        time: store.clock.now(),
                                                        taskId,
                                                        taskAction: {
                                                            type: "UpdatePriority",
                                                            priority,
                                                        },
                                                    },
                                                ],
                                                {undoManager, affinityManager},
                                            );
                                        }}
                                        aria-labelledby={ariaLabelledBy}
                                    />
                                </Box>
                            )}
                        </TaskDetailViewDenseField>
                    )}
                    {isDueDateInputVisible && (
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

                                            return {
                                                ...dueDateInputState,
                                                isFocused: true,
                                                shouldFocus: false,
                                                shouldFocusPreventScroll: false,
                                            };
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
                                            store.commitTaskActionTransaction(
                                                context,
                                                [
                                                    {
                                                        type: "UpdateTask",
                                                        time: store.clock.now(),
                                                        taskId,
                                                        taskAction: {
                                                            type: "UpdateDueDate",
                                                            dueDate,
                                                        },
                                                    },
                                                ],
                                                {undoManager, affinityManager},
                                            );
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
                    ref={notesFieldRef}
                    taskId={taskId}
                    initialNotesVersion={initialNotesVersion}
                    initialNotesContent={initialNotesContent}
                    isReadOnly={isReadOnly}
                    paddingX={paddingX}
                    pushUndoStackEntry={pushUndoStackEntry}
                    pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                    pushRedoStackEntry={pushRedoStackEntry}
                />
                {showSubtasks ? (
                    <>
                        <Spacer space="8" />
                        <Box>
                            <span
                                className={sprinkles({
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "3",
                                    paddingX: paddingX,
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
                ) : (
                    <Box
                        width="full"
                        height="5"
                        pointerEvents="none"
                        style={{
                            height: isMobile
                                ? `calc(var(--safe-area-inset-bottom, 0px) + ${spacing["5"]})`
                                : undefined,
                        }}
                    />
                )}
            </Box>
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

function TaskDetailViewParentBreadcrumbs({
    task,
    taskSubscription,
}: {
    task: TaskModel | null;
    taskSubscription: TaskClientTaskSubscription;
}) {
    const navigate = useNavigate();
    const {currentAccount} = useSpaceContext();

    const nodeStore = useMemo(() => {
        return computeStore(get => {
            const parentNodes: Array<ReactNode> = [];

            let loopTask = task;
            while (loopTask !== null) {
                const parent = loopTask.getParent();
                if (parent === null) {
                    loopTask = null;
                    continue;
                }

                const parentTaskEntry = get(
                    taskSubscription.getReferencedTaskEntryStore(parent.taskId),
                );

                const parentAccess = computeTaskEntryAccess(
                    get,
                    currentAccount.id,
                    taskSubscription,
                    parentTaskEntry,
                );

                // Treat deleted parents as if they don't exist.
                if (parentAccess.type === "Deleted") {
                    loopTask = null;
                    continue;
                }

                // Null tasks are treated with a `PermissionDenied` access level.
                if (parentTaskEntry.task === null || parentAccess.type !== "PermissionGranted") {
                    parentNodes.push(
                        <Tooltip
                            key={parentTaskEntry.task?.id ?? "Private"}
                            content="You don’t have access to the task this is a subtask of"
                        >
                            <Box
                                color="grey-60"
                                height="5"
                                paddingX="1.5"
                                flexShrink="1"
                                display="flex"
                                alignItems="center"
                                gap="1"
                            >
                                <Lock size={spacing["3"]} />
                                <Box>Private</Box>
                            </Box>
                        </Tooltip>,
                    );

                    loopTask = null;
                    continue;
                }

                parentNodes.push(
                    <Button
                        key={parentTaskEntry.task.id}
                        variant="quieter"
                        height="5"
                        paddingX="1.5"
                        flexShrink="1"
                        pressErrorTitle="Couldn’t open task"
                        onPress={() =>
                            navigate(
                                `/s/${parentTaskEntry.task.getSpaceId()}/tasks/${
                                    parentTaskEntry.task.id
                                }`,
                            )
                        }
                    >
                        <span
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    parentTaskEntry.task.getTitle().getProsemirrorNode().content,
                                ),
                            }}
                        />
                    </Button>,
                );

                loopTask = parentTaskEntry.task;
                continue;
            }

            // If the task has no parents then don't render breadcrumbs UI.
            if (parentNodes.length === 0) return null;

            // We insert parent nodes at the end of the list but we want the top level
            // parent to appear first.
            parentNodes.reverse();

            return (
                <Box
                    width="full"
                    overflow="hidden"
                    marginX="-1.5"
                    paddingBottom="0.5"
                    color="grey-60"
                    display="flex"
                    alignItems="center"
                >
                    {interleaveArray(parentNodes, index => (
                        <CaretRight
                            key={index}
                            size={spacing["3"]}
                            className={sprinkles({flexShrink: "0"})}
                        />
                    ))}
                    <CaretRight size={spacing["3"]} className={sprinkles({flexShrink: "0"})} />
                </Box>
            );
        });
    }, [currentAccount.id, navigate, task, taskSubscription]);

    return useStore(nodeStore);
}
