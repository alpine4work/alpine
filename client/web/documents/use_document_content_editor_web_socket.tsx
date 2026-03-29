import {StepMap} from "prosemirror-transform";
import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {createAccessPolicyStoreFromReferences} from "~/client/web/access/create_access_policy_store.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {
    DocumentContentEditorState,
    getDocumentContentEditorStatePersistedContent,
    getInitialDocumentContentEditorState,
    reduceDocumentContentEditorState,
} from "~/client/web/documents/internal/document_content_editor_state.js";
import {
    DocumentContentEditorWebSocketClient,
    DocumentContentEditorWebSocketClientProcedures,
} from "~/client/web/documents/internal/document_content_editor_web_socket_client.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {SiteRegistry} from "~/client/web/sites/site_registry.js";
import {useSiteRegistry} from "~/client/web/sites/site_registry_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {useWebSocketErrorDialog} from "~/client/web/web_socket/use_web_socket.js";
import {
    AccessLevel,
    AccessPolicy,
    LocalAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
    minAccessLevel,
} from "~/shared/access/access_policy.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/documents/document_error_messages.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {stripDocumentContentCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    SiteId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {createDocument, getDocument} from "~/shared/rpc/documents_rpc_definitions.js";
import {SearchEntityModel, SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {ConstStore, nullStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

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

export type SubscribeToSpellCheckIgnoredLintEventsFunction = Memo<
    (
        subscriber: (
            eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<SpellCheckIgnoredLintModel>>,
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
    input: {
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
    onClearOurPresenceState: Memo<() => void>;
    onUnclearOurPresenceState: Memo<() => void>;
    content: DocumentContentWithReferences;
    accessPolicy: ResolvedAccessPolicyWithGenerations;
    title: string;
    accessLevel: AccessLevel;
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
    subscribeToSpellCheckIgnoredLintEvents: SubscribeToSpellCheckIgnoredLintEventsFunction;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
    ensureCreateDocument: () => Promise<void>;
} {
    const {currentAccount, space} = useSpaceContext();
    const {initialDocument, documentId} = input;
    const siteRegistry = useSiteRegistry();

    assert(
        !initialDocument ||
            (initialDocument.spaceId === space.id && initialDocument.id === documentId),
    );

    const context = useAppContext();
    const searchEntityRegistry = useSearchEntityRegistry();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    const contextRef = useRef(context);
    const addGlobalLoadingIndicatorRef = useRef(addGlobalLoadingIndicator);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
        addGlobalLoadingIndicatorRef.current = addGlobalLoadingIndicator;
    });

    // When creating a document, we start in the `NotExists` state. Then once some
    // changes have been made to the document we actually create the document. That way
    // users don't end up with a bunch of empty documents they accidentally created.
    const [clientState, setClientState] = useState<DocumentContentEditorWebSocketClientState>(
        () => {
            if (!initialDocument) {
                return {
                    type: "NotExists",
                    state: new ValueStore(
                        getInitialDocumentContentEditorState({
                            currentAccountId: assertExists(currentAccount).id,
                        }),
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
                        // We perform permission checks separately in `<DocumentContentEditor>`. If we're
                        // on the client and we got to this point it means we must have access somehow.
                        accessLevel: !initialDocument
                            ? "Manage"
                            : (getAccountAccessLevelAssumingSpaceAccess(
                                  getInitialDocumentResolvedAccessPolicySnapshot(
                                      initialDocument,
                                      siteRegistry,
                                  ),
                                  currentAccount?.id,
                              ) ?? "View"),
                        initialState: getInitialDocumentContentEditorState({
                            currentAccountId: currentAccount?.id ?? null,
                            initialVersion: initialDocument.version,
                            initialContent: initialDocument.content,
                        }),
                    }),
                };
            }
        },
    );

    // Re-initialize client if the `DocumentId` changes.
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
                accessLevel: !initialDocument
                    ? "Manage"
                    : (getAccountAccessLevelAssumingSpaceAccess(
                          getInitialDocumentResolvedAccessPolicySnapshot(
                              initialDocument,
                              siteRegistry,
                          ),
                          currentAccount?.id,
                      ) ?? "View"),
                initialState: getInitialDocumentContentEditorState({
                    currentAccountId: currentAccount?.id ?? null,
                    initialVersion: initialDocument.version,
                    initialContent: initialDocument.content,
                }),
            }),
        });
    }

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;
        if (clientState.type === "NotExists") return;

        // Accounts without space access aren't allowed to connect to our realtime durable
        // object. We'd constantly get authorization errors.
        if (!currentAccount) return;

        clientState.client.connect();
        return () => {
            clientState.client.disconnect();
        };
    }, [clientState, currentAccount, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const setErrorState = useErrorState();

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
                    // When we create a document we have the "Manage" access level. Commenting is
                    // allowed.
                    accessLevel: "Manage",
                    initialState: clientState.state.getSnapshot(),
                });

                // Run all of our queued procedure calls against our new WebSocket client...
                for (const procedure of clientState.pendingProcedures) {
                    client.procedures[procedure.name](procedure.input).then(
                        procedure.outputPromiseResolver.resolve,
                        procedure.outputPromiseResolver.reject,
                    );
                }

                // `flushSync()` since we need procedure calls and `onEditorStateChange` calls to
                // update our new client.
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
                setErrorState(error);
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
            // create the document we connect via WebSocket and send the pending sendable steps
            // over that connection.
            if (!clientState.state.getSnapshot().pendingSendableSteps) return;

            void ensureCreateDocument();
        };

        // Run `update()` immediately in case state changed while this effect was not
        // mounted.
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

    // We assume the current `AccountId` never changes.
    assert(state.extra.currentAccountId === (currentAccount?.id ?? null));

    const content = state.editorState.getContent();
    const contentWithoutSendableSteps = state.editorState.getDocWithoutSendableSteps();
    const persistedContent = getDocumentContentEditorStatePersistedContent(state);

    const title = useMemo(() => getDocumentContentTitle(content.doc), [content.doc]);
    const persistedTitle = useMemo(
        () => getDocumentContentTitle(persistedContent),
        [persistedContent],
    );

    // Recomputed if the content without sendable steps's access policy was a site and
    // the site model changed in the store.
    const contentWithoutSendableStepsAccessLevel = useStore(
        useMemo(
            () =>
                getAccessLevelStore(
                    contentWithoutSendableSteps.attrs.accessPolicy,
                    content.references.siteById,
                    currentAccount?.id,
                    siteRegistry,
                ),
            [
                contentWithoutSendableSteps.attrs.accessPolicy,
                content.references.siteById,
                siteRegistry,
                currentAccount?.id,
            ],
        ),
    );

    // Recomputed if the persisted content's access policy was a site and the site
    // model changed in the store.
    const persistedContentAccessLevel = useStore(
        useMemo(
            () =>
                getAccessLevelStore(
                    persistedContent.attrs.accessPolicy,
                    content.references.siteById,
                    currentAccount?.id,
                    siteRegistry,
                ),
            [
                persistedContent.attrs.accessPolicy,
                currentAccount?.id,
                content.references.siteById,
                siteRegistry,
            ],
        ),
    );

    const acknowledgedAccessLevel = useMemo(
        () => minAccessLevel(contentWithoutSendableStepsAccessLevel, persistedContentAccessLevel),
        [contentWithoutSendableStepsAccessLevel, persistedContentAccessLevel],
    );

    // The current account's access level. We take the minimum access level of what's
    // currently in state and what's persisted in our database. Ultimately, the access
    // level persisted in our database is what we evaluate permission checks with. But
    // it doesn't hurt to optimistically lower the permissions allowed in the UI
    // immediately upon the access policy changing.
    const accessPolicy = useStore(
        useMemo(
            (): Store<ResolvedAccessPolicyWithGenerations> =>
                createAccessPolicyStoreFromReferences(
                    content.doc.attrs.accessPolicy,
                    content.references.siteById,
                    siteRegistry,
                ),
            [content.doc.attrs.accessPolicy, content.references.siteById, siteRegistry],
        ),
    );

    const accessLevel = useMemo(
        () =>
            minAccessLevel(
                acknowledgedAccessLevel,
                getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
            ),
        [acknowledgedAccessLevel, accessPolicy, currentAccount?.id],
    );

    if (accessLevel === null) {
        throw new PermissionDeniedError("Current account lost access to document", {
            displayMessage: documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
        });
    }

    let shouldInitializeClientWithNewCommentAccess = false;

    if (clientState.type === "Exists") {
        // Re-initialize client if we're losing access to comments. This will happen when
        // going from `Comment` (or higher) access level to `View`.
        if (
            !hasAccessLevel(acknowledgedAccessLevel, "Comment") &&
            hasAccessLevel(clientState.client.accessLevel, "Comment")
        ) {
            setClientState({
                type: "Exists",
                // eslint-disable-next-line react-compiler/react-compiler
                client: new DocumentContentEditorWebSocketClient({
                    getContext: () => contextRef.current,
                    addGlobalLoadingIndicator: (promise, indicator) =>
                        addGlobalLoadingIndicatorRef.current(promise, indicator),
                    documentId: clientState.client.documentId,
                    accessLevel: acknowledgedAccessLevel ?? "View",
                    initialState: getInitialDocumentContentEditorState({
                        currentAccountId: currentAccount?.id ?? null,
                        initialVersion: state.editorState.getVersion(),
                        initialContent: {
                            doc: assertDocumentContent(
                                stripDocumentContentCommentMarks(
                                    state.editorState.getDocWithoutSendableSteps(),
                                ),
                            ),
                            references: {
                                ...state.editorState.getContent().references,
                                commentThreadById: emptyMap,
                            },
                        },
                        // Try to maintain the user's selection while resetting state.
                        initialSelection: state.editorState.getSelection().getBookmark(),
                    }),
                }),
            });
        }
        // If we are gaining access to comments then we need to fully reload the document.
        // We do so in the effect below.
        else if (
            hasAccessLevel(acknowledgedAccessLevel, "Comment") &&
            !hasAccessLevel(clientState.client.accessLevel, "Comment")
        ) {
            shouldInitializeClientWithNewCommentAccess = true;
        }
        // If the `accessLevel` has changed then we need to reconnect to the WebSocket with
        // the new `accessLevel`. We don't have to modify the document in the process (e.g.
        // by stripping comments).
        else if ((acknowledgedAccessLevel ?? "View") !== clientState.client.accessLevel) {
            setClientState({
                type: "Exists",
                // eslint-disable-next-line react-compiler/react-compiler
                client: new DocumentContentEditorWebSocketClient({
                    getContext: () => contextRef.current,
                    addGlobalLoadingIndicator: (promise, indicator) =>
                        addGlobalLoadingIndicatorRef.current(promise, indicator),
                    documentId: clientState.client.documentId,
                    accessLevel: acknowledgedAccessLevel ?? "View",
                    initialState: state,
                }),
            });
        }
    }

    // Re-initialize client if `withoutComments` changes to false. This will happen
    // when going from `View` access level to `Comment` (or higher). We need to refetch
    // the document since we don't know where the comment marks in the document are.
    const initializingClientWithCommentsSymbolRef = useRef<symbol | null>(null);
    useEffect(() => {
        if (!shouldInitializeClientWithNewCommentAccess) {
            initializingClientWithCommentsSymbolRef.current = null;
            return;
        }

        assert(clientState.type === "Exists");

        if (initializingClientWithCommentsSymbolRef.current) return;
        const symbol = Symbol();
        initializingClientWithCommentsSymbolRef.current = symbol;

        getDocument(context, {documentId: clientState.client.documentId}).then(({document}) => {
            // Make sure our initialization request wasn't cancelled.
            if (initializingClientWithCommentsSymbolRef.current !== symbol) return;

            setClientState({
                type: "Exists",
                client: new DocumentContentEditorWebSocketClient({
                    getContext: () => contextRef.current,
                    addGlobalLoadingIndicator: (promise, indicator) =>
                        addGlobalLoadingIndicatorRef.current(promise, indicator),
                    documentId: document.id,
                    accessLevel: acknowledgedAccessLevel ?? "View",
                    initialState: getInitialDocumentContentEditorState({
                        currentAccountId: currentAccount?.id ?? null,
                        initialVersion: document.version,
                        initialContent: document.content,
                        // Try to maintain the user's selection while resetting state.
                        initialSelection: clientState.client.state
                            .getSnapshot()
                            .editorState.getSelection()
                            .getBookmark(),
                    }),
                }),
            });
        }, setErrorState);
    }, [
        acknowledgedAccessLevel,
        clientState,
        context,
        currentAccount?.id,
        setErrorState,
        shouldInitializeClientWithNewCommentAccess,
    ]);

    // Update `SearchEntityRegistry` with the latest document title. Now as the title
    // changes in realtime, any `SearchEntityModel`s rendered elsewhere in the product
    // will also update.
    //
    // Optimization: Only updates `SearchEntityRegistry` when `title` changes. Not on
    // any arbitrary update to the document. Otherwise we'd put this in `useMemo()`.
    {
        const searchEntityRef = useRef<{
            title: string;
            store: Store<SearchEntityModelData>;
        } | null>(null);

        useEffect(() => {
            if (searchEntityRef.current?.title === persistedTitle) return;

            searchEntityRef.current = {
                title: persistedTitle,
                store: searchEntityRegistry.getEntityStore(
                    new SearchEntityModel({
                        id: `Document:${documentId}`,
                        title: persistedTitle,
                        titleVersion: {type: "Integer", version: state.persistedVersion},
                        media: null,
                    }),
                ),
            };
        }, [documentId, persistedTitle, searchEntityRegistry, state.persistedVersion]);
    }

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
        onClearOurPresenceState: useCallback(() => {
            if (clientState.type === "Exists") {
                clientState.client.clearOurPresenceState();
            } else {
                clientState.state.set(state =>
                    reduceDocumentContentEditorState(state, [
                        {type: "Extra", extra: {type: "ClearOurPresenceState"}},
                    ]),
                );
            }
        }, [clientState]),
        onUnclearOurPresenceState: useCallback(() => {
            if (clientState.type === "Exists") {
                clientState.client.unclearOurPresenceState();
            } else {
                clientState.state.set(state =>
                    reduceDocumentContentEditorState(state, [
                        {type: "Extra", extra: {type: "UnclearOurPresenceState"}},
                    ]),
                );
            }
        }, [clientState]),
        content,
        accessPolicy,
        title,
        accessLevel,
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
        subscribeToSpellCheckIgnoredLintEvents: useCallback(
            subscriber => {
                if (clientState.type === "NotExists") return () => {};
                return clientState.client.subscribeToSpellCheckIgnoredLints(subscriber);
            },
            [clientState],
        ),
        subscribeToPongs: useCallback(
            subscriber => {
                if (clientState.type === "NotExists") return () => {};
                return clientState.client.subscribeToPongs(subscriber);
            },
            [clientState],
        ),
        ensureCreateDocument,
    };
}

