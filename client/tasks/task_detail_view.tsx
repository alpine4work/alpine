import {setInteractionModality} from "@react-aria/interactions";
import {CaretRight, ChatCircleDots, IconContext, Lock, Trash} from "phosphor-react";
import {redo as redoCommand, undo as undoCommand} from "prosemirror-history";
import {
    Memo,
    ReactNode,
    Ref,
    RefObject,
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
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {MenuAction} from "~/client/design/menu.js";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useTouchSlop} from "~/client/design/use_touch_slop.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {PencilSimpleSlashIcon} from "~/client/icons/pencil_simple_slash_icon.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles, invertSelectionColorsClassName, sprinkles} from "~/client/styles/styles.js";
import {
    desktopTaskDetailViewNavigationBarSpacerMarginBottom,
    desktopTaskDetailViewStatusButtonSize,
    mobileTaskDetailViewStatusButtonPaddingBottom,
    mobileTaskDetailViewStatusButtonPaddingTop,
    mobileTaskDetailViewStatusButtonSize,
    taskDetailViewDenseFieldGap,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewSectionGap,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {
    computeTaskEntryAccess,
    createTaskEntryAccessStore,
} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActionsWithoutFullTask} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/internal/task_assignee_input.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {TaskCloseConfirmationModalDialog} from "~/client/tasks/internal/task_close_confirmation_modal_dialog.js";
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
import {
    TaskGridViewVirtualizedListViewRef,
    useTaskGridViewVirtualizedList,
} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskPriorityInput} from "~/client/tasks/internal/task_priority_input.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Context} from "~/shared/context/context.js";
import {convertRemLengthToPx, screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    addFallbackToTaskTitle,
    emptyTaskTitleModel,
    taskFallbackTitle,
} from "~/shared/tasks/model/task_title_model.js";
import {hasTaskCollectionAccessLevel} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

const taskDetailViewReadOnlyReasonStickyBannerHeight = "8";

export function TaskDetailView({
    withMobileLayout,
    taskSubscription,
    childrenQuery,
    affinityManager,
    initialChildrenGridViewExpansionState,
    notesClient,
}: {
    withMobileLayout: boolean;
    taskSubscription: TaskClientTaskSubscription;
    childrenQuery: TaskClientQuery;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    notesClient: TaskDetailNotesContentEditorWebSocketClient;
}) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const context = useAppContext();
    const {timeZone, isAppleDevice} = useClientInfo();
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
                                icon: <PencilSimpleSlashIcon />,
                                message: "You’ve lost access to this task. You can’t make changes",
                            };
                        }
                        case "PermissionGranted": {
                            if (hasTaskCollectionAccessLevel(access.level, "Edit")) return null;

                            // TODO(calebmer): If the user removed their own access by removing a
                            // collection or changing the assignee, we should hint to them that they're
                            // allowed to undo and give them an undo button.
                            return {
                                icon: <PencilSimpleSlashIcon />,
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
            getElement: () => assertExists(viewRef.current).getElement(),
            getContentElement: () => assertExists(viewRef.current).getContentElement(),
            getElementByKeyIfExists: key =>
                assertExists(viewRef.current).getElementByKeyIfExists(key),
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
        undo,
        redo,
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
        },
        affinityManager,
        rowMaxWidth: contentStyles.contentMaxWidth,
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
                        contentEditor.dispatchCommand(undoCommand);
                    } else {
                        contentEditor.dispatchCommand(redoCommand);
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
        getAnchorPosition: useCallback(() => {
            const main = assertExists(mainRef.current);
            const editor = main.getNotesEditorIfExists();

            // We'll get our anchor position from the editor if it exists and is focused.
            if (!editor || !editor.isFocused()) return null;

            const editorState = editor.getState();

            const coords = editor.coordsAtPos(editorState.getSelection().from);

            const paragraphLineHeight = convertRemLengthToPx(
                contentStyles.paragraphFontSize.lineHeight,
                getRemPxWithoutListening(),
            );

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

    const {undoEvent, redoEvent, focusPriorityInput, focusDueDateInput} = useEvents({
        undoEvent: undo,
        redoEvent: redo,

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
                    getOpenChildCountSnapshot: () =>
                        taskEntryStore.getSnapshot().task?.getOpenChildTaskCount() ?? 0,

                    onCloseConfirmationDialogueOpen: ({onConfirm}) => {
                        setTaskCloseConfirmationState({taskId, onConfirm});
                    },
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
                    onPress: undoEvent,
                },
                {
                    label: "Redo",
                    keyboardShortcutHint: isAppleDevice ? "⌘+Y" : "Ctrl+Y",
                    onPress: redoEvent,
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
        isAppleDevice,
        isReadOnly,
        navigate,
        priorityInputState.isVisible,
        redoEvent,
        spaceId,
        store,
        taskEntryStore,
        taskId,
        timeZone,
        undoEvent,
        undoManager,
    ]);

    const openTaskCommentsExtraAction = withMobileLayout
        ? {
              icon: <ChatCircleDots />,
              description: "Open comments",
              onPress: async () => {
                  await navigate(`/s/${spaceId}/tasks/${taskId}/comments`);
              },
              pressErrorTitle: "Couldn't open comments",
          }
        : undefined;

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout,
        title: <TaskDetailViewNavigationBarTitle taskSubscription={taskSubscription} />,
        titleBoundaryRef: titleInputElementRef,
        menuActions: contextMenuActions,
        extraIconButton: openTaskCommentsExtraAction,
        desktopMaxWidth: contentStyles.contentMaxWidth,
        desktopControls: (
            <TaskDetailViewStatusButton
                elementRef={statusButtonRef}
                size={desktopTaskDetailViewStatusButtonSize}
                taskSubscription={taskSubscription}
                undoManager={undoManager}
                affinityManager={affinityManager}
                isReadOnly={isReadOnly}
                contextMenuActions={contextMenuActions}
            />
        ),
        // The open/close button with the title looks a little weird?
        withoutDisappearingTitle: !!readOnlyReason && !isMobile,
        stickyBanner: readOnlyReason && (
            <Box
                className={invertSelectionColorsClassName}
                height={taskDetailViewReadOnlyReasonStickyBannerHeight}
                paddingX="2"
                color="grey-0"
                backgroundColor="grey-90"
                display="flex"
                alignItems="center"
                gap="1.5"
            >
                <IconContext.Provider value={{color: "currentColor", size: spacing["4"]}}>
                    {readOnlyReason.icon}
                </IconContext.Provider>
                <Box userSelect="text">{readOnlyReason.message}</Box>
            </Box>
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
                                            withMobileLayout={withMobileLayout}
                                            taskSubscription={taskSubscription}
                                            undoManager={undoManager}
                                            affinityManager={affinityManager}
                                            showSubtasks={showSubtasks}
                                            readOnlyReason={readOnlyReason}
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
                                            notesClient={notesClient}
                                        />
                                    ),
                                };
                            }

                            return renderChildrenGridViewItem(index - 1);
                        },
                        [
                            renderChildrenGridViewItem,
                            withMobileLayout,
                            taskSubscription,
                            undoManager,
                            affinityManager,
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
                            notesClient,
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
    focusTitleInput(): void;
    focusAssigneeInput(): void;
    focusCollectionsInput(): void;
    focusNotesInput(): void;
    getNotesEditorIfExists(): ContentEditorRef<TaskNotesContentWithReferences> | null;
};

