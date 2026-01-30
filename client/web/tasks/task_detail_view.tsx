import {setInteractionModality} from "@react-aria/interactions";
import {CaretRight, ChatCircleDots, Link as LinkIcon, Lock} from "phosphor-react";
import {
    Memo,
    ReactElement,
    ReactNode,
    Ref,
    RefObject,
    SetStateAction,
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useTouchSlop} from "~/client/web/design/use_touch_slop.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskDetailViewDenseFieldGap,
    taskDetailViewDenseFieldMinHeight,
    taskDetailViewFieldLabelColor,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewMainMinHeightPx,
    taskDetailViewSectionGap,
    taskDetailViewStatusButtonMobilePaddingBottom,
    taskDetailViewStatusButtonMobilePaddingTop,
    taskDetailViewStatusButtonSize,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {
    TaskAccess,
    computeTaskEntryAccess,
} from "~/client/web/tasks/internal/create_task_entry_access_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActionsWithoutFullTask} from "~/client/web/tasks/internal/get_task_status_menu_actions.js";
import {showTaskDeleteConfirmationModalDialog} from "~/client/web/tasks/internal/show_task_delete_confirmation_modal_dialog.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/web/tasks/internal/task_assignee_input.js";
import {TaskChildTasksProgressWheel} from "~/client/web/tasks/internal/task_child_tasks_progress_wheel.js";
import {TaskCloseConfirmationModalDialog} from "~/client/web/tasks/internal/task_close_confirmation_modal_dialog.js";
import {
    TaskCollectionsInput,
    TaskCollectionsInputRef,
} from "~/client/web/tasks/internal/task_collections_input.js";
import {TaskDateInput} from "~/client/web/tasks/internal/task_date_input.js";
import {
    TaskDetailNotesField,
    TaskDetailNotesFieldRef,
} from "~/client/web/tasks/internal/task_detail_notes_field.js";
import {
    TaskDetailTitleInput,
    TaskDetailTitleInputRef,
} from "~/client/web/tasks/internal/task_detail_title_input.js";
import {useTaskGridViewVirtualizedList} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskPriorityInput} from "~/client/web/tasks/internal/task_priority_input.js";
import {TaskStatusButton} from "~/client/web/tasks/internal/task_status_button.js";
import {TaskUndoStackEntry} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {TaskNotesContentEditorState} from "~/client/web/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {Context} from "~/shared/context/context.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {
    TaskTitleUpdateModel,
    addFallbackToTaskTitle,
    emptyTaskTitleModel,
    taskFallbackTitle,
} from "~/shared/tasks/title/task_title.js";

