import {setInteractionModality} from "@react-aria/interactions";
import {Link as LinkIcon} from "phosphor-react";
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
import {useSearchParams} from "react-router-dom";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentDuplicationInstructionalModal} from "~/client/web/content/content_duplication_instructional_modal.js";
import {ContentEditorRef} from "~/client/web/content/content_editor.js";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {BottomBarFrameContextProvider} from "~/client/web/design/bottom_bar_frame_context_provider.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {getElementSafeAreaInsetTopPx} from "~/client/web/design/safe_area_inset.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useTouchSlop} from "~/client/web/design/use_touch_slop.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useMessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/web/messaging/message_view.js";
import {MessagingViewPointerToolbar} from "~/client/web/messaging/messaging_view_pointer_toolbar.js";
import {
    getMessageListItemKey,
    renderMessageListItem,
} from "~/client/web/messaging/render_message_list_item.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {tryLoadingMessages} from "~/client/web/messaging/try_loading_messages.js";
import {useJumpToMessageRange} from "~/client/web/messaging/use_jump_to_message_range.js";
import {useMessagingRealtime} from "~/client/web/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/web/messaging/use_scroll_to_new_messages.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {NavigationBarShareButtonProps} from "~/client/web/navigation/navigation_bar_types.js";
import {usePeekStackContextIfExists} from "~/client/web/peek/peek_stack_context.js";
import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {postContentViewCommentMargin} from "~/client/web/styles/forum_shared_styles.js";
import {messageInputMinHeightPx} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, spaceLayoutStyles, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskDetailViewCommentSectionHeaderHeightPx,
    taskDetailViewDenseFieldGap,
    taskDetailViewDenseFieldMinHeight,
    taskDetailViewFieldLabelColor,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewHeaderMarginBottom,
    taskDetailViewMainMinHeightPx,
    taskDetailViewSectionGap,
    taskDetailViewStatusButtonMobilePaddingBottom,
    taskDetailViewStatusButtonMobilePaddingTop,
    taskDetailViewStatusButtonSize,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
    taskGridViewColumnHeaderHeight,
    taskGridViewColumnHeaderLabelColor,
    taskGridViewColumnHeaderLabelFontSize,
    taskGridViewColumnHeaderLabelMarginBottom,
    taskProjectDetailViewCommentSectionHeaderHeightPx,
    taskProjectDetailViewMainMinHeightPx,
    taskProjectDetailViewMarginTop,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {createTaskDetailViewInheritedAccessPolicyExplanations} from "~/client/web/tasks/internal/create_task_detail_view_inherited_access_policy_explanations.js";
