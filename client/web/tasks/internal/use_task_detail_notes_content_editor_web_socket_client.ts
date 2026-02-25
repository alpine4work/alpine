import {Memo, RefObject, useCallback, useEffect, useMemo, useState} from "react";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {
    TaskDetailNotesContentEditorWebSocketClient,
    TaskDetailNotesContentEditorWebSocketClientProcedures,
    TaskNotesContentEditorState,
    getInitialTaskNotesContentEditorState,
    reduceTaskNotesContentEditorState,
} from "~/client/web/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {useWebSocketErrorDialog} from "~/client/web/web_socket/use_web_socket.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {falseStore, nullStore} from "~/shared/store/const_store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type TaskDetailNotesContentEditorWebSocketClientState =
    | {
          readonly type: "Exists";
          readonly client: TaskDetailNotesContentEditorWebSocketClient;
          readonly pendingProceduresRef: RefObject<ReadonlyArray<{
              readonly name: (typeof TaskDetailNotesContentEditorWebSocketClient.procedureNames)[number];
              readonly input: any;
              readonly outputPromiseResolver: PromiseResolver<any>;
          }> | null>;
      }
    | {
          readonly type: "NotExists";
          readonly state: ValueStore<TaskNotesContentEditorState>;
          readonly pendingProcedures: Array<{
              readonly name: (typeof TaskDetailNotesContentEditorWebSocketClient.procedureNames)[number];
              readonly input: any;
              readonly outputPromiseResolver: PromiseResolver<any>;
          }>;
      };