export function TaskDetailView({
    taskId,
    store,
    taskAccess: access,
    taskSubscription,
    childrenQuery,
    initialChildrenGridViewExpansionState,
    initialFields,
    initialIsFavorite,
    notesEditorStateStore,
    onNotesEditorStateChange,
    reconnectNotesClient,
    affinityManager,
    shouldInitiallyFocus,
    showComments,
    onShowCommentsChange,
    commitActionTransactionAndCreateIfNeeded,
}: {
    taskId: TaskId;
    store: TaskClientStore;
    taskAccess: TaskAccess;
    taskSubscription: TaskClientTaskSubscription | null;
    childrenQuery: TaskClientQuery | null;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
    initialIsFavorite: boolean;
    notesEditorStateStore: Store<TaskNotesContentEditorState>;
    onNotesEditorStateChange: Memo<
        (state: ContentEditorState<TaskNotesContentWithReferences>) => void
    >;
    reconnectNotesClient: Memo<() => void>;
    affinityManager: TaskClientStoreSearchAffinityManager;
    shouldInitiallyFocus: boolean;
    showComments: boolean;
    onShowCommentsChange: Memo<(showComments: boolean) => void>;
    commitActionTransactionAndCreateIfNeeded: Memo<
        (
            getActions: () => Iterable<TaskActionModel>,
            options: {
                undoManager: TaskClientStoreUndoManager | null;
                affinityManager: TaskClientStoreSearchAffinityManager;
            },
        ) => {
            finally: (callback: () => void) => void;
        }
    >;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const platformRouteLayout = getPlatformRouteLayout(platform, routeLayout);
    const navigate = useNavigate();
    const context = useAppContext();
    const {timeZone, isAppleDevice} = useClientInfo();
    const reporter = useReporter();
    const {
        space: {id: spaceId},
        currentAccount,
    } = useSpaceContext();

    const mainRef = useRef<TaskDetailViewMainRef>(null);

    const hasEditAccessLevel = useMemo(() => hasAccessLevel(access.level, "Edit"), [access.level]);

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
            getElement: () => assertExists(viewRef.current).getElement(),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getElementByKeyIfExists: key =>
                assertExists(viewRef.current).getElementByKeyIfExists(key),
        }),
        [shiftRenderedRangeForChildrenGridView],
    );

    const {
        spacingScale,
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
        undo: undoWithoutMemo,
        redo: redoWithoutMemo,
        // We use the grid view's undo stack as our full task detail view undo stack.
        pushUndoStackEntry: pushUndoStackEntryWithoutMemo,
        pushUndoStackEntryFromRedo: pushUndoStackEntryFromRedoWithoutMemo,
        pushRedoStackEntry: pushRedoStackEntryWithoutMemo,
    } = useTaskGridViewVirtualizedList({
        capabilities: useMemo(
            () => ({
                isReadOnly: !hasEditAccessLevel,
                hasParentTaskTitle: false,
                hasMultilineTitle: true,
                hasDenseFields: true,
                hasColumns: false,
                withoutAssigneeField: false,
            }),
            [hasEditAccessLevel],
        ),
        store,

        // Even when `childrenQuery` is null we still want to show the bottom ghost
        // task. If the user starts to type in the bottom ghost task then
        // `commitActionTransaction` will be called which will create the task if
        // needed.
        //
        // We also need to provide our own `stateKey` that doesn't change when
        // `childrenQuery` switches between null and a proper value. That way our
        // subtasks, undo state, and grid view expansion state don't change when we
        // switch from `query: null` to the actual children query subscription.
        stateKey: taskId,
        query: childrenQuery
            ? {
                  query: childrenQuery,
                  initialGridViewExpansionState: initialChildrenGridViewExpansionState,
              }
            : null,
        withBottomGhostTaskIfNullQuery: !childrenQuery,
        commitActionTransaction: !childrenQuery ? commitActionTransactionAndCreateIfNeeded : null,

        affinityManager,
        rowMaxWidth: contentStyles.contentMaxWidth,
        viewRef: childrenGridViewRef,
        getMoveTaskToQueryActions: (childTaskId, position) => {
            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const actions: Array<TaskActionModel> = [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId: childTaskId,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId,
                    },
                },
            ];

            if (childrenQuery) {
                actions.push({
                    type: "UpdateTask",
                    time: time2,
                    taskId: childTaskId,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: getNewTaskPositionForQuerySortedByPosition(
                            time2,
                            childrenQuery,
                            position,
                        ),
                    },
                });
            }

            return actions;
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
            if (target.taskId !== taskId) return {preventDefault: false};

            switch (entry.type) {
                case "Actions": {
                    store.commitTaskActionTransaction(context, entry.undoActions.get(store), {
                        undoManager,
                        affinityManager,
                        leaseId: entry.leaseId,
                    });
                    break;
                }
                case "Notes": {
                    const contentEditor = entry.contentEditorRef.current;

                    // If the content editor has unmounted, we can't handle this entry.
                    if (!contentEditor) return {preventDefault: false};

                    if (type === "Undo") {
                        contentEditor.undo();
                    } else {
                        contentEditor.redo();
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
                        assertExists(mainRef.current).focusAllTitleInput();
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

            return {preventDefault: true};
        },
        getAnchorPosition: useCallback(() => {
            const main = assertExists(mainRef.current);
            const editor = main.getNotesEditorIfExists();

            // We'll get our anchor position from the editor if it exists and is focused.
            if (!editor || !editor.isFocused()) return null;

            const editorState = editor.getState();

            const coords = editor.coordsAtPos(editorState.getSelection().from);

            const spacingScale = getSpacingScaleWithoutListening();
            const paragraphLineHeight = contentStyles.paragraphLineHeightPx[spacingScale];

            // Add a paragraph line height in either direction as slop. We consider the
            // selection offscreen if there's less than a line of space between it and the
            // keyboard.
            return {
                top: coords.top - paragraphLineHeight,
                height: coords.bottom - coords.top + paragraphLineHeight * 2,
            };
        }, []),
    });

    const displayStatus = useStore(
        useMemo(
            (): Store<TaskDisplayStatus> =>
                taskSubscription?.taskEntryStore.map(
                    ({task}) => task?.getDisplayStatus() ?? "OpenInactive",
                ) ??
                new ConstStore(
                    initialFields.status === "Closed"
                        ? "Closed"
                        : initialFields.assigneeStatus === "Active"
                          ? "OpenActive"
                          : "OpenInactive",
                ),
            [initialFields.assigneeStatus, initialFields.status, taskSubscription?.taskEntryStore],
        ),
    );
    const isPriorityDefined = useStore(
        useMemo(
            () =>
                taskSubscription?.taskEntryStore.map(({task}) => !!task?.getPriority()) ??
                new ConstStore(initialFields.priority !== null),
            [initialFields.priority, taskSubscription?.taskEntryStore],
        ),
    );
    const isDueDateDefined = useStore(
        useMemo(
            () =>
                taskSubscription?.taskEntryStore.map(({task}) => !!task?.getDueDate()) ??
                new ConstStore(initialFields.dueDate !== null),
            [initialFields.dueDate, taskSubscription?.taskEntryStore],
        ),
    );

    const statusButtonRef = useRef<HTMLElement>(null);
    const titleInputRef = useRef<TaskDetailTitleInputRef>(null);
    const titleInputElementRef = useRef<HTMLDivElement>(null);
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

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const titleInput = assertExists(titleInputRef.current);

        if (!shouldInitiallyFocus) return;

        return scheduleAfterNavigationAnimation(() => {
            titleInput.focusAll();
        });
    }, [shouldInitiallyFocus, titleInputRef]);

    const {
        undo,
        redo,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        focusPriorityInput,
        focusDueDateInput,
    } = useEvents({
        undo: undoWithoutMemo,
        redo: redoWithoutMemo,
        pushUndoStackEntry: pushUndoStackEntryWithoutMemo,
        pushUndoStackEntryFromRedo: pushUndoStackEntryFromRedoWithoutMemo,
        pushRedoStackEntry: pushRedoStackEntryWithoutMemo,

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

    // Checks if a user has confirmed a task can be completed
    const [taskCloseConfirmationState, setTaskCloseConfirmationState] = useState<{
        taskId: TaskId;
        onConfirm: () => void;
    } | null>(null);

    const undoManager: TaskClientStoreUndoManager = useMemo(
        () => ({
            pushUndoStackEntry: ({undoActions, removedFromQueries, leaseId, release}) => {
                pushUndoStackEntry({
                    type: "Actions",
                    rootParentTaskId: taskId,
                    extra: null,
                    undoActions,
                    removedFromQueries,
                    leaseId,
                    release,
                });
            },
        }),
        [pushUndoStackEntry, taskId],
    );

    const commitActionTransaction = useCallback(
        (getActions: (taskId: TaskId) => Iterable<TaskActionModel>) => {
            if (!childrenQuery) {
                return commitActionTransactionAndCreateIfNeeded(() => getActions(taskId), {
                    undoManager,
                    affinityManager,
                });
            } else {
                return store.commitTaskActionTransaction(context, getActions(taskId), {
                    undoManager,
                    affinityManager,
                });
            }
        },
        [
            affinityManager,
            childrenQuery,
            commitActionTransactionAndCreateIfNeeded,
            context,
            store,
            taskId,
            undoManager,
        ],
    );

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        `Task:${taskId}`,
        initialIsFavorite,
    );

    const {menuActions, contextMenuActions} = useMemo(() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        contextMenuActions.push([
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn\u2019t copy task link",
                onPress: async () => {
                    // If the user tries to copy the link of a ghost task, then make sure the task
                    // is created before we write the URL to the clipboard.
                    if (!taskSubscription) {
                        await new Promise<void>(resolve =>
                            commitActionTransactionAndCreateIfNeeded(() => [], {
                                undoManager,
                                affinityManager,
                            }).finally(resolve),
                        );
                    }

                    const url = new URL(`/s/${spaceId}/tasks/${taskId}`, window.location.href);
                    await writeTextToClipboard(url.toString());
                },
            },
        ]);

        if (hasEditAccessLevel) {
            contextMenuActions.push(
                getTaskStatusMenuActionsWithoutFullTask({
                    timeZone,
                    currentAccount,
                    store,
                    displayStatus,
                    getAssigneeAccountIdSnapshot: () => {
                        if (!taskSubscription) return initialFields.assignee?.id ?? null;

                        return (
                            taskSubscription.taskEntryStore.getSnapshot().task?.getAssignee()
                                ?.assignee.accountId ?? null
                        );
                    },
                    getOpenChildCountSnapshot: () =>
                        taskSubscription?.taskEntryStore
                            .getSnapshot()
                            .task?.getOpenChildTaskCount() ?? 0,

                    onCloseConfirmationDialogueOpen: ({onConfirm}) => {
                        setTaskCloseConfirmationState({taskId, onConfirm});
                    },
                    commitActionTransaction,
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
                    label: "Undo",
                    keyboardShortcutHint: isAppleDevice ? "⌘+Z" : "Ctrl+Z",
                    onPress: undo,
                },
                {
                    label: "Redo",
                    keyboardShortcutHint: isAppleDevice ? "⌘+Y" : "Ctrl+Y",
                    onPress: redo,
                },
            ]);

            contextMenuActions.push([
                {
                    label: "Duplicate",
                    pressErrorTitle: "Couldn\u2019t duplicate task",
                    onPress: async () => {
                        const {taskId: newTaskId} = await store.duplicateTaskAndAllChildren(
                            context,
                            taskId,
                            timeZone,
                            {undoManager},
                        );

                        await navigate(`/s/${spaceId}/tasks/${newTaskId}`);
                    },
                },
                {
                    label: "Delete",
                    onPress: () => {
                        if (!taskSubscription) {
                            // If the task is open in a peek this will close the peek.
                            void navigate(-1);
                            return;
                        }

                        showTaskDeleteConfirmationModalDialog({
                            context,
                            reporter,
                            store,
                            undoManager,
                            taskId,
                            // Close the detail view (if this is in a peek we navigate back) before
                            // deleting the task so we don't flash the `<TaskDetailView>` deleted state.
                            onBeforeDelete: () => navigate(-1),
                        });
                    },
                },
            ]);
        }

        const menuActions = [...contextMenuActions];

        if (hasAccessLevel(access.level, "Comment")) {
            menuActions.unshift([
                {
                    icon: <ChatCircleDots />,
                    iconPlacement: "end",
                    // NOTE(calebmer, 2025-03-20): Design-wise, I'm currently trying to start
                    // everything in the more menu with a verb. Which is why the label for this is
                    // "Open comments" instead of "Comments". The "Favorite" item is partially an
                    // exception. "Favorite" itself can be interpreted as a verb but after you press
                    // the favorite option, pressing again will unfavorite. So the verb name doesn't
                    // match the action.
                    label: showComments ? "Close comments" : "Open comments",
                    pressErrorTitle: showComments
                        ? "Couldn\u2019t close comments"
                        : "Couldn\u2019t open comments",
                    onPress: async () => {
                        // If the user tries to open a task's comments, then make sure the task
                        // is created before we open comments.
                        if (!taskSubscription) {
                            await new Promise<void>(resolve =>
                                commitActionTransactionAndCreateIfNeeded(() => [], {
                                    undoManager,
                                    affinityManager,
                                }).finally(resolve),
                            );
                        }

                        if (routeLayout === "narrow") {
                            await navigate(`/s/${spaceId}/tasks/${taskId}/comments?from=task`);
                        } else {
                            onShowCommentsChange(!showComments);
                        }
                    },
                },
            ]);

            if (favoriteMenuAction) {
                menuActions[1] = [...assertExists(menuActions[1]), favoriteMenuAction];
            }
        }

        return {menuActions, contextMenuActions} as any as {
            menuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
            contextMenuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
        };
    }, [
        access.level,
        affinityManager,
        commitActionTransaction,
        commitActionTransactionAndCreateIfNeeded,
        context,
        currentAccount,
        displayStatus,
        dueDateInputState.isVisible,
        favoriteMenuAction,
        focusDueDateInput,
        focusPriorityInput,
        hasEditAccessLevel,
        initialFields.assignee?.id,
        isAppleDevice,
        navigate,
        onShowCommentsChange,
        priorityInputState.isVisible,
        redo,
        reporter,
        routeLayout,
        showComments,
        spaceId,
        store,
        taskId,
        taskSubscription,
        timeZone,
        undo,
        undoManager,
    ]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: <TaskDetailViewNavigationBarTitle taskSubscription={taskSubscription} />,
        getTitleBoundaryElement: useCallback(() => assertExists(titleInputElementRef.current), []),
        titleBoundaryMarginTop: spacing["4"],
        menuActions,
        contextMenuActions,
        desktopMaxWidth: contentStyles.contentMaxWidth,
        desktopControls: (
            <TaskDetailViewStatusButton
                elementRef={statusButtonRef}
                size={taskDetailViewStatusButtonSize[platformRouteLayout]}
                store={store}
                taskSubscription={taskSubscription}
                initialFields={initialFields}
                isReadOnly={!hasEditAccessLevel}
                contextMenuActions={contextMenuActions}
                commitActionTransaction={commitActionTransaction}
            />
        ),
    });

    return (
        <>
            {childrenGridViewModals}
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    if (event.key === "Escape") {
                        if (showComments) {
                            event.preventDefault();
                            event.stopPropagation();

                            onShowCommentsChange(false);
                        }
                    } else {
                        onChildrenGridViewGlobalKeyDown(event);
                    }
                }}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={scrollViewRef}
                    scrollbarInsetTop={scrollbarInsetTop}
                    stateKey={childrenGridViewStateKey}
                    bufferedItemHeight={childrenGridViewBufferedItemHeight}
                    itemCount={childrenGridViewItemCount + 1}
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
                                    minHeight: taskDetailViewMainMinHeightPx[spacingScale],
                                    node: (
                                        <TaskDetailViewMainMemo
                                            ref={mainRef}
                                            possiblyGhostTaskId={taskId}
                                            store={store}
                                            taskSubscription={taskSubscription}
                                            initialFields={initialFields}
                                            undoManager={undoManager}
                                            affinityManager={affinityManager}
                                            hasEditAccessLevel={hasEditAccessLevel}
                                            focusChildrenGridViewStart={focusChildrenGridViewStart}
                                            pushUndoStackEntry={pushUndoStackEntry}
                                            pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                                            pushRedoStackEntry={pushRedoStackEntry}
                                            contextMenuActions={contextMenuActions}
                                            statusButtonRef={statusButtonRef}
                                            titleInputRef={titleInputRef}
                                            titleInputElementRef={titleInputElementRef}
                                            priorityInputRef={priorityInputRef}
                                            isPriorityInputVisible={priorityInputState.isVisible}
                                            setPriorityInputState={setPriorityInputState}
                                            focusPriorityInput={focusPriorityInput}
                                            dueDateInputRef={dueDateInputRef}
                                            isDueDateInputVisible={dueDateInputState.isVisible}
                                            setDueDateInputState={setDueDateInputState}
                                            focusDueDateInput={focusDueDateInput}
                                            notesEditorStateStore={notesEditorStateStore}
                                            onNotesEditorStateChange={onNotesEditorStateChange}
                                            reconnectNotesClient={reconnectNotesClient}
                                            commitActionTransaction={commitActionTransaction}
                                            commitActionTransactionAndCreateIfNeeded={
                                                commitActionTransactionAndCreateIfNeeded
                                            }
                                        />
                                    ),
                                };
                            }

                            return renderChildrenGridViewItem(index - 1);
                        },
                        [
                            renderChildrenGridViewItem,
                            spacingScale,
                            taskId,
                            store,
                            taskSubscription,
                            initialFields,
                            undoManager,
                            affinityManager,
                            hasEditAccessLevel,
                            focusChildrenGridViewStart,
                            pushUndoStackEntry,
                            pushUndoStackEntryFromRedo,
                            pushRedoStackEntry,
                            contextMenuActions,
                            priorityInputState.isVisible,
                            focusPriorityInput,
                            dueDateInputState.isVisible,
                            focusDueDateInput,
                            notesEditorStateStore,
                            onNotesEditorStateChange,
                            reconnectNotesClient,
                            commitActionTransaction,
                            commitActionTransactionAndCreateIfNeeded,
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
            {taskCloseConfirmationState && (
                <TaskCloseConfirmationModalDialog
                    store={store}
                    taskId={taskCloseConfirmationState.taskId}
                    onClose={() => setTaskCloseConfirmationState(null)}
                    onConfirm={taskCloseConfirmationState.onConfirm}
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
    focusAllTitleInput(): void;
    focusAssigneeInput(): void;
    focusCollectionsInput(): void;
    focusNotesInput(): void;
    getNotesEditorIfExists(): ContentEditorRef<TaskNotesContentWithReferences> | null;
};

const TaskDetailViewMainMemo = memo(forwardRef(TaskDetailViewMain));

function TaskDetailViewMain(
    {
        possiblyGhostTaskId,
        store,
        taskSubscription,
        initialFields,
        undoManager,
        affinityManager,
        hasEditAccessLevel,
        focusChildrenGridViewStart,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        contextMenuActions,
        statusButtonRef,
        titleInputRef,
        titleInputElementRef,
        priorityInputRef,
        isPriorityInputVisible,
        setPriorityInputState,
        focusPriorityInput,
        dueDateInputRef,
        isDueDateInputVisible,
        setDueDateInputState,
        focusDueDateInput,
        notesEditorStateStore,
        onNotesEditorStateChange,
        reconnectNotesClient,
        commitActionTransaction,
        commitActionTransactionAndCreateIfNeeded,
    }: {
        possiblyGhostTaskId: TaskId;
        store: TaskClientStore;
        taskSubscription: TaskClientTaskSubscription | null;
        initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        hasEditAccessLevel: boolean;
        focusChildrenGridViewStart: Memo<() => void>;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        contextMenuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
        statusButtonRef: RefObject<HTMLElement | null>;
        titleInputRef: RefObject<TaskDetailTitleInputRef | null>;
        titleInputElementRef: RefObject<HTMLDivElement | null>;
        priorityInputRef: Ref<HTMLDivElement>;
        isPriorityInputVisible: boolean;
        setPriorityInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusPriorityInput: Memo<(options: {preventScroll: boolean}) => void>;
        dueDateInputRef: Ref<HTMLDivElement>;
        isDueDateInputVisible: boolean;
        setDueDateInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusDueDateInput: Memo<(options: {preventScroll: boolean}) => void>;
        notesEditorStateStore: Store<TaskNotesContentEditorState>;
        onNotesEditorStateChange: Memo<
            (state: ContentEditorState<TaskNotesContentWithReferences>) => void
        >;
        reconnectNotesClient: Memo<() => void>;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => ReadonlyArray<TaskActionModel>) => {
                finally(listener: () => void): void;
            }
        >;
        commitActionTransactionAndCreateIfNeeded: Memo<
            (
                getActions: () => Iterable<TaskActionModel>,
                options: {
                    undoManager: TaskClientStoreUndoManager | null;
                    affinityManager: TaskClientStoreSearchAffinityManager;
                },
            ) => {
                finally: (callback: () => void) => void;
            }
        >;
    },
    ref: Ref<TaskDetailViewMainRef>,
) {
    const context = useAppContext();
    const platform = usePlatform();
    const {timeZone} = useClientInfo();
    const accountRegistry = useAccountRegistry();
    const {currentAccount} = useSpaceContext();

    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task ?? null;

    const assigneeAccountStore = !taskSubscription
        ? initialFields.assignee !== null
            ? assertExists(accountRegistry.getAccountStore(initialFields.assignee))
            : null
        : task
          ? store.getTaskAssigneeAccountStore(task)
          : null;
    const assigneeAccountData = useStore(assigneeAccountStore);

    const priority = !taskSubscription ? initialFields.priority : (task?.getPriority() ?? null);
    const dueDate = !taskSubscription ? initialFields.dueDate : (task?.getDueDate() ?? null);

    const title = useMemo(() => {
        if (!taskSubscription) {
            if (initialFields.titleUpdate === null) return emptyTaskTitleModel.get();

            return initialFields.titleUpdate.newTitle;
        }

        return task?.getTitle() ?? emptyTaskTitleModel.get();
    }, [initialFields.titleUpdate, task, taskSubscription]);

    const collections = useMemo(() => {
        if (!taskSubscription) {
            const collectionOrderKeys = generateOrderKeysBetween(
                null,
                null,
                initialFields.collectionIds.size,
            );

            return TaskCollectionSet.from(
                mapIterable(initialFields.collectionIds, (collectionId, collectionIndex) => [
                    collectionId,
                    new TaskCollectionSet.ValueRegister(
                        collectionOrderKeys[collectionIndex]!,
                        zeroHybridLogicalTime,
                    ),
                ]),
            );
        }

        return task?.getCollections() ?? TaskCollectionSet.empty;
    }, [initialFields.collectionIds, task, taskSubscription]);

    const titleCommitStateRef = useRef<{
        pendingActionTransactionBuilder: {
            add: (titleUpdate: TaskTitleUpdateModel) => void;
            commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
                finally: (callback: () => void) => void;
            };
        } | null;
    } | null>(null);

    const onTitleChange = (titleUpdate: TaskTitleUpdateModel) => {
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
                    store.getTaskUpdateTitleActionTransactionBuilder(
                        possiblyGhostTaskId,
                        titleUpdate,
                        {
                            undoManager,
                            affinityManager,
                        },
                    );
            }
            return;
        }

        const commitPromise = commitActionTransaction(taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate,
                },
            },
        ]);

        handleCommitPromise(commitPromise);
    };

    // Naming nit: An "input" is some editable component without a label. A "field"
    // is the combination of both a label and an input.
    const assigneeInputRef = useRef<TaskAssigneeInputRef>(null);
    const collectionsInputRef = useRef<TaskCollectionsInputRef>(null);
    const notesFieldRef = useRef<TaskDetailNotesFieldRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            focusStatusButton: () => {
                assertExists(statusButtonRef.current).focus();
            },
            focusAllTitleInput: () => {
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
            getNotesEditorIfExists: () => {
                return assertExists(notesFieldRef.current).getEditorIfExists();
            },
        }),
        [focusDueDateInput, focusPriorityInput, statusButtonRef, titleInputRef],
    );

    const ensureCreateTask = useCallback(async () => {
        // If the user tries to enter content into this task, create it if needed.
        if (!taskSubscription) {
            await new Promise<void>(resolve =>
                commitActionTransactionAndCreateIfNeeded(() => [], {
                    undoManager,
                    affinityManager,
                }).finally(resolve),
            );
        }
    }, [taskSubscription, undoManager, affinityManager, commitActionTransactionAndCreateIfNeeded]);

    return (
        <>
            <Box height="safe-area-inset-top" />
            <Box
                data-testid="TaskDetailViewMain"
                overflow="hidden"
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
                marginX="center"
                display="flex"
                flexDirection="column"
                position="relative"
            >
                {platform === "mobile" && (
                    // On mobile, create some space for the navigation bar since it's back button
                    // will conflict with the status button.
                    <Spacer space={navigationBarHeight} />
                )}
                <ContextMenuActions actions={contextMenuActions}>
                    <Box paddingBottom={taskDetailViewSectionGap} paddingX={screenPaddingX}>
                        {platform !== "mobile" ? (
                            <Box height={navigationBarHeight} />
                        ) : (
                            <Box
                                // The `paddingTop` of `3` happens to align with the
                                // `<DocumentCommentThreadHeader>`'s resolve button on mobile.
                                paddingTop={taskDetailViewStatusButtonMobilePaddingTop}
                                paddingBottom={taskDetailViewStatusButtonMobilePaddingBottom}
                            >
                                {platform === "mobile" && (
                                    <TaskDetailViewStatusButton
                                        elementRef={statusButtonRef}
                                        size={taskDetailViewStatusButtonSize.mobileNarrow}
                                        store={store}
                                        taskSubscription={taskSubscription}
                                        initialFields={initialFields}
                                        isReadOnly={!hasEditAccessLevel}
                                        commitActionTransaction={commitActionTransaction}
                                    />
                                )}
                            </Box>
                        )}
                        <TaskDetailViewParentBreadcrumbs
                            task={task}
                            taskSubscription={taskSubscription}
                        />
                        <TaskDetailTitleInput
                            ref={titleInputRef}
                            elementRef={titleInputElementRef}
                            isReadOnly={!hasEditAccessLevel}
                            title={title}
                            onTitleChange={onTitleChange}
                            placeholder={taskFallbackTitle}
                        />
                    </Box>
                </ContextMenuActions>
                <Box
                    paddingX={screenPaddingX}
                    display="grid"
                    gap={taskDetailViewDenseFieldGap}
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
                                isReadOnly={!hasEditAccessLevel}
                                aria-labelledby={ariaLabelledBy}
                                assigneeAccountData={assigneeAccountData}
                                onAssigneeAccountChange={assigneeAccount => {
                                    // Currently, accounts without space access can't edit tasks. The max
                                    // permission level of `urlGrant` is `View`.
                                    assert(currentAccount);

                                    commitActionTransaction(taskId => {
                                        const time = store.clock.now();

                                        return [
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
                                        ];
                                    });
                                }}
                            />
                        )}
                    </TaskDetailViewDenseField>
                    <TaskDetailViewDenseField label="Collections">
                        {({"aria-labelledby": ariaLabelledBy}) => (
                            <TaskCollectionsInput
                                ref={collectionsInputRef}
                                store={store}
                                referencesSubscription={taskSubscription ?? initialFields}
                                collections={collections}
                                aria-labelledby={ariaLabelledBy}
                                isReadOnly={!hasEditAccessLevel}
                                shouldAlignWithDetailViewInputsIfEmpty={true}
                                commitActionTransaction={commitActionTransaction}
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
                                        isReadOnly={!hasEditAccessLevel}
                                        // If a task is closed, suppress the urgent warning.
                                        shouldHighlightUrgent={
                                            task?.getDisplayStatus() !== "Closed"
                                        }
                                        priority={priority}
                                        onPriorityChange={priority => {
                                            commitActionTransaction(taskId => [
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
                                        isReadOnly={!hasEditAccessLevel}
                                        date={dueDate}
                                        onDateChange={dueDate => {
                                            commitActionTransaction(taskId => [
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
                <Spacer space={taskDetailViewSectionGap} />
                <TaskDetailNotesField
                    ref={notesFieldRef}
                    taskId={possiblyGhostTaskId}
                    isReadOnly={!hasEditAccessLevel}
                    pushUndoStackEntry={pushUndoStackEntry}
                    pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                    pushRedoStackEntry={pushRedoStackEntry}
                    notesEditorStateStore={notesEditorStateStore}
                    onNotesEditorStateChange={onNotesEditorStateChange}
                    reconnectNotesClient={reconnectNotesClient}
                    ensureCreateTask={ensureCreateTask}
                />
                <Spacer space={taskDetailViewSectionGap} />
                <Box>
                    <span
                        className={sprinkles({
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3",
                            paddingX: screenPaddingX,
                            paddingBottom: taskDetailViewSubtasksFieldLabelPaddingBottom,
                            color: taskDetailViewFieldLabelColor,
                        })}
                        // Affordance for mouse users. Clicking on a label focuses child tasks.
                        onClick={focusChildrenGridViewStart}
                    >
                        <Box fontSize={taskDetailViewFieldLabelFontSize}>Subtasks</Box>
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
                    </span>
                </Box>
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

    const touchSlop = useTouchSlop(taskDetailViewDenseFieldMinHeight);

    return (
        // Doesn't have a parent to horizontally align elements since we layout fields
        // with CSS grid.
        <>
            <span
                className={sprinkles({
                    display: "block",
                    maxWidth: "24",
                    minHeight: taskDetailViewDenseFieldMinHeight,
                })}
            >
                <span
                    id={labelId}
                    className={sprinkles({
                        display: "block",
                        width: "full",
                        height: touchSlop.sizeWithSlop,
                        paddingY: touchSlop.slop,
                        marginY: `-${touchSlop.slop}`,
                        fontSize: taskDetailViewFieldLabelFontSize,
                        fontStyle: "truncate",
                        color: "grey-60",
                    })}
                    // As an affordance for mouse users, when the label is clicked we focus
                    // the first element in the input.
                    onClick={() => {
                        let element = getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(valueRef.current),
                        });

                        // Look specifically for text input elements. This is important for
                        // `<TaskCollectionsInput>` since we want to focus the "+ Add" text input not a
                        // collection chip.
                        while (!isTextInputElement(element)) {
                            element = getNextFocusableElementIfExists(element, {
                                withinElement: assertExists(valueRef.current),
                            });
                        }

                        element?.focus();
                    }}
                >
                    {label}
                </span>
            </span>
            <Box ref={valueRef} minHeight={taskDetailViewDenseFieldMinHeight}>
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
    taskSubscription: TaskClientTaskSubscription | null;
}) {
    const navigate = useNavigate();
    const {currentAccount} = useSpaceContext();

    const nodeStore = useMemo(() => {
        return computeStore(get => {
            const parentNodes: Array<ReactElement> = [];

            let loopTask = task;
            while (loopTask !== null) {
                const parent = loopTask.getParent();
                if (taskSubscription === null || parent === null) {
                    loopTask = null;
                    continue;
                }

                const parentTaskEntry = get(
                    taskSubscription.getReferencedTaskEntryStore(parent.taskId),
                );

                const parentAccess = computeTaskEntryAccess(
                    get,
                    currentAccount?.id,
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
                            content="You don\u2019t have access to the task this is a subtask of"
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
                        pressErrorTitle="Couldn\u2019t open task"
                        onPress={() =>
                            navigate(
                                `/s/${parentTaskEntry.task.getSpaceId()}/tasks/${
                                    parentTaskEntry.task.id
                                }`,
                                {
                                    // Don't let the route open in `<PeekStack>`.
                                    stopPropagation: true,
                                },
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
    }, [currentAccount?.id, navigate, task, taskSubscription]);

    return useStore(nodeStore);
}

function TaskDetailViewNavigationBarTitle({
    taskSubscription,
}: {
    taskSubscription: TaskClientTaskSubscription | null;
}) {
    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task;
    const titleText = addFallbackToTaskTitle(task?.getTitle().getText() ?? "");

    return <>{titleText}</>;
}

function TaskDetailViewStatusButton({
    size,
    store,
    taskSubscription,
    initialFields,
    isReadOnly,
    elementRef,
    contextMenuActions,
    commitActionTransaction,
}: {
    size: "6" | "7";
    store: TaskClientStore;
    taskSubscription: TaskClientTaskSubscription | null;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
    isReadOnly: boolean;
    elementRef: RefObject<HTMLElement | null>;
    contextMenuActions?: ReadonlyArray<ReadonlyArray<MenuAction>>;
    commitActionTransaction: Memo<
        (getActions: (taskId: TaskId) => ReadonlyArray<TaskActionModel>) => void
    >;
}) {
    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task ?? null;

    let node = (
        <TaskStatusButton
            ref={elementRef}
            size={size}
            store={store}
            task={task}
            initialFields={initialFields}
            isDisabled={isReadOnly}
            commitActionTransaction={commitActionTransaction}
        />
    );

    if (contextMenuActions) {
        node = <ContextMenuActions actions={contextMenuActions}>{node}</ContextMenuActions>;
    }

    return node;
}