const TaskDetailViewMainMemo = memo(forwardRef(TaskDetailViewMain));

function TaskDetailViewMain(
    {
        withMobileLayout,
        taskSubscription,
        undoManager,
        affinityManager,
        showSubtasks,
        readOnlyReason,
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
        notesClient,
    }: {
        withMobileLayout: boolean;
        taskSubscription: TaskClientTaskSubscription;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        showSubtasks: boolean;
        readOnlyReason: Memo<{icon: ReactNode; message: string}> | null;
        focusChildrenGridViewStart: Memo<() => void>;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        contextMenuActions: Memo<ReadonlyArray<ReadonlyArray<MenuAction>>>;
        statusButtonRef: RefObject<HTMLElement>;
        titleInputRef: RefObject<TaskDetailTitleInputRef>;
        titleInputElementRef: RefObject<HTMLDivElement>;
        priorityInputRef: Ref<HTMLDivElement>;
        isPriorityInputVisible: boolean;
        setPriorityInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusPriorityInput: Memo<(options: {preventScroll: boolean}) => void>;
        dueDateInputRef: Ref<HTMLDivElement>;
        isDueDateInputVisible: boolean;
        setDueDateInputState: (action: SetStateAction<TaskDetailViewInputState>) => void;
        focusDueDateInput: Memo<(options: {preventScroll: boolean}) => void>;
        notesClient: TaskDetailNotesContentEditorWebSocketClient;
    },
    ref: Ref<TaskDetailViewMainRef>,
) {
    const context = useAppContext();
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
            getNotesEditorIfExists: () => {
                return assertExists(notesFieldRef.current).getEditorIfExists();
            },
        }),
        [focusDueDateInput, focusPriorityInput, statusButtonRef, titleInputRef],
    );

    return (
        <>
            <Box height="safe-area-inset-top" />
            {readOnlyReason && (
                <>
                    <Spacer space={taskDetailViewReadOnlyReasonStickyBannerHeight} />
                    <Spacer space="5" />
                </>
            )}
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
                {isMobile && (
                    // On mobile, create some space for the navigation bar since it's back button
                    // will conflict with the status button.
                    <Spacer space={navigationBarHeight} />
                )}
                <ContextMenuActions actions={contextMenuActions}>
                    <Box paddingBottom={taskDetailViewSectionGap} paddingX={screenPaddingX}>
                        {!isMobile ? (
                            <Box
                                height={navigationBarHeight}
                                marginBottom={desktopTaskDetailViewNavigationBarSpacerMarginBottom}
                            />
                        ) : (
                            <Box
                                // The `paddingTop` of `3` happens to align with the
                                // `<DocumentCommentThreadHeader>`'s resolve button on mobile.
                                paddingTop={mobileTaskDetailViewStatusButtonPaddingTop}
                                paddingBottom={mobileTaskDetailViewStatusButtonPaddingBottom}
                            >
                                {isMobile && (
                                    <TaskDetailViewStatusButton
                                        elementRef={statusButtonRef}
                                        size={mobileTaskDetailViewStatusButtonSize}
                                        taskSubscription={taskSubscription}
                                        undoManager={undoManager}
                                        affinityManager={affinityManager}
                                        isReadOnly={isReadOnly}
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
                <Spacer space={taskDetailViewSectionGap} />
                <TaskDetailNotesField
                    ref={notesFieldRef}
                    withMobileLayout={withMobileLayout}
                    taskId={taskId}
                    isReadOnly={isReadOnly}
                    pushUndoStackEntry={pushUndoStackEntry}
                    pushUndoStackEntryFromRedo={pushUndoStackEntryFromRedo}
                    pushRedoStackEntry={pushRedoStackEntry}
                    notesClient={notesClient}
                />
                {showSubtasks ? (
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
                                    color: "grey-60",
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

    const minHeight = "4";

    const touchSlop = useTouchSlop(minHeight);

    return (
        // Doesn't have a parent to horizontally align elements since we layout fields
        // with CSS grid.
        <>
            <span
                className={sprinkles({
                    display: "block",
                    maxWidth: "24",
                    minHeight,
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
            <Box ref={valueRef} minHeight={minHeight}>
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
    }, [currentAccount.id, navigate, task, taskSubscription]);

    return useStore(nodeStore);
}

function TaskDetailViewNavigationBarTitle({
    taskSubscription,
}: {
    taskSubscription: TaskClientTaskSubscription;
}) {
    const taskEntry = useStore(taskSubscription.taskEntryStore);
    const {task} = taskEntry;
    const titleText = addFallbackToTaskTitle(task?.getTitle().getText() ?? "");

    return <>{titleText}</>;
}

function TaskDetailViewStatusButton({
    size,
    taskSubscription,
    undoManager,
    affinityManager,
    isReadOnly,
    elementRef,
    contextMenuActions,
}: {
    size: "6" | "7";
    taskSubscription: TaskClientTaskSubscription;
    undoManager: TaskClientStoreUndoManager;
    affinityManager: TaskClientStoreSearchAffinityManager;
    isReadOnly: boolean;
    elementRef: RefObject<HTMLElement>;
    contextMenuActions?: ReadonlyArray<ReadonlyArray<MenuAction>>;
}) {
    const {store} = taskSubscription;
    const taskEntry = useStore(taskSubscription.taskEntryStore);
    const {task} = taskEntry;

    // Checks if a user has confirmed a task can be completed
    const [taskCloseConfirmationState, setTaskCloseConfirmationState] = useState<{
        taskId: TaskId;
        onConfirm: () => void;
    } | null>(null);

    let node = task ? (
        <>
            <TaskStatusButton
                ref={elementRef}
                size={size}
                store={store}
                undoManager={undoManager}
                affinityManager={affinityManager}
                task={task}
                isDisabled={isReadOnly}
                onCloseConfirmationDialogueOpen={({onConfirm}) => {
                    setTaskCloseConfirmationState({taskId: task.id, onConfirm});
                }}
            />
            {taskCloseConfirmationState && (
                <TaskCloseConfirmationModalDialog
                    store={store}
                    taskId={taskCloseConfirmationState.taskId}
                    onClose={() => setTaskCloseConfirmationState(null)}
                    onConfirm={taskCloseConfirmationState.onConfirm}
                />
            )}
        </>
    ) : (
        <Box
            ref={elementRef as Ref<HTMLDivElement>}
            width={size}
            height={size}
            borderRadius="full"
            border="grey-10"
            pointerEvents="none"
        />
    );

    if (contextMenuActions) {
        node = <ContextMenuActions actions={contextMenuActions}>{node}</ContextMenuActions>;
    }

    return node;
}
