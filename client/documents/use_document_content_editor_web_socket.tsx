import {StepMap} from "prosemirror-transform";
import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {
    DocumentContentEditorState,
    getInitialDocumentContentEditorState,
    reduceDocumentContentEditorState,
} from "~/client/documents/internal/document_content_editor_state.js";
import {
    DocumentContentEditorWebSocketClient,
    DocumentContentEditorWebSocketClientProcedures,
} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useAddGlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useWebSocketErrorDialog} from "~/client/web_socket/use_web_socket.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {createDocument} from "~/shared/rpc/documents_rpc_definitions.js";
import {nullStore} from "~/shared/store/const_store.js";
import {ValueStore} from "~/shared/store/value_store.js";

type DocumentContentEditorWebSocketClientState =
    | {
          readonly type: "Exists";
          readonly client: DocumentContentEditorWebSocketClient;
      }
    | {
          readonly type: "NotExists";
          readonly state: ValueStore<DocumentContentEditorState>;
          readonly pendingProcedures: Array<{
              readonly name: (typeof DocumentContentEditorWebSocketClient.procedureNames)[number];
              readonly input: any;
              readonly outputPromiseResolver: PromiseResolver<any>;
          }>;
      };

export type SubscribeToCommentThreadEventsFunction = Memo<
    (
        commentThreadId: DocumentCommentThreadId,
        subscriber: (
            event:
                | MessagingRealtimeEvent<DocumentCommentModel>
                | {type: "PersistedContent"; updatedCommentThread: DocumentCommentThreadModel},
        ) => void,
    ) => () => void
>;

/**
 * Setup a WebSocket connection to the document collaboration service.
 *
 * We expect that you'll load the document on the server and provide an
 * `initialDocument` prop.
 */
