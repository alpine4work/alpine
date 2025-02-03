import {animate, spring, timeline} from "motion";
import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useReporter} from "~/client/design/reporter.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {documentContentEditorSidebarWidth} from "~/client/styles/document_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {taskDetailViewCommentSidebarWidth} from "~/client/styles/tasks_shared_styles.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {createTaskEntryAccessStore} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {
    TaskCommentsView,
    TaskCommentsViewInitialComments,
} from "~/client/tasks/task_comments_view.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {TaskDetailView} from "~/client/tasks/task_detail_view.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {useWebSocketErrorDialog} from "~/client/web_socket/use_web_socket.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/tasks/task_error_messages.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export function TaskDetailAndCommentsView({
    taskSubscription,
    childrenQuery,
    affinityManager,
    initialChildrenGridViewExpansionState,
    initialNotesVersion,
    initialNotesContent,
    showComments: showCommentsFromProps,
    onShowCommentsChange,
    initialComments,
    initialScrollToCommentIndex,
}: {
    taskSubscription: TaskClientTaskSubscription;
    childrenQuery: TaskClientQuery;
    affinityManager: TaskClientStoreSearchAffinityManager;
    initialChildrenGridViewExpansionState: TaskGridViewExpansionState;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
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
            new URL(
                `/s/${space.id}/tasks/${taskSubscription.taskId}?comment=${commentIndex}`,
                window.location.href,
            ),
        [space.id, taskSubscription.taskId],
    );
    const context = useAppContext();
    const reporter = useReporter();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const taskAccess = useStore(
        useMemo(
            () =>
                createTaskEntryAccessStore(
                    currentAccount?.id,
                    taskSubscription,
                    taskSubscription.taskEntryStore,
                ),
            [currentAccount?.id, taskSubscription],
        ),
    );

    if (taskAccess.level === null) {
        throw new PermissionDeniedError("Current account lost access to task", {
            displayMessage: taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
        });
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

    const events = useEvents({
        getContext: () => context,
        getReporter: () => reporter,
        addGlobalLoadingIndicator,
    });

    const [notesClient, setNotesClient] = useState(() => {
        return new TaskDetailNotesContentEditorWebSocketClient({
            getContext: events.getContext,
            addGlobalLoadingIndicator: events.addGlobalLoadingIndicator,
            taskId: taskSubscription.taskId,
            initialNotesVersion,
            initialNotesContent,
            displayError: (title, error) => events.getReporter().displayError(title, error),
        });
    });

    // Re-initialize state if the `TaskId` changes.
    if (notesClient.taskId !== taskSubscription.taskId) {
        setNotesClient(() => {
            return new TaskDetailNotesContentEditorWebSocketClient({
                getContext: events.getContext,
                addGlobalLoadingIndicator: events.addGlobalLoadingIndicator,
                taskId: taskSubscription.taskId,
                initialNotesVersion,
                initialNotesContent,
                displayError: (title, error) => events.getReporter().displayError(title, error),
            });
        });
    }

    const [shouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        // Accounts without space access aren't allowed to connect to our realtime
        // service. We'd constantly get authorization errors.
        if (!currentAccount) return;

        notesClient.connect();
        return () => {
            notesClient.disconnect();
        };
    }, [currentAccount, notesClient, shouldConnect]);

    const webSocketState = useStore(notesClient.webSocketState);

    // Show the "Lost connection" error dialog if any error occurs in our WebSocket
    // connection.
    useWebSocketErrorDialog(notesClient, webSocketState);

    const subscribeToCommentsEvents = useCallback(
        (subscriber: (event: MessagingRealtimeEvent<TaskCommentModel>) => void) => {
            return notesClient.subscribeToCommentEvents(subscriber);
        },
        [notesClient],
    );

    const [commentsState, setCommentsState] = useState<
        | {type: "ClosedWaitingToOpen"; readyPromiseResolver: PromiseResolver<void>}
        | {type: "Opening"}
        | {type: "Opened"}
        | {type: "Closing"}
        | {type: "Closed"}
    >(() => {
        if (!showComments) {
            return {type: "Closed"};
        } else {
            return {type: "Opened"};
        }
    });

    switch (commentsState.type) {
        case "ClosedWaitingToOpen": {
            if (!showComments) {
                setCommentsState({type: "Closed"});
            }
            break;
        }
        case "Opening":
        case "Opened": {
            if (!showComments) {
                setCommentsState({type: routeLayout === "narrow" ? "Closed" : "Closing"});
            }
            break;
        }
        case "Closing":
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

        switch (commentsState.type) {
            case "ClosedWaitingToOpen": {
                void Promise.race([
                    commentsState.readyPromiseResolver.promise,
                    wait(delayScreenTransitionLoadingIndicatorLimitMs),
                ]).then(() => {
                    setCommentsState(commentsState => {
                        if (commentsState.type !== "ClosedWaitingToOpen") return commentsState;
                        return {type: "Opening"};
                    });
                });
                break;
            }
            case "Opening": {
                const platform = getPlatformWithoutListening();
                const spacingScale = getSpacingScaleWithoutListening();

                const blockMaxWidth = convertRemLengthToPx(
                    contentStyles.blockMaxWidth[platform],
                    spacingScale,
                );
                const sidebarWidth = convertRemLengthToPx(
                    spacing[documentContentEditorSidebarWidth],
                    spacingScale,
                );
                const sidebarOffscreenBufferWidth = convertRemLengthToPx("10", spacingScale);

                const detailElement = assertExists(detailRef.current);
                const commentsElement = assertExists(commentsRef.current);

                const oldContentOffset = Math.max(
                    0,
                    (detailElement.clientWidth + sidebarWidth - blockMaxWidth) / 2,
                );
                const newContentOffset = Math.max(
                    0,
                    (detailElement.clientWidth - blockMaxWidth) / 2,
                );

                const animation = timeline(
                    [
                        [commentsElement, {x: [sidebarWidth + sidebarOffscreenBufferWidth, 0]}],
                        [detailElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
                    ],
                    {
                        // Add a little bit of delay so React can finish rendering before playing our
                        // animation.
                        delay: 0.05,
                        defaultOptions: {
                            easing: spring({
                                stiffness: 300,
                                damping: 31,
                            }),
                        },
                    },
                );

                void animation.finished.finally(() => {
                    setCommentsState(commentsState => {
                        if (commentsState.type !== "Opening") return commentsState;
                        return {type: "Opened"};
                    });
                });
                break;
            }
            case "Closing": {
                const platform = getPlatformWithoutListening();
                const spacingScale = getSpacingScaleWithoutListening();

                const blockMaxWidth = convertRemLengthToPx(
                    contentStyles.blockMaxWidth[platform],
                    spacingScale,
                );
                const sidebarWidth = convertRemLengthToPx(
                    spacing[documentContentEditorSidebarWidth],
                    spacingScale,
                );
                const sidebarOffscreenBufferWidth = convertRemLengthToPx("10", spacingScale);

                const detailElement = assertExists(detailRef.current);
                const commentsElement = assertExists(commentsRef.current);

                const oldContentOffset = Math.max(
                    0,
                    (detailElement.clientWidth + sidebarWidth - blockMaxWidth) / 2,
                );
                const newContentOffset = Math.max(
                    0,
                    (detailElement.clientWidth - blockMaxWidth) / 2,
                );

                const animation = timeline(
                    [
                        [commentsElement, {x: [0, sidebarWidth + sidebarOffscreenBufferWidth]}],
                        [detailElement, {x: [0, oldContentOffset - newContentOffset]}, {at: 0}],
                    ],
                    {
                        // Add a little bit of delay so React can finish rendering before playing our
                        // animation.
                        delay: 0.05,
                        defaultOptions: {
                            easing: spring({
                                stiffness: 300,
                                damping: 31,
                            }),
                        },
                    },
                );

                void animation.finished.finally(() => {
                    setCommentsState(commentsState => {
                        if (commentsState.type !== "Closing") return commentsState;
                        return {type: "Closed"};
                    });
                });
                break;
            }
            case "Opened": {
                const detailElement = assertExists(detailRef.current);
                const commentsElement = assertExists(commentsRef.current);

                // Reset any animation state.
                animate(detailElement, {x: 0}, {duration: 0});
                animate(commentsElement, {x: 0}, {duration: 0});
                break;
            }
            case "Closed": {
                const detailElement = assertExists(detailRef.current);

                // Reset any animation state.
                animate(detailElement, {x: 0}, {duration: 0});
                break;
            }
            default:
                throw exhaustive(commentsState);
        }
    }, [commentsState]);

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
                <TaskGridViewDndContext store={taskSubscription.store}>
                    <TaskDetailView
                        taskSubscription={taskSubscription}
                        taskAccess={taskAccess}
                        childrenQuery={childrenQuery}
                        affinityManager={affinityManager}
                        initialChildrenGridViewExpansionState={
                            initialChildrenGridViewExpansionState
                        }
                        notesClient={notesClient}
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
                    <TaskCommentsView
                        taskId={taskSubscription.taskId}
                        initialComments={!hasUsedInitialComments ? initialComments : null}
                        initialScrollToCommentIndex={
                            !hasUsedInitialComments ? initialScrollToCommentIndex : null
                        }
                        onInitialCommentsAvailable={handleInitialCommentsAvailable}
                        getCommentUrl={getCommentUrl}
                        isConnected={webSocketState.isConnected}
                        procedures={notesClient.procedures}
                        subscribeToEvents={subscribeToCommentsEvents}
                        // Provide the sidebar width for better layout results when previewing files.
                        fileLayoutScreenWidth={spacing[taskDetailViewCommentSidebarWidth]}
                    />
                </Box>
            )}
        </Box>
    );
}
