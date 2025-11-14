import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentBlockWidthContextProvider} from "~/client/content/content_block_width.js";
import {Box} from "~/client/design/box.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {taskDetailViewCommentSidebarWidth} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {
    TaskAccess,
    createTaskEntryAccessStore,
    getPermissionGrantedTaskAccess,
} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {useTaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/internal/use_task_detail_notes_content_editor_web_socket_client.js";
import {
    TaskCommentsView,
    TaskCommentsViewInitialComments,
} from "~/client/tasks/task_comments_view.js";
import {TaskDetailView} from "~/client/tasks/task_detail_view.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {
    taskDeletedErrorDisplayMessage,
    taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export function TaskDetailAndCommentsView({
    taskId,
    store,
    taskSubscription,
    childrenQuery,
    initialChildrenGridViewExpansionState,
    initialFields,
    initialIsFavorite,
    initialNotesVersion,
    initialNotesContent,
    commitActionTransactionAndCreateIfNeeded,
    affinityManager,
    shouldInitiallyFocus,
    showComments: showCommentsFromProps,
    onShowCommentsChange,
    initialComments,
    initialScrollToCommentIndex,
}: {
    taskId: TaskId;
    store: TaskClientStore;
    taskSubscription: TaskClientTaskSubscription | null;
    childrenQuery: TaskClientQuery | null;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
    initialIsFavorite: boolean;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
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
    affinityManager: TaskClientStoreSearchAffinityManager;
    shouldInitiallyFocus: boolean;
    showComments: boolean;
    onShowCommentsChange: Memo<(showComments: boolean) => void>;
    initialComments: TaskCommentsViewInitialComments | null;
    initialScrollToCommentIndex: number | null;
}) {
    const {space, currentAccount} = useSpaceContext();
    const routeLayout = useRouteLayout();

    const detailRef = useRef<HTMLDivElement>(null);
    const commentsRef = useRef<HTMLDivElement>(null);

    const getCommentUrl = useCallback(
        (commentIndex: number) =>
            new URL(`/s/${space.id}/tasks/${taskId}?comment=${commentIndex}`, window.location.href),
        [space.id, taskId],
    );

    const taskAccess = useStore(
        useMemo((): Store<TaskAccess> => {
            // If there's no task subscription that's because we're creating the task. The
            // task creator always has edit access.
            if (!taskSubscription) return new ConstStore(getPermissionGrantedTaskAccess("Edit"));

            return createTaskEntryAccessStore(
                currentAccount?.id,
                taskSubscription,
                taskSubscription.taskEntryStore,
            );
        }, [currentAccount?.id, taskSubscription]),
    );

    if (taskAccess.level === null) {
        if (taskAccess.type === "Deleted") {
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

    const hasCommentAccessLevel = useMemo(
        () => hasAccessLevel(taskAccess.level, "Comment"),
        [taskAccess.level],
    );

    // Don't show comments if we don't have comment access to the task.
    const showComments = showCommentsFromProps && hasCommentAccessLevel;

    // If we don't have access to the task we want to clear `comments=show` from
    // our URL.
    useEffect(() => {
        if (showComments !== showCommentsFromProps) {
            onShowCommentsChange(showComments);
        }
    }, [onShowCommentsChange, showComments, showCommentsFromProps]);

    const {
        isConnected,
        editorStateStore: notesEditorStateStore,
        onEditorStateChange: onNotesEditorStateChange,
        reconnect: reconnectNotesClient,
        procedures: notesProcedures,
        subscribeToCommentsEvents,
        subscribeToPongs,
    } = useTaskDetailNotesContentEditorWebSocketClient({
        taskId,
        taskSubscription,
        initialNotesVersion,
        initialNotesContent,
        affinityManager,
        commitActionTransactionAndCreateIfNeeded,
    });

    const [commentsState, setCommentsState] = useState<
        | {type: "ClosedWaitingToOpen"; readyPromiseResolver: PromiseResolver<void>}
        | {type: "Opened"}
        | {type: "Closed"}
    >(() => {
        if (!showComments) {
            return {type: "Closed"};
        } else {
            return {type: "Opened"};
        }
    });

    switch (commentsState.type) {
        case "Opened":
        case "ClosedWaitingToOpen": {
            if (!showComments) {
                setCommentsState({type: "Closed"});
            }
            break;
        }
        case "Closed": {
            if (showComments) {
                setCommentsState({
                    type: "ClosedWaitingToOpen",
                    readyPromiseResolver: createPromiseResolver(),
                });
            }
            break;
        }
        default:
            throw exhaustive(commentsState);
    }

    const handleInitialCommentsAvailable = useCallback(() => {
        if (commentsState.type === "ClosedWaitingToOpen") {
            commentsState.readyPromiseResolver.resolve();
        }
    }, [commentsState]);

    const lastCommentsStateTypeRef = useRef(commentsState.type);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastCommentsStateTypeRef.current === commentsState.type) return;
        lastCommentsStateTypeRef.current = commentsState.type;

        if (commentsState.type === "ClosedWaitingToOpen") {
            void Promise.race([
                commentsState.readyPromiseResolver.promise,
                wait(delayScreenTransitionLoadingIndicatorLimitMs),
            ]).then(() => {
                setCommentsState(commentsState => {
                    if (commentsState.type !== "ClosedWaitingToOpen") return commentsState;
                    return {type: "Opened"};
                });
            });
        }
    }, [commentsState, routeLayout]);

    // If `showComments` is true then switches to false, we don't want to pass
    // `initialComments` into `<TaskDetailAndCommentsView>` anymore. If
    // `showComments` switches back to true then we want to fetch our comments from
    // scratch.
    const [hasUsedInitialComments, setHasUsedInitialComments] = useState(!showComments);
    if (!showComments && !hasUsedInitialComments) setHasUsedInitialComments(true);

    return (
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="0"
            display="flex"
            justifyContent="center"
            flexDirection="row"
        >
            <Box ref={detailRef} flexGrow="1" height="full" overflow="hidden">
                <TaskGridViewDndContext store={store}>
                    <TaskDetailView
                        taskId={taskId}
                        store={store}
                        taskAccess={taskAccess}
                        taskSubscription={taskSubscription}
                        childrenQuery={childrenQuery}
                        initialChildrenGridViewExpansionState={
                            initialChildrenGridViewExpansionState
                        }
                        initialFields={initialFields}
                        initialIsFavorite={initialIsFavorite}
                        notesEditorStateStore={notesEditorStateStore}
                        onNotesEditorStateChange={onNotesEditorStateChange}
                        reconnectNotesClient={reconnectNotesClient}
                        commitActionTransactionAndCreateIfNeeded={
                            commitActionTransactionAndCreateIfNeeded
                        }
                        affinityManager={affinityManager}
                        shouldInitiallyFocus={shouldInitiallyFocus}
                        showComments={showComments}
                        onShowCommentsChange={onShowCommentsChange}
                    />
                </TaskGridViewDndContext>
            </Box>
            {commentsState.type !== "Closed" && routeLayout !== "narrow" && (
                <Box
                    ref={commentsRef}
                    position={commentsState.type === "ClosedWaitingToOpen" ? "absolute" : undefined}
                    top={commentsState.type === "ClosedWaitingToOpen" ? "0" : undefined}
                    bottom={commentsState.type === "ClosedWaitingToOpen" ? "0" : undefined}
                    right={
                        commentsState.type === "ClosedWaitingToOpen"
                            ? `-${taskDetailViewCommentSidebarWidth}`
                            : undefined
                    }
                    flexShrink="0"
                    borderLeft="grey-5"
                    width={taskDetailViewCommentSidebarWidth}
                    height="full"
                    overflow="hidden"
                >
                    <ContentBlockWidthContextProvider width={taskDetailViewCommentSidebarWidth}>
                        <TaskCommentsView
                            taskId={taskId}
                            initialComments={!hasUsedInitialComments ? initialComments : null}
                            initialScrollToCommentIndex={
                                !hasUsedInitialComments ? initialScrollToCommentIndex : null
                            }
                            onInitialCommentsAvailable={handleInitialCommentsAvailable}
                            getCommentUrl={getCommentUrl}
                            isConnected={isConnected}
                            procedures={notesProcedures}
                            subscribeToEvents={subscribeToCommentsEvents}
                            subscribeToPongs={subscribeToPongs}
                        />
                    </ContentBlockWidthContextProvider>
                </Box>
            )}
        </Box>
    );
}