export function useDocumentContentEditorWebSocket(
    input:
        | DocumentModel
        | {
              documentId: DocumentId;
              initialDocument: DocumentModel | null;
          },
    {onCreate}: {onCreate?: () => void} = {},
): {
    spaceId: SpaceId;
    isConnected: boolean;
    editorState: ContentEditorState<DocumentContentWithReferences>;
    onEditorStateChange: Memo<
        (editorState: ContentEditorState<DocumentContentWithReferences>) => void
    >;
    otherPresenceStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;
    rememberedSteps: ReadonlyArray<{
        readonly stepMap: StepMap;
        readonly contentBeforeStep: Lazy<DocumentContent>;
        readonly contentAfterStep: Lazy<DocumentContent>;
    }>;
    unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
        DocumentCommentThreadId,
        {
            readonly isResolved: boolean;
            readonly version: number;
        }
    >;
    toggleShouldConnect: Memo<() => void>;
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    ensureCreateDocument: () => Promise<void>;
} {
    const {currentAccount, space} = useSpaceContext();
    const initialDocument = input instanceof DocumentModel ? input : input.initialDocument;
    const documentId = input instanceof DocumentModel ? input.id : input.documentId;

    assert(
        !initialDocument ||
            (initialDocument.spaceId === space.id && initialDocument.id === documentId),
    );

    const context = useAppContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const contextRef = useRef(context);
    const addGlobalLoadingIndicatorRef = useRef(addGlobalLoadingIndicator);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
        addGlobalLoadingIndicatorRef.current = addGlobalLoadingIndicator;
    });

    // When creating a document, we start in the `NotExists` state. Then once some
    // changes have been made to the document we actually create the document. That
    // way users don't end up with a bunch of empty documents they accidentally
    // created.
    const [clientState, setClientState] = useState<DocumentContentEditorWebSocketClientState>(
        () => {
            if (!initialDocument) {
                return {
                    type: "NotExists",
                    state: new ValueStore(
                        getInitialDocumentContentEditorState({currentAccountId: currentAccount.id}),
                    ),
                    pendingProcedures: [],
                };
            } else {
                return {
                    type: "Exists",
                    client: new DocumentContentEditorWebSocketClient({
                        getContext: () => contextRef.current,
                        addGlobalLoadingIndicator: (promise, indicator) =>
                            addGlobalLoadingIndicatorRef.current(promise, indicator),
                        documentId: initialDocument.id,
                        initialState: getInitialDocumentContentEditorState({initialDocument}),
                    }),
                };
            }
        },
    );

    // Re-initialize state if the `DocumentId` changes.
    if (
        initialDocument !== null &&
        (clientState.type === "NotExists" || initialDocument.id !== clientState.client.documentId)
    ) {
        setClientState({
            type: "Exists",
            // eslint-disable-next-line react-compiler/react-compiler
            client: new DocumentContentEditorWebSocketClient({
                getContext: () => contextRef.current,
                addGlobalLoadingIndicator: (promise, indicator) =>
                    addGlobalLoadingIndicatorRef.current(promise, indicator),
                documentId: initialDocument.id,
                initialState: getInitialDocumentContentEditorState({initialDocument}),
            }),
        });
    }

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;
        if (clientState.type === "NotExists") return;

        clientState.client.connect();
        return () => {
            clientState.client.disconnect();
        };
    }, [clientState, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const setCreateDocumentErrorState = useErrorState();

    const createDocumentPromiseRef = useRef<Promise<void> | null>(null);

    const ensureCreateDocument = useEvent(async () => {
        if (clientState.type === "Exists") return;
        if (createDocumentPromiseRef.current) return;

        const promise = createDocument(context, {spaceId: space.id, documentId}).then(
            () => {
                const client = new DocumentContentEditorWebSocketClient({
                    getContext: () => contextRef.current,
                    addGlobalLoadingIndicator: (promise, indicator) =>
                        addGlobalLoadingIndicatorRef.current(promise, indicator),
                    documentId,
                    initialState: clientState.state.getSnapshot(),
                });

                // Run all of our queued procedure calls against our new WebSocket client...
                for (const procedure of clientState.pendingProcedures) {
                    client.procedures[procedure.name](procedure.input).then(
                        procedure.outputPromiseResolver.resolve,
                        procedure.outputPromiseResolver.reject,
                    );
                }

                // `flushSync()` since we need procedure calls and `onEditorStateChange` calls
                // to update our new client.
                flushSync(() => {
                    setClientState({
                        type: "Exists",
                        client,
                    });
                });

                createDocumentPromiseRef.current = null;
                onCreate?.();
            },
            error => {
                setCreateDocumentErrorState(error);
                createDocumentPromiseRef.current = null;
            },
        );

        createDocumentPromiseRef.current = promise;

        return promise;
    });

    useEffect(() => {
        if (clientState.type === "Exists") return;

        const update = () => {
            // Once there are some pending steps, we need to create the document. After we
            // create the document we connect via WebSocket and send the pending sendable
            // steps over that connection.
            if (!clientState.state.getSnapshot().pendingSendableSteps) return;

            void ensureCreateDocument();
        };

        // Run `update()` immediately in case state changed while this effect was
        // not mounted.
        update();

        return clientState.state.subscribe(update);
    }, [clientState, ensureCreateDocument]);

    const state = useStore(
        clientState.type === "Exists" ? clientState.client.state : clientState.state,
    );
    const webSocketState = useStore(
        clientState.type === "Exists" ? clientState.client.webSocketState : nullStore,
    );

    // Show the "Lost connection" error dialog if any error occurs in our WebSocket
    // connection.
    useWebSocketErrorDialog(
        clientState.type === "Exists" ? clientState.client : null,
        webSocketState?.hasError ? webSocketState : state.errorState,
    );

    return {
        spaceId: space.id,
        isConnected: webSocketState?.isConnected ?? false,
        editorState: state.editorState,
        onEditorStateChange: useCallback(
            editorState => {
                if (clientState.type === "Exists") {
                    clientState.client.changeEditorState(editorState);
                } else {
                    clientState.state.set(state =>
                        reduceDocumentContentEditorState(state, [{type: "Edit", editorState}]),
                    );
                }
            },
            [clientState],
        ),
        otherPresenceStateByConnectionId: state.extra.otherPresenceStateByConnectionId,
        rememberedSteps: state.extra.rememberedSteps,
        unpersistedResolutionStateByCommentThreadId:
            state.extra.unpersistedResolutionStateByCommentThreadId,
        toggleShouldConnect,
        procedures: useMemo(() => {
            if (clientState.type === "Exists") return clientState.client.procedures;

            const procedures: DocumentContentEditorWebSocketClientProcedures = createObjectFromKeys(
                DocumentContentEditorWebSocketClient.procedureNames,
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
        }, [clientState]) as MemoObject<DocumentContentEditorWebSocketClientProcedures>,
        subscribeToCommentThreadEvents: useCallback(
            (commentThreadId, subscriber) => {
                if (clientState.type === "NotExists") return () => {};
                return clientState.client.subscribeToCommentThreadEvents(
                    commentThreadId,
                    subscriber,
                );
            },
            [clientState],
        ),
        ensureCreateDocument,
    };
}
