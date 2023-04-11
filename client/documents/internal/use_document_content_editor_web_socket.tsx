import {StepMap} from "prosemirror-transform";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {
    DocumentContentEditorWebSocketClient,
    reduceDocumentContentReferences,
} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStore} from "~/client/helpers/store/use_store";
import {useSpaceContext} from "~/client/spaces/space_context";
import {DocumentContent, emptyDocumentContent} from "~/shared/content/document_content_schema";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_schema";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {
    DocumentCommentModel,
    DocumentContentWithReferences,
    DocumentModel,
    emptyDocumentContentReferences,
} from "~/shared/models/document_model";

const emptyCollaborativeDocumentContentState = new Lazy(() =>
    ContentEditorState.createCollaborative<DocumentContentWithReferences>({
        version: 0,
        content: {doc: emptyDocumentContent, references: emptyDocumentContentReferences},
        reduceReferences: reduceDocumentContentReferences,
    }),
);

export type SendCommentThreadMessageFunction = Memo<
    (
        commentThreadId: DocumentCommentThreadId,
        message: MessagingRealtimeMessageFromClient,
    ) => Promise<void>
>;

export type SubscribeToCommentThreadMessagesFunction = Memo<
    (
        commentThreadId: DocumentCommentThreadId,
        subscriber: (message: MessagingRealtimeMessageFromServer<DocumentCommentModel>) => void,
    ) => () => void
>;

/**
 * Setup a WebSocket connection to the document collaboration service. If we
 * are in the document route then we'll have a shared WebSocket client in
 * context to use.
 *
 * We expect that you'll load the document on the server and provide an
 * `initialDocument` prop. However when opening a peek on top of a document the
 * document is already loaded so shouldn't need to be loaded again. In this
 * case `initialDocument` will be null. In the edge case that the document
 * hasn't loaded at all yet then when we connect to our WebSocket it will
 * return the full document.
 */
export function useDocumentContentEditorWebSocket(
    documentId: DocumentId,
    initialDocument: DocumentModel | null,
): {
    isConnected: boolean;
    editorState: ContentEditorState<DocumentContentWithReferences>;
    onChangeEditorState: Memo<
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
    toggleShouldConnect: Memo<() => void>;
    sendCommentThreadMessage: SendCommentThreadMessageFunction;
    subscribeToCommentThreadMessages: SubscribeToCommentThreadMessagesFunction;
} {
    assert(!initialDocument || documentId === initialDocument.id);

    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const [client, setClient] = useState(() => {
        return new DocumentContentEditorWebSocketClient(
            () => contextRef.current,
            currentAccount,
            documentId,
            initialDocument,
        );
    });

    // Re-initialize state if the `DocumentId` changes.
    if (client.documentId !== documentId) {
        setClient(() => {
            return new DocumentContentEditorWebSocketClient(
                () => contextRef.current,
                currentAccount,
                documentId,
                initialDocument,
            );
        });
    }

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        client.connect();
        return () => {
            client.disconnect();
        };
    }, [client, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const state = useStore(client.state);
    const webSocketState = useStore(client.webSocketState);

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (state?.errorState.hasError) throw state.errorState.error;

    return {
        isConnected: webSocketState.isConnected,
        editorState: state.editorState ?? emptyCollaborativeDocumentContentState.get(),
        onChangeEditorState: useCallback(
            editorState => client.changeEditorState(editorState),
            [client],
        ),
        otherPresenceStateByConnectionId: state.otherPresenceStateByConnectionId,
        rememberedSteps: state.rememberedSteps,
        toggleShouldConnect,
        sendCommentThreadMessage: useCallback(
            (commentThreadId, message) => client.sendCommentThreadMessage(commentThreadId, message),
            [client],
        ),
        subscribeToCommentThreadMessages: useCallback(
            (commentThreadId, subscriber) =>
                client.subscribeToCommentThreadMessages(commentThreadId, subscriber),
            [client],
        ),
    };
}