function getAccessLevelStore(
    accessPolicy: AccessPolicy,
    siteById: ReadonlyMap<SiteId, SitePreviewModel>,
    currentAccountId: AccountId | undefined,
    siteRegistry: SiteRegistry,
): Store<AccessLevel | null> {
    switch (accessPolicy.type) {
        case "Local":
            return new ConstStore(
                getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccountId),
            );
        case "Site":
            const site = assertExists(siteById.get(accessPolicy.siteId));
            return siteRegistry
                .getSiteStore(site)
                .map(site =>
                    getAccountAccessLevelAssumingSpaceAccess(site.accessPolicy, currentAccountId),
                );
        default:
            throw exhaustive(accessPolicy);
    }
}

/**
 * This does not get a "reactive" access policy, hence the name snapshot. This gets
 * the point-in-time access policy from the site registry (for site access
 * policies) during a react state transition.
 */
function getInitialDocumentResolvedAccessPolicySnapshot(
    document: DocumentModel,
    siteRegistry: SiteRegistry,
): LocalAccessPolicy {
    const accessPolicy: AccessPolicy = document.content.doc.attrs.accessPolicy;
    const siteById = document.content.references.siteById;

    switch (accessPolicy.type) {
        case "Local":
            return accessPolicy;
        case "Site": {
            const site = siteById.get(accessPolicy.siteId);
            assert(site, "Expected site in references");
            return siteRegistry.getSiteStore(site).getSnapshot().accessPolicy;
        }
    }
}