import {createTaskEffectiveAccessPolicyStore} from "~/client/web/tasks/internal/create_task_entry_effective_access_policy_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActionsWithoutFullTask} from "~/client/web/tasks/internal/get_task_status_menu_actions.js";
import {isTaskClientStoreTaskEntryDeleted} from "~/client/web/tasks/internal/is_task_client_store_task_entry_deleted.js";
import {showTaskDeleteConfirmationModalDialog} from "~/client/web/tasks/internal/show_task_delete_confirmation_modal_dialog.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/web/tasks/internal/task_assignee_input.js";
import {TaskCloseConfirmationModalDialog} from "~/client/web/tasks/internal/task_close_confirmation_modal_dialog.js";
import {
    TaskCollectionsInput,
    TaskCollectionsInputRef,
} from "~/client/web/tasks/internal/task_collections_input.js";
import {TaskCommentInput} from "~/client/web/tasks/internal/task_comment_input.js";
import {TaskDateInput} from "~/client/web/tasks/internal/task_date_input.js";
import {
    TaskDetailNotesField,
    TaskDetailNotesFieldRef,
} from "~/client/web/tasks/internal/task_detail_notes_field.js";
import {
    TaskDetailTitleInput,
    TaskDetailTitleInputRef,
} from "~/client/web/tasks/internal/task_detail_title_input.js";
import {TaskDetailViewNavigationBarTitle} from "~/client/web/tasks/internal/task_detail_view_navigation_bar_title.js";
import {TaskDetailViewParentBreadcrumbs} from "~/client/web/tasks/internal/task_detail_view_parent_breadcrumbs.js";
import {TaskFloatingCreateButton} from "~/client/web/tasks/internal/task_floating_create_button.js";
import {
    isTaskQueryManuallySorted,
    useTaskGridViewVirtualizedList,
} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskGridViewVirtualizedListViewRef} from "~/client/web/tasks/internal/task_grid_view_virtualized_list_types.js";
import {TaskPriorityInput} from "~/client/web/tasks/internal/task_priority_input.js";
import {
    TaskProjectDetailViewDesktopHeader,
    TaskProjectDetailViewDesktopHeaderRef,
} from "~/client/web/tasks/internal/task_project_detail_view_desktop_header.js";
import {useTaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskStatusButton} from "~/client/web/tasks/internal/task_status_button.js";
import {useTaskDetailNotesContentEditorWebSocketClient} from "~/client/web/tasks/internal/use_task_detail_notes_content_editor_web_socket_client.js";
import {TaskUndoStackEntry} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {normalizeTaskDetailViewQuery} from "~/client/web/tasks/normalize_task_detail_view_query.js";
import {TaskChildTasksProgressWheel} from "~/client/web/tasks/task_child_tasks_progress_wheel.js";
import {TaskNotesContentEditorState} from "~/client/web/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {taskDetailViewLoadMoreChildTasksLimit} from "~/client/web/tasks/task_detail_view_load_more_child_tasks_limit.js";
import {useTaskQueryState} from "~/client/web/tasks/use_task_query_state.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {
    AccessPolicy,
    AccessPolicyWithoutGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {
    encodeContentDuplicationVariableSchemaForUrl,
    extractContentDuplicationVariableSchema,
} from "~/shared/content/content_duplication_variable_schema.js";
import {Context} from "~/shared/context/context.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {
    InternalError,
    OutOfRangeError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateOrderKeysBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ConstStore, falseStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {createDefaultTaskAccessPolicy} from "~/shared/tasks/create_default_task_access_policy.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {
    taskDeletedErrorDisplayMessage,
    taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQueryFilter,
    deserializeTaskQueryFiltersSearchParam,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryFilterReferences,
    mergeTaskQueryFilterReferences,
} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {
    TaskTitleUpdateModel,
    addFallbackToTaskTitle,
    emptyTaskTitleModel,
    taskFallbackTitle,
} from "~/shared/tasks/title/task_title.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export function TaskDetailView({
    taskId: possiblyGhostTaskId,
    store,
    taskSubscription,
    layout,
    initialChildrenQuery,
    initialFilters,
    initialFilterReferences,
    onFiltersChange,
    initialSorts,
    onSortsChange,
    initialFields,
    initialIsFavorite,
    initialNotesVersion,
    initialNotesContent,
    affinityManager,
    shouldInitiallyFocus,
    initialComments,
    initialScrollToCommentIndex,
    commitActionTransactionAndCreateIfNeeded,
    shareActivationHint,
    onShareActivationHintHide,
}: {
    taskId: TaskId;
    store: TaskClientStore;
    taskSubscription: TaskClientTaskSubscription | null;
    layout: TaskLayout | null;
    initialChildrenQuery: {
        query: TaskClientQuery;
        initialGridViewExpansionState: TaskGridViewExpansionState;
    } | null;
    initialFilters: ReadonlyArray<TaskQueryFilter>;
    initialFilterReferences: TaskQueryFilterReferences;
    onFiltersChange: (filters: ReadonlyArray<TaskQueryFilter>) => void;
    initialSorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
    initialIsFavorite: boolean;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
    affinityManager: TaskClientStoreSearchAffinityManager;
    shouldInitiallyFocus: boolean;
    initialComments: {
        checkpoint: ServerSynchronizationCheckpoint;
        commentCount: number;
        comments: ReadonlyArray<TaskCommentModel>;
        otherReferencedComments: ReadonlyArray<TaskCommentModel>;
    };
    initialScrollToCommentIndex: number | null;
    commitActionTransactionAndCreateIfNeeded: Memo<
        (
            getActions: () => Iterable<TaskActionModel>,
            options: {
                undoManager: TaskClientStoreUndoManager | null;
                affinityManager: TaskClientStoreSearchAffinityManager;
                updateAccessPolicyShareNotification?: ShareNotification | null;
            },
        ) => {
            finally: (callback: () => void) => void;
        }
    >;
    shareActivationHint: {willBeVisible: true; isVisible: boolean} | null;
    onShareActivationHintHide: () => void;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const platformRouteLayout = getPlatformRouteLayout(platform, routeLayout);
    const navigate = useNavigate();
    const rootNavigate = useRootNavigate();
    const [searchParams] = useSearchParams();
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const {timeZone} = clientInfo;
    const reporter = useReporter();
    const {space, currentAccount} = useSpaceContext();
    const peekStackContext = usePeekStackContextIfExists();
    const currentDate = useCurrentDate();

    const spaceId = space.id;

    /* ========================================================================= *\
     *                             Task access check                             *
    \* ========================================================================= */

    const {effectiveAccessPolicy, inheritedAccessPolicy} = useStore(
        useMemo((): Store<{
            effectiveAccessPolicy: AccessPolicyWithoutGenerations;
            inheritedAccessPolicy: AccessPolicyWithoutGenerations;
        }> => {
            // If there's no task subscription that's because we're creating the task. The task
            // creator always has manage access.
            if (!taskSubscription) {
                return new ConstStore({
                    effectiveAccessPolicy:
                        createDefaultTaskAccessPolicyForOptionalCurrentAccount(currentAccount),
                    inheritedAccessPolicy: {
                        accountGrantById: emptyMap,
                        defaultGrant: null,
                        urlGrant: null,
                    },
                });
            }

            return createTaskEffectiveAccessPolicyStore(
                taskSubscription,
                taskSubscription.taskEntryStore,
            );
        }, [currentAccount, taskSubscription]),
    );

    const isDeleted = useStore(
        useMemo(() => {
            if (!taskSubscription) return falseStore;
            return taskSubscription?.taskEntryStore.map(isTaskClientStoreTaskEntryDeleted);
        }, [taskSubscription]),
    );

    const accessLevel = useMemo(() => {
        const accessLevel = getAccountAccessLevelAssumingSpaceAccess(
            effectiveAccessPolicy,
            currentAccount?.id,
        );

        if (accessLevel === null) {
            if (isDeleted) {
                throw new PermissionDeniedError("Current account lost access to task (deleted)", {
                    displayMessage: taskDeletedErrorDisplayMessage,
                });
            } else {
                throw new PermissionDeniedError(
                    "Current account lost access to task (policy updated)",
                    {
                        displayMessage:
                            taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
                    },
                );
            }
        }

        return accessLevel;
    }, [currentAccount?.id, effectiveAccessPolicy, isDeleted]);

    // This is the access policy directly added to the task. This is different from the
    // task's "effective" access which is based on the task's parent tasks and task
    // collections. `access` determines what the task's effective permissions are.
    const immediateAccessPolicy = useStore(
        useMemo(
            () =>
                taskSubscription?.taskEntryStore.map(
                    taskEntry =>
                        taskEntry.task?.getAccessPolicy() ??
                        createDefaultTaskAccessPolicyForOptionalCurrentAccount(currentAccount),
                ) ??
                new ConstStore(
                    createDefaultTaskAccessPolicyForOptionalCurrentAccount(currentAccount),
                ),
            [currentAccount, taskSubscription?.taskEntryStore],
        ),
    );

    /* ========================================================================= *\
     *                        Task detail notes WebSocket                        *
    \* ========================================================================= */

    const {
        isConnected,
        editorStateStore: notesEditorStateStore,
        onEditorStateChange: onNotesEditorStateChange,
        reconnect: reconnectNotesClient,
        procedures,
        subscribeToCommentsEvents,
        subscribeToPongs,
    } = useTaskDetailNotesContentEditorWebSocketClient({
        taskId: possiblyGhostTaskId,
        taskSubscription,
        accessLevel,
        initialNotesVersion,
        initialNotesContent,
        affinityManager,
        commitActionTransactionAndCreateIfNeeded,
    });

    /* ========================================================================= *\
     *                                  Fields                                   *
    \* ========================================================================= */

    // IMPORTANT: Do not `useStore(taskSubscription?.taskEntryStore)` in this
    // component! We don't want to re-render the entire virtualized scroll view
    // (containing child tasks and comments) every time the task title updates. Instead
    // use `Store.map()` to subscribe to individual pieces of data that are
    // automatically memoized.

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
    const childTaskCount = useStore(
        useMemo(
            () =>
                taskSubscription?.taskEntryStore.map(({task}) => task?.getChildTaskCount() ?? 0) ??
                new ConstStore(0),
            [taskSubscription?.taskEntryStore],
        ),
    );

    // We could calculate `layout` from `taskSubscription` but given the parent
    // component already calculates `layout` for us we take it as a prop.
    const isWideProjectLayout = layout === "Project" && routeLayout === "wide";

    const statusButtonRef = useRef<HTMLElement>(null);
    const titleInputRef = useRef<TaskDetailTitleInputRef>(null);
    const titleBoundaryRef = useRef<HTMLDivElement>(null);
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
        // null. But since the user may actively be editing the field in detail view, keep
        // it around.
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
        // null. But since the user may actively be editing the field in detail view, keep
        // it around.
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

    /* ========================================================================= *\
     *                           Child tasks grid view                           *
    \* ========================================================================= */

    const [{filters, filterReferences}, actuallySetFiltersState] = useState({
        filters: initialFilters,
        filterReferences: initialFilterReferences,
    });

    const lastFiltersRef = useRef(filters);
    useEffect(() => {
        if (lastFiltersRef.current !== filters) {
            onFiltersChange(filters);
            lastFiltersRef.current = filters;
        }
    }, [filters, onFiltersChange]);

    const [sorts, actuallySetSorts] = useState(initialSorts);

    const {updateFilters, setSorts} = useEvents({
        updateFilters: (
            filters: ReadonlyArray<TaskQueryFilter>,
            {
                mergeFilterReferences,
            }: {
                mergeFilterReferences?: TaskQueryFilterReferences;
            } = {},
        ) => {
            // Only projects can have filters/sorts. Everything else must have an empty array.
            if (!isWideProjectLayout) filters = emptyArray;

            actuallySetFiltersState(({filterReferences}) => {
                const newFilterReferences = mergeFilterReferences
                    ? mergeTaskQueryFilterReferences(filterReferences, mergeFilterReferences)
                    : filterReferences;

                return {
                    filters,
                    filterReferences: newFilterReferences,
                };
            });

            onFiltersChange(filters);
        },
        setSorts: (sorts: ReadonlyArray<TaskQuerySort>) => {
            // Only projects can have filters/sorts. Everything else must have an empty array.
            if (!isWideProjectLayout) sorts = emptyArray;

            actuallySetSorts(sorts);
            onSortsChange(sorts);
        },
    });

    // If we have filters or sorts for a non-project layout, then clear the
    // filters/sorts. We don't currently support filtering/sorting in a regular
    // `<TaskDetailView>`.
    //
    // This does mean there's some jank when you turn a project with filters into a
    // regular task (or if you load a regular task with `filters`/`sorts` search
    // param). We've decided this is acceptable for now since it's rare. If users
    // observe this state frequently we'll change it.
    useEffect(() => {
        if (!isWideProjectLayout) return;

        if (filters.length === 0 && sorts.length === 0) return;

        updateFilters(emptyArray);
        setSorts(emptyArray);
    }, [filters.length, isWideProjectLayout, layout, setSorts, sorts.length, updateFilters]);

    const {normalizedFiltersResult, normalizedSorts} = useMemo(() => {
        return normalizeTaskDetailViewQuery(possiblyGhostTaskId, filters, sorts, {
            currentDate,
            currentAccountId: currentAccount?.id ?? null,
        });
    }, [currentAccount?.id, currentDate, filters, possiblyGhostTaskId, sorts]);

    const childrenQueryState = useTaskQueryState({
        // We need to make sure `useTaskQueryState()` completely resets its internal state
        // when switching from a ghost task to non-ghost task. When we switch from a ghost
        // task `initialQuery` also switches from null to non-null. We want that switch to
        // happen immediately!
        //
        // If we wait for `useTaskQueryState()` to update normally we have to wait for a
        // `useEffect()`. So there will be some renders where `taskSubscription` is
        // non-null but `childrenQueryState.isAvailable` is false. Adding a key forces the
        // internal state of this hook to immediately reset (in the current render) when
        // transitioning from ghost task -> actual task.
        key: !taskSubscription ? `${possiblyGhostTaskId}-Ghost` : possiblyGhostTaskId,

        store,
        initialQuery: initialChildrenQuery,
        filters:
            taskSubscription && normalizedFiltersResult.type === "Possible"
                ? normalizedFiltersResult.normalizedFilters
                : null,
        sorts: normalizedSorts,
    });

    const mainRef = useRef<TaskDetailViewMainRef>(null);

    const hasEditAccessLevel = useMemo(() => hasAccessLevel(accessLevel, "Edit"), [accessLevel]);

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const projectChildrenViewRef = useRef<VirtualizedScrollViewRef>(null);
    const nonProjectChildrenViewRef = useRef<TaskGridViewVirtualizedListViewRef>(null);

    const shiftRenderedRangeForChildrenGridView = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            // We try to avoid calling this function entirely when `layout` is `Project` but as
            // a fallback return the range unmodified.
            if (isWideProjectLayout) return range;

            const previousItemCount = 1;
            const itemCount = childrenGridViewItemCountRef.current;

            if (!range) return null;
            if (itemCount === 0) return null;

            const startIndex = range.startIndex - previousItemCount;
            const endIndex = range.endIndex - previousItemCount;

            if (endIndex < 0 || startIndex >= itemCount) {
                return null;
            } else {
                return {
                    startIndex: Math.max(startIndex, 0),
                    endIndex: Math.min(endIndex, itemCount - 1),
                };
            }
        },
        [isWideProjectLayout],
    );

    // Offset all the methods on our `VirtualizedScrollViewRef` by the number of items
    // which precede our children grid view.
    useImperativeHandle(nonProjectChildrenViewRef, () => {
        // If `layout` is `Project` you should use `projectChildrenViewRef` since we don't
        // have to shift the rendered range, you can use the virtualized scroll view ref
        // directly.
        if (isWideProjectLayout) {
            const unimplemented = () => {
                throw new UnimplementedError("Use `projectChildrenViewRef` instead");
            };

            return {
                getHeight: unimplemented,
                getContentHeight: unimplemented,
                getScrollOffset: unimplemented,
                setScrollOffset: unimplemented,
                scrollToIndex: unimplemented,
                getRenderedRange: unimplemented,
                getKeyByIndexIfExists: unimplemented,
                getIndexByKeyIfExists: unimplemented,
                getPositionByIndex: unimplemented,
                getPositionByKeyIfExists: unimplemented,
                peekRenderedRangeAfterSetScrollOffset: unimplemented,
                getElement: unimplemented,
                getContentElement: unimplemented,
                getElementByKeyIfExists: unimplemented,
            };
        }

        return {
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
        };
    }, [isWideProjectLayout, shiftRenderedRangeForChildrenGridView]);

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
        store,

        capabilities: useMemo(() => {
            if (!isWideProjectLayout) {
                return {
                    isReadOnly: !hasEditAccessLevel,
                    hasParentTaskTitle: false,
                    hasMultilineTitle: true,
                    hasDenseFields: true,
                    hasColumns: false,
                    withoutAssigneeField: false,
                };
            } else {
                return {
                    isReadOnly: !hasEditAccessLevel,
                    hasParentTaskTitle: false,
                    hasMultilineTitle: false,
                    hasDenseFields: false,
                    hasColumns: true,
                    withoutAssigneeField: false,
                };
            }
        }, [hasEditAccessLevel, isWideProjectLayout]),

        // Even when `childrenQuery` is null we still want to show the bottom ghost task.
        // If the user starts to type in the bottom ghost task then
        // `commitActionTransaction` will be called which will create the task if needed.
        //
        // We also need to provide our own `stateKey` that doesn't change when
        // `childrenQuery` switches between null and a proper value. That way our subtasks,
        // undo state, and grid view expansion state don't change when we switch from
        // `query: null` to the actual children query subscription.
        stateKey: possiblyGhostTaskId,
        query: childrenQueryState.activeQuery.query,
        withBottomGhostTaskIfNullQuery: !taskSubscription,
        commitActionTransaction: !taskSubscription
            ? commitActionTransactionAndCreateIfNeeded
            : null,

        // Instead of implicitly loading more tasks when scrolling, the user must
        // explicitly load more tasks by pressing a "load more" button. That way we don't
        // get into weird states where the user has scrolled down to look at comments and
        // the comments jump around because we're loading the end of the task's child tasks
        explicitLoadMoreButton: useMemo(() => {
            // Project tasks don't have an explicit load more button. Rather they infinite load
            // on scroll.
            if (isWideProjectLayout) return;

            return {
                totalTaskCount: childTaskCount,
                loadMoreTasksLimit: taskDetailViewLoadMoreChildTasksLimit,
            };
        }, [childTaskCount, isWideProjectLayout]),

        withoutBorderTopIfFirstRow: isWideProjectLayout,
        columnHeaderTitleFieldLabel: "Task name",

        // In task detail views, there are comments underneath the substasks. So show three
        // decorative ghost rows but not our repeating decorative ghost row background.
        decorativeGhostRows: !isWideProjectLayout ? "Some" : "Background",

        affinityManager,
        rowMaxWidth: !isWideProjectLayout ? contentStyles.contentMaxWidth : undefined,
        viewRef: !isWideProjectLayout ? nonProjectChildrenViewRef : projectChildrenViewRef,
        getMoveTaskToQueryActions: (childTaskId, position) => {
            // During `?create` flows we can render a ghost subtask row before the children
            // query subscription is available.
            const childrenQuery = childrenQueryState.activeQuery.isAvailable
                ? childrenQueryState.activeQuery.query.query
                : null;

            // If the query is auto-sorted we disable features that allow moving tasks into the
            // query. Like hitting shift-tab to dedent or hitting enter to create a new task.
            // We may want to re-enable some of these someday in auto-sorted queries. See the
            // comment on `getMoveTaskToQueryActions` in `<TaskQueryView>` for more discussion.
            //
            // For ghost tasks, we always consider `childrenQuery` to be manually sorted.
            if (childrenQuery && !isTaskQueryManuallySorted(childrenQuery.sorts)) return null;

            const time1 = store.clock.now();
            const time2 = store.clock.now();

            const actualPosition: TaskPosition =
                position.type !== "Position"
                    ? childrenQuery
                        ? getNewTaskPositionForQuerySortedByPosition(time2, childrenQuery, position)
                        : {orderTime: time2, orderKey: initialOrderKey}
                    : position.position;

            const actions: Array<TaskActionModel> = [
                {
                    type: "UpdateTask",
                    time: time1,
                    taskId: childTaskId,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: possiblyGhostTaskId,
                    },
                },
                {
                    type: "UpdateTask",
                    time: time2,
                    taskId: childTaskId,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: actualPosition,
                    },
                },
            ];

            return {
                actions,
                position: actualPosition,
            };
        },
        getMaybeRemoveTaskFromQueryActions: taskId => {
            // During `?create` flows we can render a ghost subtask row before the children
            // query subscription is available.
            const childrenQuery = childrenQueryState.activeQuery.isAvailable
                ? childrenQueryState.activeQuery.query.query
                : null;

            // If the query is auto-sorted we disable features that remove tasks from the grid
            // view. Like tab to indent or drag and drop. Neither makes sense when you don't
            // have control over the order of tasks.
            //
            // For ghost tasks, we always consider `childrenQuery` to be manually sorted.
            if (childrenQuery && !isTaskQueryManuallySorted(childrenQuery.sorts)) return [];

            return [
                {
                    type: "UpdateTask",
                    time: store.clock.now(),
                    taskId,
                    taskAction: {type: "UpdateParentTaskId", parentTaskId: null},
                },
            ];
        },
        onApplyUndoStackEntry: ({type, target, entry, undoManager}) => {
            if (target.taskId !== possiblyGhostTaskId) return {preventDefault: false};

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
        getAnchorPosition: useCallback((oldVisibleRect: {top: number; bottom: number}) => {
            const {activeElement} = document;
            const viewContentElement = assertExists(viewRef.current).getContentElement();

            const main = assertExists(mainRef.current);
            const editor = main.getNotesEditorIfExists();

            // We'll get our anchor position from the editor if it exists and is focused.
            if (editor?.isFocused()) {
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
                    isPinned: false,
                };
            }

            // Pin to the bottom when comment input is focused. Or if nothing in the view is
            // focused.
            if (
                commentInputRef.current?.isFocused() ||
                !(activeElement instanceof Element) ||
                !isElementOwnedBy(viewContentElement, activeElement)
            ) {
                return {top: oldVisibleRect.bottom, height: 0, isPinned: true};
            }

            return null;
        }, []),
    });

    const childrenGridViewItemCountRef = useRef(childrenGridViewItemCount);

    useLayoutEffectWithoutServerSideWarning(() => {
        childrenGridViewItemCountRef.current = childrenGridViewItemCount;
    });

    // If the actor doesn't have space access then we need to keep track of any
    // accounts/collections referenced by the query. This is expensive (O(tasks)) so
    // it's important to only run this when `currentAccount` is null.
    const queryReferencesForUrlGrant = useTaskQueryReferencesForUrlGrantFilterEditor(
        !currentAccount ? (childrenQueryState.activeQuery.query?.query ?? null) : null,
    );

    const childTaskEntityNoun = layout === "Project" ? "task" : "subtask";
    const childTaskEntityPluralNoun = `${childTaskEntityNoun}s`;
    const childTaskEntityStartOfSentencePluralNoun =
        childTaskEntityPluralNoun.slice(0, 1).toUpperCase() + childTaskEntityPluralNoun.slice(1);

    const defaultOrderSentence =
        filters.length > 0
            ? `${childTaskEntityStartOfSentencePluralNoun} are ordered by created date.`
            : hasEditAccessLevel
              ? `You can change the order of ${childTaskEntityPluralNoun} by dragging them.`
              : `${childTaskEntityStartOfSentencePluralNoun} are ordered manually.`;

    /* ========================================================================= *\
     *                                 Comments                                  *
    \* ========================================================================= */

    const hasCommentAccessLevel = useMemo(
        () => hasAccessLevel(accessLevel, "Comment"),
        [accessLevel],
    );

    const [comments, setComments, setCommentsOptimistically] = useStateWithOptimisticUpdates(() => {
        return MessageList.new<TaskCommentModel>({
            checkpoint: initialComments.checkpoint,
            messageCount: initialComments.commentCount,
        }).loadMessages({
            messageCount: initialComments.commentCount,
            messages: initialComments.comments,
            otherReferencedMessages: initialComments.otherReferencedComments,
        });
    });

    const commentInputRef = useRef<MessageInputRef | null>(null);
    const setErrorState = useErrorState();

    const [isCommentSectionVisible, setIsCommentSectionVisible] =
        useState<boolean>(hasCommentAccessLevel);

    // If we lose comment access, immediately hide the comment section.
    if (isCommentSectionVisible && !hasCommentAccessLevel) setIsCommentSectionVisible(false);

    const isLoadingInitialCommentsAfterAccessChangeRef = useRef(false);

    // If we gain access to comments on this task in realtime then load new comments
    // from the server and set them in our state before we make the comment section
    // visible.
    useEffect(() => {
        if (!(!isCommentSectionVisible && hasCommentAccessLevel)) {
            isLoadingInitialCommentsAfterAccessChangeRef.current = false;
            return;
        }

        if (isLoadingInitialCommentsAfterAccessChangeRef.current) return;
        isLoadingInitialCommentsAfterAccessChangeRef.current = true;

        getTaskCommentsFromStart(context, {
            taskId: possiblyGhostTaskId,
            limit: getInitialLoadMessageCount(getClientInfo()),
            afterCommentIndex: null,
            beforeCommentIndex: null,
        })
            .then(output => {
                const comments = MessageList.new<TaskCommentModel>({
                    checkpoint: output.checkpoint,
                    messageCount: output.commentCount,
                }).loadMessages({
                    messageCount: output.commentCount,
                    messages: output.comments,
                    otherReferencedMessages: output.otherReferencedComments,
                });

                setComments(() => comments);
                setIsCommentSectionVisible(true);
            })
            .catch(error => {
                setErrorState(error);
            });
    }, [
        context,
        hasCommentAccessLevel,
        isCommentSectionVisible,
        possiblyGhostTaskId,
        setComments,
        setErrorState,
    ]);

    const commentItemCount = comments.getItemCount();
    const commentItemCountRef = useRef(commentItemCount);

    useLayoutEffectWithoutServerSideWarning(() => {
        commentItemCountRef.current = commentItemCount;
    });

    const shiftRenderedRangeForComments = useCallback(
        (range: {startIndex: number; endIndex: number} | null) => {
            if (!isCommentSectionVisible) return null;

            const previousItemCount =
                1 + (!isWideProjectLayout ? childrenGridViewItemCountRef.current : 0) + 1;
            const itemCount = commentItemCountRef.current;

            if (!range) return null;
            if (itemCount === 0) return null;

            const startIndex = range.startIndex - previousItemCount;
            const endIndex = range.endIndex - previousItemCount;

            if (endIndex < 0 || startIndex >= itemCount) {
                return null;
            } else {
                return {
                    startIndex: Math.max(startIndex, 0),
                    endIndex: Math.min(endIndex, itemCount - 1),
                };
            }
        },
        [isCommentSectionVisible, isWideProjectLayout],
    );

    const isLoadingCommentsRef = useRef(false);

    const tryLoadingMoreCommentsData = useEvent(
        (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingCommentsRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingCommentsRef.current = true;
            result.promise.then(
                () => {
                    isLoadingCommentsRef.current = false;
                },
                error => {
                    isLoadingCommentsRef.current = false;
                    setErrorState(error);
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                renderedRange = shiftRenderedRangeForComments(renderedRange);
                if (!renderedRange) return {isLoading: false};

                const view = assertExists(viewRef.current);

                const result = tryLoadingMessages({
                    viewHeight: view.getHeight(),
                    messages: comments,
                    range: renderedRange,
                    loadFromStart: async input => {
                        // We don't use `checkpoint` here since this is a partial load of data.
                        // `checkpoint` should represent a point in time at which we're fully synchronized
                        // with the server. We wouldn't want to jump `checkpoint` ahead for a load of new
                        // messages when in fact our previous messages are behind. Instead, while we're
                        // connected to the WebSocket we'll update `checkpoint` on every ping which is a
                        // much better indicator of "liveness" than last partial load time (which would be
                        // this `checkpoint`).
                        //
                        // We only use the `checkpoint` from `getTaskCommentsFromStart()` when initializing
                        // our `MessageList` from scratch (at which point it's not a partial load).
                        const {commentCount, comments, otherReferencedComments} =
                            await getTaskCommentsFromStart(context, {
                                taskId: possiblyGhostTaskId,
                                limit: input.limit,
                                afterCommentIndex: input.afterMessageIndex,
                                beforeCommentIndex: input.beforeMessageIndex,
                            });
                        return {
                            messageCount: commentCount,
                            messages: comments,
                            otherReferencedMessages: otherReferencedComments,
                        };
                    },
                    loadFromEnd: async input => {
                        const {commentCount, comments, otherReferencedComments} =
                            await getTaskCommentsFromEnd(context, {
                                taskId: possiblyGhostTaskId,
                                limit: input.limit,
                                afterCommentIndex: input.afterMessageIndex,
                                beforeCommentIndex: input.beforeMessageIndex,
                            });
                        return {
                            messageCount: commentCount,
                            messages: comments,
                            otherReferencedMessages: otherReferencedComments,
                        };
                    },
                });

                if (!result.isLoading) return {isLoading: false};

                return {
                    isLoading: true,
                    promise: result.promise.then(result => {
                        setComments(comments => comments.loadMessages(result));
                    }),
                };
            }
        },
    );

    // Whenever our list data changes, try loading more comments. In case our rendered
    // range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMoreCommentsData()` completes in
    // case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        comments;

        const view = assertExists(viewRef.current);
        tryLoadingMoreCommentsData(view.getRenderedRange());
    }, [comments, tryLoadingMoreCommentsData]);

    // Manages which comment `<MessageInput>` is currently replying to.
    const [commentInputParent, setCommentInputParent] =
        useState<MessageContentPayloadParent | null>(null);

    const {jumpState: commentsJumpState, jumpToMessageRange: jumpToCommentRange} =
        useJumpToMessageRange({
            viewRef,
            tryLoadingMoreData: tryLoadingMoreCommentsData,
            scrollToIndexForMessageIndex: (roomKey, index) => {
                if (!isCommentSectionVisible) return null;
                return (
                    1 +
                    (!isWideProjectLayout ? childrenGridViewItemCountRef.current : 0) +
                    1 +
                    index
                );
            },
        });

    useMessagingRealtime<TaskId, TaskCommentModel>({
        isConnected: isConnected && isCommentSectionVisible,
        messages: comments,
        onUpdateMessages: setComments,
        backfillMessages: useCallback(
            async ({
                checkpoint,
                clientMessageCount: clientCommentCount,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentCount: messageCount,
                    newComments: newMessages,
                    newOtherReferencedComments: newOtherReferencedMessages,
                    commentUpdatesResult: messageUpdatesResult,
                    typingStateByConnectionId,
                } = await procedures.backfillComments({
                    checkpoint,
                    clientCommentCount,
                    newCommentLimit,
                });

                return {
                    messageCount,
                    newMessages,
                    newOtherReferencedMessages,
                    messageUpdatesResult,
                    typingStateByConnectionId,
                };
            },
            [procedures],
        ),
        subscribeToEvents: useCallback(
            listener => {
                if (!isCommentSectionVisible) return noop;
                return subscribeToCommentsEvents(listener);
            },
            [isCommentSectionVisible, subscribeToCommentsEvents],
        ),
        subscribeToPongs: useCallback(
            listener => {
                if (!isCommentSectionVisible) return noop;
                return subscribeToPongs(listener);
            },
            [isCommentSectionVisible, subscribeToPongs],
        ),
    });

    // Manages the editable message.
    //
    // This is at the post list level because we want only one message to be editable
    // at a time.
    const {messageEditing: commentEditing, modals: commentEditingModals} =
        useMessageEditing<TaskId>({
            messageNoun: "comment",
            onUpdateMessageContent: async input => {
                await procedures.updateCommentContent({
                    commentIndex: input.messageIndex,
                    contentVersion: input.contentVersion,
                    steps: input.steps,
                });
            },
            onDeleteMessage: async input => {
                await procedures.deleteComment({
                    commentIndex: input.messageIndex,
                });
            },
        });

    if (!isCommentSectionVisible && commentEditing.state.isEditing) {
        commentEditing.dispatch({type: "CancelEditing"});
    }

    useScrollToNewMessages({
        viewRef,
        inputRef: commentInputRef,
        isInputStickyPositioned: true,
        messages: isCommentSectionVisible ? comments : null,
        getItemKey: useCallback(
            (item: MessageListItem<TaskCommentModel>) => getMessageListItemKey(item, null),
            [],
        ),
    });

    const handleSetCommentReaction: Memo<OnSetMessageReactionFunction<TaskId>> = useCallback(
        async (roomKey, input) => {
            await procedures.setCommentReaction({
                commentIndex: input.messageIndex,
                contentVersion: input.contentVersion,
                pos: input.pos,
                reaction: input.reaction,
            });
        },
        [procedures],
    );

    const handleDeleteCommentReaction: Memo<OnDeleteMessageReactionFunction<TaskId>> = useCallback(
        async (roomKey, input) => {
            await procedures.deleteCommentReaction({
                commentIndex: input.messageIndex,
                contentVersion: input.contentVersion,
                pos: input.pos,
            });
        },
        [procedures],
    );

    const handleUpdateCommentsOptimistically: Memo<
        OnUpdateMessagesOptimisticallyFunction<TaskId, TaskCommentModel>
    > = useCallback(
        (roomKey, promise, update) => {
            setCommentsOptimistically(promise, update);
        },
        [setCommentsOptimistically],
    );

    const commentsPointerToolbar = (
        <MessagingViewPointerToolbar<TaskId, TaskCommentModel>
            viewRef={viewRef}
            messageNoun="comment"
            getMessagesByRoomKey={useCallback(() => comments, [comments])}
            onReplyToMessagesRange={(roomKey, parent) => setCommentInputParent(parent)}
            onSetMessageReaction={handleSetCommentReaction}
            onDeleteMessageReaction={handleDeleteCommentReaction}
            onUpdateMessagesOptimistically={handleUpdateCommentsOptimistically}
        />
    );

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (initialScrollToCommentIndex !== null) {
            jumpToCommentRange({
                roomKey: possiblyGhostTaskId,
                startIndex: initialScrollToCommentIndex,
                endIndex: initialScrollToCommentIndex,
                start: null,
                end: null,
            });
        }

        if (!isWideProjectLayout) {
            const titleInput = assertExists(titleInputRef.current);

            if (shouldInitiallyFocus) {
                return scheduleAfterNavigationAnimation(() => {
                    titleInput.focusAll();
                });
            }
        } else {
            const projectDesktopHeader = assertExists(projectDesktopHeaderRef.current);

            if (shouldInitiallyFocus) {
                return scheduleAfterNavigationAnimation(() => {
                    projectDesktopHeader.editTitle();
                });
            }
        }
    }, [
        initialScrollToCommentIndex,
        isWideProjectLayout,
        jumpToCommentRange,
        layout,
        possiblyGhostTaskId,
        shouldInitiallyFocus,
        titleInputRef,
    ]);

    /* ========================================================================= *\
     *                                  Events                                   *
    \* ========================================================================= */

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

    /* ========================================================================= *\
     *                                   Misc                                    *
    \* ========================================================================= */

    // Checks if a user has confirmed a task can be completed
    const [taskCloseConfirmationState, setTaskCloseConfirmationState] = useState<{
        taskId: TaskId;
        onConfirm: () => void;
    } | null>(null);

    // TODO(calebmer): Should this be an account setting? This was added as local
    // storage before we had account settings.
    const [showDuplicateInstructionalModal, setShowDuplicateInstructionalModal] = useState(false);
    const [
        doNotShowDuplicationInstructionalModalAgain,
        setDoNotShowDuplicationInstructionalModalAgain,
    ] = useLocalStorage(
        "cyberworlds/doNotShowContentDuplicationInstructionalModalAgain",
        Schema.boolean,
        false,
    );

    const undoManager: TaskClientStoreUndoManager = useMemo(
        () => ({
            pushUndoStackEntry: ({undoActions, removedFromQueries, leaseId, release}) => {
                pushUndoStackEntry({
                    type: "Actions",
                    rootParentTaskId: possiblyGhostTaskId,
                    extra: null,
                    undoActions,
                    removedFromQueries,
                    leaseId,
                    release,
                });
            },
        }),
        [pushUndoStackEntry, possiblyGhostTaskId],
    );

    const commitActionTransaction = useCallback(
        (getActions: (taskId: TaskId) => Iterable<TaskActionModel>) => {
            if (!taskSubscription) {
                return commitActionTransactionAndCreateIfNeeded(
                    () => getActions(possiblyGhostTaskId),
                    {
                        undoManager,
                        affinityManager,
                    },
                );
            } else {
                return store.commitTaskActionTransaction(context, getActions(possiblyGhostTaskId), {
                    undoManager,
                    affinityManager,
                });
            }
        },
        [
            taskSubscription,
            commitActionTransactionAndCreateIfNeeded,
            undoManager,
            affinityManager,
            possiblyGhostTaskId,
            store,
            context,
        ],
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

    const titleCommitStateRef = useRef<{
        pendingActionTransactionBuilder: {
            add: (titleUpdate: TaskTitleUpdateModel) => void;
            commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
                finally: (callback: () => void) => void;
            };
        } | null;
    } | null>(null);

    const onTitleChange = useCallback(
        (titleUpdate: TaskTitleUpdateModel) => {
            // When our commit promise finishes, commit the pending update title action if
            // there is one.
            const handleCommitPromise = (commitPromise: {
                finally: (callback: () => void) => void;
            }) => {
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
            // action transaction builder. We'll commit the pending action after our current
            // action commits.
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
        },
        [
            affinityManager,
            commitActionTransaction,
            context,
            possiblyGhostTaskId,
            store,
            undoManager,
        ],
    );

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        `Task:${possiblyGhostTaskId}`,
        initialIsFavorite,
    );

    const menuActions = useMemo(() => {
        const menuActions: Array<ReadonlyArray<MenuAction>> = [];

        menuActions.push([
            {
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: "Couldn\u2019t copy task link",
                onPress: async () => {
                    // If the user tries to copy the link of a ghost task, then make sure the task is
                    // created before we write the URL to the clipboard.
                    if (!taskSubscription) {
                        await new Promise<void>(resolve =>
                            commitActionTransactionAndCreateIfNeeded(() => [], {
                                undoManager,
                                affinityManager,
                            }).finally(resolve),
                        );
                    }

                    const url = new URL(
                        `/s/${spaceId}/tasks/${possiblyGhostTaskId}`,
                        window.location.href,
                    );
                    await writeTextToClipboard(url.toString());
                },
            },
            ...(favoriteMenuAction ? [favoriteMenuAction] : []),
        ]);

        if (hasEditAccessLevel) {
            menuActions.push(
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
                        setTaskCloseConfirmationState({taskId: possiblyGhostTaskId, onConfirm});
                    },
                    commitActionTransaction,
                }),
            );

            const editMenuActions: Array<MenuAction> = [];
            menuActions.push(editMenuActions);

            if (isWideProjectLayout) {
                editMenuActions.push({
                    label: "Edit title",
                    onPress: () => assertExists(projectDesktopHeaderRef.current).editTitle(),
                });
            }

            editMenuActions.push({
                label: priorityInputState.isVisible ? "Edit priority" : "Add priority",
                onPress: () => focusPriorityInput({preventScroll: false}),
            });

            editMenuActions.push({
                label: dueDateInputState.isVisible ? "Edit due date" : "Add due date",
                onPress: () => focusDueDateInput({preventScroll: false}),
            });

            menuActions.push([
                {
                    label: "Undo",
                    keyboardShortcutHint: renderKeyboardShortcutHint(clientInfo, "mod", "z"),
                    onPress: undo,
                },
                {
                    label: "Redo",
                    keyboardShortcutHint: renderKeyboardShortcutHint(clientInfo, "mod", "y"),
                    onPress: redo,
                },
            ]);

            const lastMenuSectionActions: Array<MenuAction> = [];
            menuActions.push(lastMenuSectionActions);

            lastMenuSectionActions.push({
                label: "Duplicate",
                pressErrorTitle: "Couldn\u2019t duplicate task",
                onPress: async () => {
                    // Get the task's title text
                    const task = taskSubscription?.taskEntryStore.getSnapshot().task;
                    const titleText = task?.getTitle().getText() ?? "";

                    // Get the notes content
                    const notesContent = notesEditorStateStore.getSnapshot().editorState.getDoc();

                    // Extract variable schema from notes content and title
                    const schema = extractContentDuplicationVariableSchema(notesContent, {
                        additionalText: [titleText],
                    });

                    // If there are variables, navigate to the duplicate interstitial
                    const encodedSchema = encodeContentDuplicationVariableSchemaForUrl(schema);
                    if (encodedSchema !== null) {
                        const searchParams = new URLSearchParams();
                        searchParams.set("title", addFallbackToTaskTitle(titleText));
                        searchParams.set("schema", encodedSchema);

                        await navigate(
                            `/s/${spaceId}/tasks/${possiblyGhostTaskId}/duplicate?${searchParams.toString()}`,
                        );
                        return;
                    }

                    // Show the instructional modal if it hasn't been dismissed
                    if (!doNotShowDuplicationInstructionalModalAgain) {
                        setShowDuplicateInstructionalModal(true);
                        return;
                    }

                    const {taskId: newTaskId} = await store.duplicateTaskAndAllChildren(
                        context,
                        possiblyGhostTaskId,
                        timeZone,
                        {undoManager},
                    );

                    // Navigate to the new task. Always open in a peek on desktop. To make it clear
                    // when you're duplicating from a peek that the new task is a duplicate.
                    if (peekStackContext && platform !== "mobile") {
                        await peekStackContext.push(`/s/${spaceId}/tasks/${newTaskId}`);
                    } else {
                        await navigate(`/s/${spaceId}/tasks/${newTaskId}`);
                    }
                },
            });

            if (hasEditAccessLevel) {
                lastMenuSectionActions.push({
                    hasChildren: true,
                    key: "layout",
                    label: "Turn into",
                    placement: "left",
                    actions: [
                        {
                            label: "Task",
                            isSelected: layout === null,
                            onPress: () => {
                                if (layout === null) return;

                                commitActionTransaction(taskId => [
                                    {
                                        type: "UpdateTask",
                                        time: store.clock.now(),
                                        taskId,
                                        taskAction: {type: "UpdateLayout", layout: null},
                                    },
                                ]);
                            },
                        },
                        {
                            label: "Project",
                            isSelected: layout === "Project",
                            pressErrorTitle: "Couldn\u2019t turn into project",
                            onPress: async () => {
                                let isNavigatingToGhostTask = false;

                                if (platform === "desktop" && routeLayout !== "wide") {
                                    let createSearchParam = searchParams.get("create");

                                    // If this is a ghost task then we want to navigate to a ghost task that has
                                    // `layout: "Project"` in its initial fields.
                                    if (createSearchParam !== null) {
                                        const [
                                            oldCreateSearchParamFilters = "",
                                            createSearchParamParentTaskId = "",
                                        ] = createSearchParam.split(" ", 2);

                                        const filters: Array<TaskQueryFilter> = [
                                            ...(oldCreateSearchParamFilters.length > 0
                                                ? deserializeTaskQueryFiltersSearchParam(
                                                      oldCreateSearchParamFilters,
                                                  )
                                                : []),
                                            {
                                                type: "Layout",
                                                operation: {
                                                    type: "OneOf",
                                                    layouts: ["Project"],
                                                },
                                            },
                                        ];

                                        const newCreateSearchParamFilters =
                                            serializeTaskQueryFiltersSearchParam(filters);

                                        createSearchParam =
                                            createSearchParamParentTaskId.length > 0
                                                ? // "+" when URL decoded becomes a space (" ")
                                                  `${newCreateSearchParamFilters}+${createSearchParamParentTaskId}`
                                                : newCreateSearchParamFilters;

                                        isNavigatingToGhostTask = true;
                                    }

                                    await rootNavigate(
                                        `/s/${space.id}/tasks/${possiblyGhostTaskId}${createSearchParam ? `?create=${createSearchParam}&focus` : ""}`,
                                    );
                                }

                                if (layout !== "Project" && !isNavigatingToGhostTask) {
                                    commitActionTransaction(taskId => [
                                        {
                                            type: "UpdateTask",
                                            time: store.clock.now(),
                                            taskId,
                                            taskAction: {type: "UpdateLayout", layout: "Project"},
                                        },
                                    ]);
                                }
                            },
                        },
                    ],
                });
            }

            lastMenuSectionActions.push({
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
                        taskId: possiblyGhostTaskId,
                        // Close the detail view (if this is in a peek we navigate back) before deleting
                        // the task so we don't flash the `<TaskDetailView>` deleted state.
                        onBeforeDelete: () => navigate(-1),
                    });
                },
            });
        }

        return menuActions;
    }, [
        favoriteMenuAction,
        hasEditAccessLevel,
        taskSubscription,
        spaceId,
        possiblyGhostTaskId,
        commitActionTransactionAndCreateIfNeeded,
        undoManager,
        affinityManager,
        timeZone,
        currentAccount,
        store,
        displayStatus,
        commitActionTransaction,
        isWideProjectLayout,
        priorityInputState.isVisible,
        dueDateInputState.isVisible,
        clientInfo,
        undo,
        redo,
        initialFields.assignee?.id,
        focusPriorityInput,
        focusDueDateInput,
        notesEditorStateStore,
        doNotShowDuplicationInstructionalModalAgain,
        context,
        peekStackContext,
        platform,
        navigate,
        layout,
        routeLayout,
        searchParams,
        rootNavigate,
        space.id,
        reporter,
    ]);

    const hasManageAccessLevel = useMemo(
        () => hasAccessLevel(accessLevel, "Manage"),
        [accessLevel],
    );
    const taskEntityNoun = layout === "Project" ? "project" : "task";

    const projectDesktopHeaderRef = useRef<TaskProjectDetailViewDesktopHeaderRef>(null);

    // Don't render the share button if the account doesn't have space access. They
    // won't be allowed to see the names of accounts in the share dialog.
    const shareButton: NavigationBarShareButtonProps | undefined = currentAccount
        ? {
              entityNoun: taskEntityNoun,
              entityId: `Task:${possiblyGhostTaskId}`,
              accessPolicy: immediateAccessPolicy,
              inherited: {
                  accessPolicy: inheritedAccessPolicy,
                  explanations: createTaskDetailViewInheritedAccessPolicyExplanations({
                      space,
                      taskSubscription,
                  }),
              },
              onAccessPolicyChange: (notification, accessPolicy) => {
                  commitActionTransactionAndCreateIfNeeded(
                      () => {
                          const action: TaskActionModel = {
                              type: "UpdateTask",
                              time: store.clock.now(),
                              taskId: possiblyGhostTaskId,
                              taskAction: {
                                  type: "UpdateAccessPolicy",
                                  accessPolicy,
                              },
                          };
                          return [action];
                      },
                      {
                          // Don't allow undoing changes to the access policy.
                          undoManager: null,
                          affinityManager,
                          // Include a notification if the user decided to configure one.
                          updateAccessPolicyShareNotification: notification ?? undefined,
                      },
                  );
              },
              isReadOnly: !hasManageAccessLevel,
              onCopyLink: async () => {
                  // If the user tries to copy the link of a ghost task, then make sure the task is
                  // created before we write the URL to the clipboard.
                  if (!taskSubscription) {
                      await new Promise<void>(resolve =>
                          commitActionTransactionAndCreateIfNeeded(() => [], {
                              undoManager,
                              affinityManager,
                          }).finally(resolve),
                      );
                  }

                  const url = new URL(
                      `/s/${spaceId}/tasks/${possiblyGhostTaskId}`,
                      window.location.href,
                  );
                  await writeTextToClipboard(url.toString());
              },
              activationHint: shareActivationHint,
              onActivationHintHide: onShareActivationHintHide,
          }
        : undefined;

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: isWideProjectLayout,
        title: (
            <TaskDetailViewNavigationBarTitle
                taskSubscription={taskSubscription}
                isReadOnly={!hasEditAccessLevel}
                onTitleChange={onTitleChange}
            />
        ),
        desktopTitleLeftSlop: "1",
        getTitleBoundaryElement: useMemo(() => {
            if (isWideProjectLayout) return;
            return () => assertExists(titleBoundaryRef.current);
        }, [isWideProjectLayout]),
        titleBoundaryMarginTop: spacing["4"],
        menuActions,
        contextMenuActions: menuActions,
        desktopMaxWidth: contentStyles.contentMaxWidth,
        desktopControls: (
            <TaskDetailViewStatusButton
                elementRef={statusButtonRef}
                size={taskDetailViewStatusButtonSize[platformRouteLayout]}
                store={store}
                taskSubscription={taskSubscription}
                initialFields={initialFields}
                isReadOnly={!hasEditAccessLevel}
                commitActionTransaction={commitActionTransaction}
            />
        ),
        defaultPreviousRoute: () => {
            const task = taskSubscription?.taskEntryStore.getSnapshot().task;

            if (task) {
                const collections = task.getCollections().getArray();

                // If the task is in at least one collection, use the first collection as the back
                // path
                if (collections[0]?.collectionId) {
                    const firstCollectionId = collections[0].collectionId;
                    return `/s/${spaceId}/tasks/collections/${firstCollectionId}`;
                }
            }

            // Otherwise, use the "my tasks" view as the default back path
            return `/s/${spaceId}/tasks`;
        },
        shareButton,
    });

    const commentsFileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "TaskComments", taskId: possiblyGhostTaskId}),
        [possiblyGhostTaskId],
    );

    const itemCount =
        1 +
        (!isWideProjectLayout ? childrenGridViewItemCount : 0) +
        (isCommentSectionVisible ? 1 + comments.getItemCount() + 1 : 0);

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
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
                    minHeight: !isWideProjectLayout
                        ? taskDetailViewMainMinHeightPx[spacingScale]
                        : taskProjectDetailViewMainMinHeightPx[spacingScale],
                    node: (
                        <TaskDetailViewMainMemo
                            ref={mainRef}
                            viewRef={viewRef}
                            possiblyGhostTaskId={possiblyGhostTaskId}
                            store={store}
                            taskSubscription={taskSubscription}
                            initialFields={initialFields}
                            hasEditAccessLevel={hasEditAccessLevel}
                            focusChildrenGridViewStart={focusChildrenGridViewStart}
                            pushUndoStackEntry={pushUndoStackEntry}
                            pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                            pushRedoStackEntry={pushRedoStackEntry}
                            menuActions={menuActions}
                            statusButtonRef={statusButtonRef}
                            titleInputRef={titleInputRef}
                            titleBoundaryRef={titleBoundaryRef}
                            onTitleChange={onTitleChange}
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
                            ensureCreateTask={ensureCreateTask}
                        />
                    ),
                };
            }

            index -= 1;

            if (!isWideProjectLayout) {
                if (index < childrenGridViewItemCount) {
                    return renderChildrenGridViewItem(index);
                }

                index -= childrenGridViewItemCount;
            }

            if (!isCommentSectionVisible) {
                throw new InternalError(
                    "Comment section isn\u2019t visible, can\u2019t render items after child task grid view",
                );
            }

            if (index === 0) {
                // This height is calculated so that in a task that doesn't have any additional
                // fields or subtasks we perfectly render the comment input at the bottom of the
                // peek.
                const height = !isWideProjectLayout
                    ? taskDetailViewCommentSectionHeaderHeightPx[platform][spacingScale]
                    : taskProjectDetailViewCommentSectionHeaderHeightPx[spacingScale];

                const commentCount = comments.getMessageCountIncludingOptimisticMessages();

                return {
                    key: "TaskCommentSectionHeader",
                    minHeight: height,
                    // We want a higher z-index than `<TaskCommentInput>` (`z-index: 20`) so when
                    // `<TaskCommentInput>` is replying to some text and so has a border that renders
                    // on top of the input when scrolled to the top the border renders under our task
                    // comment section header.
                    //
                    // This is a little hacky since we only use `z-index: 30` if there's a parent. When
                    // there's not a parent, we want the `<TaskCommentInput>`s toolbar to render over
                    // the comment section header ([otherwise we get this bug][1]). When there's a
                    // parent, coincidentally the toolbar doesn't render outside the bounds of the
                    // `<TaskCommentInput>` so the comment header <> toolbar overlap case isn't
                    // possible.
                    //
                    // [1]:
                    //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/cbx1taekdm9vmzj1hqj4xb57ym
                    zIndex: commentInputParent ? "30" : undefined,
                    node: (
                        <Box
                            display="flex"
                            justifyContent="center"
                            alignItems="flex-end"
                            backgroundColor="grey-0"
                            style={{height}}
                        >
                            <Box
                                width="full"
                                maxWidth={contentStyles.contentMaxWidth}
                                paddingX={screenPaddingX}
                            >
                                <Box
                                    fontSize={
                                        !isWideProjectLayout
                                            ? taskDetailViewFieldLabelFontSize
                                            : taskGridViewColumnHeaderLabelFontSize
                                    }
                                    color={
                                        !isWideProjectLayout
                                            ? taskDetailViewFieldLabelColor
                                            : taskGridViewColumnHeaderLabelColor
                                    }
                                >
                                    Comments
                                    {commentCount > 100
                                        ? ` ∙ 100+`
                                        : commentCount > 0
                                          ? ` ∙ ${commentCount}`
                                          : ""}
                                </Box>
                                <Spacer
                                    space={
                                        !isWideProjectLayout
                                            ? taskDetailViewSubtasksFieldLabelPaddingBottom
                                            : taskGridViewColumnHeaderLabelMarginBottom
                                    }
                                />
                                <Box width="full" borderBottom="grey-5" />
                            </Box>
                        </Box>
                    ),
                    // Always render the task comment input once the comment section is visible.
                    renderAdditionalItemIndexes: [itemCount - 1],
                };
            }

            index -= 1;

            const commentsItemCount = comments.getItemCount();

            if (index < commentsItemCount) {
                const item = comments.getItem(index);

                const renderedItem = renderMessageListItem<TaskId, TaskCommentModel>({
                    spacingScale,
                    messageNoun: "comment",
                    messages: comments,
                    groupKey: null,
                    index,
                    item,
                    fileAttachmentTarget: commentsFileAttachmentTarget,
                    randomSeedForShimmer: possiblyGhostTaskId,
                    messageEditing: commentEditing,
                    jumpState:
                        item.message &&
                        !item.message.isOptimistic &&
                        commentsJumpState &&
                        commentsJumpState.options.startIndex <= item.message.index &&
                        item.message.index <= commentsJumpState.options.endIndex
                            ? commentsJumpState.messages[
                                  item.message.index - commentsJumpState.options.startIndex
                              ]!
                            : null,
                    onJumpToMessageRange: jumpToCommentRange,
                    onReplyToMessage: message => {
                        setCommentInputParent({
                            type: "Message",
                            index: message.index,
                        });
                    },
                    onDeleteMessage: async message => {
                        await procedures.deleteComment({
                            commentIndex: message.index,
                        });
                    },
                    getMessageUrl: commentIndex => {
                        return new URL(
                            `/s/${spaceId}/tasks/${possiblyGhostTaskId}?comment=${commentIndex}`,
                            window.location.href,
                        );
                    },
                    onSetMessageReaction: handleSetCommentReaction,
                    onDeleteMessageReaction: handleDeleteCommentReaction,
                    onUpdateMessagesOptimistically: handleUpdateCommentsOptimistically,
                    shouldAddMarginTop: index === 0 ? postContentViewCommentMargin : false,
                    shouldAddMarginBottom: index === commentsItemCount - 1,
                    render: node => (
                        <div
                            className={sprinkles({
                                display: "flex",
                                justifyContent: "center",
                            })}
                        >
                            <div
                                className={sprinkles({
                                    width: "full",
                                    maxWidth: contentStyles.contentMaxWidth,
                                })}
                            >
                                {node}
                            </div>
                        </div>
                    ),
                });

                // `renderAdditionalItemIndexes` is always empty (the type system assures us of
                // this) so we can ignore it here
                cast<readonly [] | undefined>(renderedItem.renderAdditionalItemIndexes);

                return {
                    ...renderedItem,
                    // Always render the task comment input once the comment section is visible.
                    renderAdditionalItemIndexes: [itemCount - 1],
                };
            }

            index -= commentsItemCount;

            if (index === 0) {
                // This is defined out here so that it doesn't re-rerender every time the
                // `render()` function is called since it's referentially stable.
                const inputNode = (
                    <TaskCommentInput
                        isGhostTask={!taskSubscription}
                        inputRef={commentInputRef}
                        procedures={procedures}
                        fileAttachmentTarget={commentsFileAttachmentTarget}
                        comments={comments}
                        onUpdateComments={setComments}
                        commentEditing={commentEditing}
                        parent={commentInputParent}
                        onParentClear={() => setCommentInputParent(null)}
                        onJumpToCommentRange={jumpToCommentRange}
                        ensureCreateTask={ensureCreateTask}
                    />
                );

                return {
                    key: "TaskCommentInput",
                    minHeight: messageInputMinHeightPx[platform][spacingScale],
                    withManualLayout: true,
                    render: ({
                        ref,
                        offset,
                        height,
                        shouldRenderWithRelativePositioning,
                        getPositionByIndex,
                        viewHeight,
                    }) => {
                        const headerPosition = getPositionByIndex(
                            itemCount - 1 - commentsItemCount - 1,
                        );

                        const headerOffsetEnd = headerPosition.offset + headerPosition.height;

                        return (
                            <div
                                style={{
                                    pointerEvents: "none",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "flex-end",
                                    zIndex: "20",
                                    ...(!shouldRenderWithRelativePositioning
                                        ? {
                                              position: "absolute",
                                              top: headerOffsetEnd,
                                              left: "0",
                                              right: "0",
                                              height:
                                                  offset -
                                                  headerOffsetEnd +
                                                  height +
                                                  // Increase space occupied by `position: sticky` track so we pin comment input to
                                                  // the bottom of the screen.
                                                  Math.max(0, viewHeight - offset - height),
                                          }
                                        : {
                                              position: "relative",
                                          }),
                                }}
                            >
                                <div
                                    ref={ref}
                                    style={
                                        !shouldRenderWithRelativePositioning
                                            ? {position: "sticky", bottom: "0"}
                                            : undefined
                                    }
                                    className={sprinkles({
                                        width: "full",
                                        display: "flex",
                                        justifyContent: "center",
                                    })}
                                >
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            maxWidth: contentStyles.contentMaxWidth,
                                            position: "relative",
                                            pointerEvents: "auto",
                                        })}
                                    >
                                        {inputNode}
                                    </div>
                                </div>
                            </div>
                        );
                    },
                };
            }

            throw new OutOfRangeError("Task detail view render item index out of bounds");
        },
        [
            isWideProjectLayout,
            isCommentSectionVisible,
            comments,
            spacingScale,
            possiblyGhostTaskId,
            store,
            taskSubscription,
            initialFields,
            hasEditAccessLevel,
            focusChildrenGridViewStart,
            pushUndoStackEntry,
            pushUndoStackEntryFromRedo,
            pushRedoStackEntry,
            menuActions,
            onTitleChange,
            priorityInputState.isVisible,
            focusPriorityInput,
            dueDateInputState.isVisible,
            focusDueDateInput,
            notesEditorStateStore,
            onNotesEditorStateChange,
            reconnectNotesClient,
            commitActionTransaction,
            ensureCreateTask,
            childrenGridViewItemCount,
            renderChildrenGridViewItem,
            platform,
            commentInputParent,
            itemCount,
            commentsFileAttachmentTarget,
            commentEditing,
            commentsJumpState,
            jumpToCommentRange,
            handleSetCommentReaction,
            handleDeleteCommentReaction,
            handleUpdateCommentsOptimistically,
            procedures,
            spaceId,
            setComments,
        ],
    );

    const scrollViewNode = (
        <VirtualizedScrollView
            ref={viewRef}
            elementRef={scrollViewRef}
            scrollbarInsetTop={scrollbarInsetTop}
            stateKey={!isWideProjectLayout ? childrenGridViewStateKey : undefined}
            bufferedItemHeight={bufferedMessageViewHeight}
            itemCount={itemCount}
            alwaysRenderAdditionalItemIndexes={useMemo(
                () => [
                    // Always render `<TaskDetailViewMain>` regardless of where we've scrolled. We can
                    // return focus there at any moment.
                    0,
                    ...(!isWideProjectLayout
                        ? alwaysRenderChildrenGridViewItemIndexes.map(index => index + 1)
                        : []),
                ],
                [alwaysRenderChildrenGridViewItemIndexes, isWideProjectLayout],
            )}
            scrollbarInsetTopItemIndex={
                !isWideProjectLayout && scrollbarInsetTopChildrenGridViewItemIndex !== undefined
                    ? scrollbarInsetTopChildrenGridViewItemIndex + 1
                    : undefined
            }
            scrollbarInsetBottomItemIndex={isCommentSectionVisible ? itemCount - 1 : undefined}
            renderItem={renderItem}
            onRenderedRangeChange={range => {
                if (!isWideProjectLayout) {
                    onChildrenGridViewRenderedRangeChange(
                        shiftRenderedRangeForChildrenGridView(range),
                    );
                }

                tryLoadingMoreCommentsData(range);
            }}
            onRenderedRangeLayoutChange={range => {
                if (!isWideProjectLayout) {
                    onChildrenGridViewRenderedRangeLayoutChange(
                        shiftRenderedRangeForChildrenGridView(range),
                    );
                }
            }}
            extraChildren={
                <>
                    {navigationBar}
                    {isCommentSectionVisible && commentsPointerToolbar}
                </>
            }
        />
    );

    let node = scrollViewNode;

    if (routeLayout === "wide" && layout !== "Project") {
        node = (
            <Box
                flexGrow="1"
                position="relative"
                width="full"
                height="full"
                overflow="hidden"
                style={{paddingLeft: spaceLayoutStyles.sideBarSpace}}
            >
                {scrollViewNode}
            </Box>
        );
    }

    if (isWideProjectLayout) {
        node = (
            <Box
                flexGrow="1"
                position="relative"
                width="full"
                height="full"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                style={{paddingLeft: spaceLayoutStyles.sideBarWidth}}
            >
                <TaskProjectDetailViewDesktopHeader
                    ref={projectDesktopHeaderRef}
                    store={store}
                    taskSubscription={taskSubscription}
                    initialFields={initialFields}
                    isReadOnly={!hasEditAccessLevel}
                    onTitleChange={onTitleChange}
                    statusButtonRef={statusButtonRef}
                    commitActionTransaction={commitActionTransaction}
                    menuActions={menuActions}
                    shareButton={shareButton}
                    queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                    defaultOrderSentence={defaultOrderSentence}
                    filters={filters}
                    filterReferences={filterReferences}
                    onFiltersChange={updateFilters}
                    sorts={sorts}
                    onSortsChange={setSorts}
                />
                <Box
                    flexGrow="1"
                    position="relative"
                    height="full"
                    overflow="hidden"
                    display="flex"
                    flexDirection="row"
                    justifyContent="center"
                >
                    <ContentBlockWidthContextProvider width="1/4" maxWidth="96">
                        <Box
                            flexShrink="0"
                            position="relative"
                            height="full"
                            width="1/4"
                            maxWidth="96"
                            paddingTop={taskGridViewColumnHeaderHeight}
                        >
                            <Box
                                position="absolute"
                                top="0"
                                left="0"
                                right="0"
                                height={taskGridViewColumnHeaderHeight}
                                pointerEvents="none"
                            >
                                <Box
                                    paddingLeft={screenPaddingX}
                                    paddingBottom={taskGridViewColumnHeaderLabelMarginBottom}
                                    color={taskGridViewColumnHeaderLabelColor}
                                    fontSize={taskGridViewColumnHeaderLabelFontSize}
                                >
                                    Project
                                </Box>
                                <Box
                                    position="absolute"
                                    left="0"
                                    right="0"
                                    height="border"
                                    display="flex"
                                    style={{bottom: -1}}
                                >
                                    <Box width={screenPaddingX} backgroundColor="grey-0" />
                                    <Box flexGrow="1" backgroundColor="grey-5-translucent" />
                                    <Box width={screenPaddingX} backgroundColor="grey-0" />
                                </Box>
                            </Box>
                            <BottomBarFrameContextProvider
                            // Bottom bar changes from the comment input shouldn't scroll of the projects
                            // subtask scroll view on the right.
                            >
                                <TaskProjectDetailViewWrapper viewRef={viewRef}>
                                    {scrollViewNode}
                                </TaskProjectDetailViewWrapper>
                            </BottomBarFrameContextProvider>
                        </Box>
                    </ContentBlockWidthContextProvider>
                    <VirtualizedScrollView
                        ref={projectChildrenViewRef}
                        stateKey={childrenGridViewStateKey}
                        bufferedItemHeight={childrenGridViewBufferedItemHeight}
                        itemCount={childrenGridViewItemCount}
                        renderItem={renderChildrenGridViewItem}
                        alwaysRenderAdditionalItemIndexes={alwaysRenderChildrenGridViewItemIndexes}
                        scrollbarInsetTopItemIndex={scrollbarInsetTopChildrenGridViewItemIndex}
                        onRenderedRangeChange={onChildrenGridViewRenderedRangeChange}
                        onRenderedRangeLayoutChange={onChildrenGridViewRenderedRangeLayoutChange}
                    />
                </Box>
                {hasEditAccessLevel && (
                    <TaskFloatingCreateButton
                        filters={filters}
                        parentTaskId={possiblyGhostTaskId}
                    />
                )}
            </Box>
        );
    }

    return (
        <>
            {childrenGridViewModals}
            {commentEditingModals}
            <GlobalKeyDownEvent onGlobalKeyDown={onChildrenGridViewGlobalKeyDown}>
                {node}
            </GlobalKeyDownEvent>
            {taskCloseConfirmationState && (
                <TaskCloseConfirmationModalDialog
                    store={store}
                    taskId={taskCloseConfirmationState.taskId}
                    onClose={() => setTaskCloseConfirmationState(null)}
                    onConfirm={taskCloseConfirmationState.onConfirm}
                />
            )}
            {showDuplicateInstructionalModal && (
                <ContentDuplicationInstructionalModal
                    noun={taskEntityNoun}
                    onDuplicate={async () => {
                        const {taskId: newTaskId} = await store.duplicateTaskAndAllChildren(
                            context,
                            possiblyGhostTaskId,
                            timeZone,
                            {undoManager},
                        );

                        // Navigate to the new task. Always open in a peek on desktop. To make it clear
                        // when you're duplicating from a peek that the new task is a duplicate.
                        if (peekStackContext && platform !== "mobile") {
                            await peekStackContext.push(`/s/${spaceId}/tasks/${newTaskId}`);
                        } else {
                            await navigate(`/s/${spaceId}/tasks/${newTaskId}`);
                        }
                    }}
                    onClose={() => setShowDuplicateInstructionalModal(false)}
                    doNotShowAgain={doNotShowDuplicationInstructionalModalAgain}
                    onDoNotShowAgainChange={setDoNotShowDuplicationInstructionalModalAgain}
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
        viewRef,
        possiblyGhostTaskId,
        store,
        taskSubscription,
        initialFields,
        hasEditAccessLevel,
        focusChildrenGridViewStart,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        menuActions,
        statusButtonRef,
        titleInputRef,
        titleBoundaryRef,
        onTitleChange,
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
        ensureCreateTask,
    }: {
        viewRef: RefObject<VirtualizedScrollViewRef | null>;
        possiblyGhostTaskId: TaskId;
        store: TaskClientStore;
        taskSubscription: TaskClientTaskSubscription | null;
        initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
        hasEditAccessLevel: boolean;
        focusChildrenGridViewStart: Memo<() => void>;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        menuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
        statusButtonRef: RefObject<HTMLElement | null>;
        titleInputRef: RefObject<TaskDetailTitleInputRef | null>;
        titleBoundaryRef: RefObject<HTMLDivElement | null>;
        onTitleChange: Memo<(titleUpdate: TaskTitleUpdateModel) => void>;
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
        ensureCreateTask: Memo<() => Promise<void>>;
    },
    ref: Ref<TaskDetailViewMainRef>,
) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
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
                initialFields.collectionSubscriptionById.size,
            );

            return TaskCollectionSet.from(
                mapIterable(
                    initialFields.collectionSubscriptionById.keys(),
                    (collectionId, collectionIndex) => [
                        collectionId,
                        new TaskCollectionSet.ValueRegister(
                            collectionOrderKeys[collectionIndex]!,
                            zeroHybridLogicalTime,
                        ),
                    ],
                ),
            );
        }

        return task?.getCollections() ?? TaskCollectionSet.empty;
    }, [initialFields.collectionSubscriptionById, task, taskSubscription]);

    const layout = taskSubscription ? (task?.getLayout() ?? null) : initialFields.layout;
    const isWideProjectLayout = layout === "Project" && routeLayout === "wide";

    // Naming nit: An "input" is some editable component without a label. A "field" is
    // the combination of both a label and an input.
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
                if (isWideProjectLayout) return;

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
        [
            focusDueDateInput,
            focusPriorityInput,
            isWideProjectLayout,
            statusButtonRef,
            titleInputRef,
        ],
    );

    const childTaskCount = task?.getChildTaskCount() ?? 0;

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
                    // On mobile, create some space for the navigation bar since it's back button will
                    // conflict with the status button.
                    <Spacer space={navigationBarHeight} />
                )}
                {isWideProjectLayout ? (
                    <Spacer space={taskProjectDetailViewMarginTop} />
                ) : (
                    <ContextMenuActions actions={menuActions}>
                        <Box
                            position="relative"
                            paddingX={screenPaddingX}
                            style={{paddingBottom: taskDetailViewHeaderMarginBottom}}
                        >
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
                            <Box ref={titleBoundaryRef}>
                                <TaskDetailViewParentBreadcrumbs
                                    task={task}
                                    taskSubscription={taskSubscription}
                                    initialFields={initialFields}
                                />
                                <TaskDetailTitleInput
                                    ref={titleInputRef}
                                    isReadOnly={!hasEditAccessLevel}
                                    title={title}
                                    onTitleChange={onTitleChange}
                                    placeholder={taskFallbackTitle}
                                />
                            </Box>
                            {task && (childTaskCount > 0 || layout === "Project") && (
                                <TaskDetailViewChildTasksButton viewRef={viewRef} task={task} />
                            )}
                        </Box>
                    </ContextMenuActions>
                )}
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
                                    // Currently, accounts without space access can't edit tasks. The max permission
                                    // level of `urlGrant` is `View`.
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
                    isWideProjectLayout={isWideProjectLayout}
                    isReadOnly={!hasEditAccessLevel}
                    pushUndoStackEntry={pushUndoStackEntry}
                    pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                    pushRedoStackEntry={pushRedoStackEntry}
                    notesEditorStateStore={notesEditorStateStore}
                    onNotesEditorStateChange={onNotesEditorStateChange}
                    reconnectNotesClient={reconnectNotesClient}
                    ensureCreateTask={ensureCreateTask}
                />
                {!isWideProjectLayout && (
                    <>
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
                                <Box fontSize={taskDetailViewFieldLabelFontSize}>
                                    {layout === "Project" ? "Tasks" : "Subtasks"}
                                    {childTaskCount > 100
                                        ? ` ∙ 100+`
                                        : childTaskCount > 0
                                          ? ` ∙ ${childTaskCount}`
                                          : ""}
                                </Box>
                            </span>
                        </Box>
                    </>
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

    const touchSlop = useTouchSlop(taskDetailViewDenseFieldMinHeight);

    return (
        // Doesn't have a parent to horizontally align elements since we layout fields with
        // CSS grid.
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
                    // As an affordance for mouse users, when the label is clicked we focus the first
                    // element in the input.
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

function TaskDetailViewChildTasksButton({
    viewRef,
    task,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef | null>;
    task: TaskModel;
}) {
    return (
        <Box
            position="absolute"
            marginX="-1.5"
            style={{
                bottom: subtractRemLengths(taskDetailViewHeaderMarginBottom, "5", "0.5"),
            }}
        >
            <Button
                isDisabled={task.getLayout() === "Project"}
                height="5"
                paddingX="1.5"
                onPress={() => {
                    const view = assertExists(viewRef.current);

                    const spacingScale = getSpacingScaleWithoutListening();
                    const {offset, height} = view.getPositionByIndex(0);

                    // Scroll to the first child task. The virtualized list has `<TaskDetailViewMain>`
                    // as the first item then after that is all the child tasks. If there are no child
                    // tasks this will be the first ghost task.
                    const scrollOffset =
                        offset +
                        height -
                        getElementSafeAreaInsetTopPx(view.getContentElement()) -
                        convertRemLengthToPx(
                            addRemLengths(navigationBarHeight, "32"),
                            spacingScale,
                        );

                    view.setScrollOffset(scrollOffset, {behavior: "instant"});
                }}
            >
                <Box as="span" display="flex" alignItems="center" gap="1">
                    <TaskChildTasksProgressWheel
                        childTaskCount={task.getChildTaskCount()}
                        closedChildTaskCount={task.getClosedChildTaskCount()}
                    />
                    <Box as="span" color="grey-70">
                        {task.getClosedChildTaskCount()}/{task.getChildTaskCount()}{" "}
                    </Box>
                </Box>
            </Button>
        </Box>
    );
}

function TaskDetailViewStatusButton({
    size,
    store,
    taskSubscription,
    initialFields,
    isReadOnly,
    elementRef,
    menuActions,
    commitActionTransaction,
}: {
    size: "6" | "7";
    store: TaskClientStore;
    taskSubscription: TaskClientTaskSubscription | null;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
    isReadOnly: boolean;
    elementRef: RefObject<HTMLElement | null>;
    menuActions?: ReadonlyArray<ReadonlyArray<MenuAction>>;
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

    if (menuActions) {
        node = <ContextMenuActions actions={menuActions}>{node}</ContextMenuActions>;
    }

    return node;
}

function createDefaultTaskAccessPolicyForOptionalCurrentAccount(
    currentAccount: AccountModel | null,
): AccessPolicy {
    if (!currentAccount) {
        return {accountGrantById: emptyMap, defaultGrant: null, urlGrant: null};
    }

    return createDefaultTaskAccessPolicy(currentAccount.id);
}

function TaskProjectDetailViewWrapper({
    viewRef,
    children,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef | null>;
    children: ReactElement;
}) {
    // There's a `useScrollToAvoidBottomBarsAndMobileKeyboard()` call in
    // `useTaskGridViewVirtualizedList()` that has us covered for non-project layouts.
    // However, in a project layout where we have two scroll views we need two
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` calls. One to manage the task
    // grid view on the right and on to manage the task details (with comment section)
    // on the left.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        getAnchorPosition: useEvent(oldVisibleRect => ({
            top: oldVisibleRect.bottom,
            height: 0,
            isPinned: true,
        })),
    });

    return children;
}