export function useTaskDetailNotesContentEditorWebSocketClient({
    taskId,
    taskSubscription,
    accessLevel,
    initialNotesVersion,
    initialNotesContent,
    affinityManager,
    commitActionTransactionAndCreateIfNeeded,
}: {
    taskId: TaskId;
    taskSubscription: TaskClientTaskSubscription | null;
    accessLevel: AccessLevel;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
    affinityManager: TaskClientStoreSearchAffinityManager;
    commitActionTransactionAndCreateIfNeeded: Memo<
        (
            getActions: () => Iterable<TaskActionModel>,
            {
                undoManager,
                affinityManager,
                updateAccessPolicyShareNotification,
            }: {
                undoManager: TaskClientStoreUndoManager | null;
                affinityManager: TaskClientStoreSearchAffinityManager;
                updateAccessPolicyShareNotification?: ShareNotification | null;
            },
        ) => {
            finally: (callback: () => void) => void;
        }
    >;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();
    const {currentAccount} = useSpaceContext();

    const events = useEvents({
        getContext: () => context,
        getReporter: () => reporter,
        addGlobalLoadingIndicator,
    });

    // Has this task been created on the backend? False if `taskSubscription` is
    // null (which means we have a ghost task) and false if we only have an
    // optimistic `TaskModel` object in `taskSubscription` (which means we're
    // waiting on the create action to commit).
    //
    // We wait for this to be true before establishing a WebSocket connection.
    // Since if we try to start a WebSocket connection will this is false we may
    // get task not found errors since the backend doesn't know about the task yet.
    const wasTaskCreated =
        useStore(
            useMemo(
                () =>
                    taskSubscription?.taskEntryStore.map(taskEntry => {
                        if (taskEntry.optimisticState === null) {
                            return taskEntry.task !== null;
                        } else {
                            return taskEntry.optimisticState.original.task !== null;
                        }
                    }) ?? falseStore,
                [taskSubscription?.taskEntryStore],
            ),
        ) &&
        // This variable will already always be false if `taskSubscription` is null.
        // But include this check here so TypeScript can correctly refine
        // `taskSubscription` to non-null if you check `if (wasTaskCreated)`.
        !!taskSubscription;

    // When creating a task, we start in the `NotExists` state. Then once some
    // changes have been made to the task we actually create the task. That
    // way users don't end up with a bunch of empty tasks they accidentally
    // created.
    const [clientState, setClientState] =
        useState<TaskDetailNotesContentEditorWebSocketClientState>(() => {
            if (!wasTaskCreated) {
                return {
                    type: "NotExists",
                    state: new ValueStore(
                        getInitialTaskNotesContentEditorState({
                            taskId,
                            initialNotesVersion,
                            initialNotesContent,
                        }),
                    ),
                    pendingProcedures: [],
                };
            } else {
                return {
                    type: "Exists",
                    client: new TaskDetailNotesContentEditorWebSocketClient({
                        getContext: events.getContext,
                        addGlobalLoadingIndicator: events.addGlobalLoadingIndicator,
                        taskId,
                        accessLevel,
                        displayError: (title, error) =>
                            events.getReporter().displayError(title, error),
                        initialState: getInitialTaskNotesContentEditorState({
                            taskId,
                            initialNotesVersion,
                            initialNotesContent,
                        }),
                    }),
                    pendingProceduresRef: {current: null},
                };
            }
        });

    // Re-initialize state if the task is created.
    if (wasTaskCreated && clientState.type === "NotExists") {
        const initialState = clientState.state.getSnapshot();

        setClientState({
            type: "Exists",
            client: new TaskDetailNotesContentEditorWebSocketClient({
                getContext: events.getContext,
                addGlobalLoadingIndicator: events.addGlobalLoadingIndicator,
                taskId,
                accessLevel,
                displayError: (title, error) => events.getReporter().displayError(title, error),
                initialState:
                    initialState.extra.taskId === taskId
                        ? initialState
                        : getInitialTaskNotesContentEditorState({
                              taskId,
                              initialNotesVersion,
                              initialNotesContent,
                          }),
            }),
            pendingProceduresRef: {current: clientState.pendingProcedures},
        });
    }

    // Re-initialize state if the `TaskId` changes or the `AccessLevel` changes.
    if (
        wasTaskCreated &&
        clientState.type === "Exists" &&
        (taskId !== clientState.client.taskId || accessLevel !== clientState.client.accessLevel)
    ) {
        setClientState({
            type: "Exists",
            client: new TaskDetailNotesContentEditorWebSocketClient({
                getContext: events.getContext,
                addGlobalLoadingIndicator: events.addGlobalLoadingIndicator,
                taskId,
                accessLevel,
                displayError: (title, error) => events.getReporter().displayError(title, error),
                initialState: getInitialTaskNotesContentEditorState({
                    taskId,
                    initialNotesVersion,
                    initialNotesContent,
                }),
            }),
            pendingProceduresRef: {current: null},
        });
    }

    useEffect(() => {
        if (clientState.type === "NotExists") return;

        // Accounts without space access aren't allowed to connect to our realtime
        // service. We'd constantly get authorization errors.
        if (!currentAccount) return;

        clientState.client.connect();
        return () => {
            clientState.client.disconnect();
        };
    }, [currentAccount, clientState]);

    useEffect(() => {
        if (clientState.type === "Exists") return;

        const update = () => {
            // Once there are some pending steps, we need to create the document. After we
            // create the document we connect via WebSocket and send the pending sendable
            // steps over that connection.
            if (!clientState.state.getSnapshot().pendingSendableSteps) return;

            // Will noop if the task is already created. If the task has not been created
            // then we'll submit a create action.
            commitActionTransactionAndCreateIfNeeded(() => [], {
                // Can't undo this implicit action transaction that creates the task! The user
                // didn't explicitly take this action.
                undoManager: null,
                affinityManager,
            });
        };

        // Run `update()` immediately in case state changed while this effect was
        // not mounted.
        update();

        return clientState.state.subscribe(update);
    }, [affinityManager, clientState, commitActionTransactionAndCreateIfNeeded]);

    // Run any pending procedures when we shift from a `NotExists` client state to
    // an `Exists` client state.
    useEffect(() => {
        if (clientState.type === "NotExists") return;

        if (!clientState.pendingProceduresRef.current) return;

        const pendingProcedures = clientState.pendingProceduresRef.current;
        // eslint-disable-next-line react-compiler/react-compiler
        clientState.pendingProceduresRef.current = null;

        // Run all of our queued procedure calls against our new WebSocket client...
        for (const procedure of pendingProcedures) {
            clientState.client.procedures[procedure.name](procedure.input).then(
                procedure.outputPromiseResolver.resolve,
                procedure.outputPromiseResolver.reject,
            );
        }
    }, [clientState, clientState.type]);

    const webSocketState = useStore(
        clientState.type === "Exists" ? clientState.client.webSocketState : nullStore,
    );

    // Show the "Lost connection" error dialog if any error occurs in our WebSocket
    // connection.
    useWebSocketErrorDialog(
        clientState.type === "Exists" ? clientState.client : null,
        webSocketState,
    );

    return {
        isConnected: webSocketState?.isConnected ?? false,
        editorStateStore: useMemo(
            () => (clientState.type === "Exists" ? clientState.client.state : clientState.state),
            [clientState],
        ),
        onEditorStateChange: useCallback(
            (editorState: ContentEditorState<TaskNotesContentWithReferences>) => {
                if (clientState.type === "Exists") {
                    clientState.client.changeEditorState(editorState);
                } else {
                    clientState.state.set(state =>
                        reduceTaskNotesContentEditorState(state, [{type: "Edit", editorState}]),
                    );
                }
            },
            [clientState],
        ),
        reconnect: useCallback(() => {
            if (clientState.type !== "Exists") return;
            clientState.client.reconnect();
        }, [clientState]),
        procedures: useMemo(() => {
            if (clientState.type === "Exists") return clientState.client.procedures;

            const procedures: TaskDetailNotesContentEditorWebSocketClientProcedures =
                createObjectFromKeys(
                    TaskDetailNotesContentEditorWebSocketClient.procedureNames,
                    name => {
                        return (input: any) => {
                            const promiseResolver = createPromiseResolver<any>();

                            clientState.pendingProcedures.push({
                                name,
                                input,
                                outputPromiseResolver: promiseResolver,
                            });

                            return promiseResolver.promise;
                        };
                    },
                );

            return procedures;
        }, [clientState]) as MemoObject<TaskDetailNotesContentEditorWebSocketClientProcedures>,
        subscribeToCommentsEvents: useCallback(
            (subscriber: (event: MessagingRealtimeEvent<TaskCommentModel>) => void) => {
                if (clientState.type !== "Exists") return noop;
                return clientState.client.subscribeToCommentEvents(subscriber);
            },
            [clientState],
        ),
        subscribeToPongs: useCallback(
            (subscriber: (message: WebSocketPongMessage) => void) => {
                if (clientState.type !== "Exists") return noop;
                return clientState.client.subscribeToPongs(subscriber);
            },
            [clientState],
        ),
    };
}
