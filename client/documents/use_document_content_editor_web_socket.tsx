import {StepMap} from "prosemirror-transform";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {
    DocumentContentEditorWebSocketClient,
    DocumentContentEditorWebSocketClientProcedures,
} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentCommentModel, DocumentModel} from "~/shared/documents/document_model.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {DocumentCommentThreadId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";

export type SubscribeToCommentThreadEventsFunction = Memo<
    (
        commentThreadId: DocumentCommentThreadId,
        subscriber: (event: MessagingRealtimeEvent<DocumentCommentModel>) => void,
    ) => () => void
>;

/**
 * Setup a WebSocket connection to the document collaboration service.
 *
 * We expect that you'll load the document on the server and provide an
 * `initialDocument` prop.
 */
export function useDocumentContentEditorWebSocket(initialDocument: DocumentModel): {
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
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
} {
    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const [client, setClient] = useState(() => {
        return new DocumentContentEditorWebSocketClient(() => contextRef.current, initialDocument);
    });

    // Re-initialize state if the `DocumentId` changes.
    if (client.documentId !== initialDocument.id) {
        setClient(() => {
            return new DocumentContentEditorWebSocketClient(
                () => contextRef.current,
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
        editorState: state.editorState,
        onChangeEditorState: useCallback(
            editorState => client.changeEditorState(editorState),
            [client],
        ),
        otherPresenceStateByConnectionId: state.otherPresenceStateByConnectionId,
        rememberedSteps: state.rememberedSteps,
        toggleShouldConnect,
        procedures: client.procedures as MemoObject<DocumentContentEditorWebSocketClientProcedures>,
        subscribeToCommentThreadEvents: useCallback(
            (commentThreadId, subscriber) =>
                client.subscribeToCommentThreadEvents(commentThreadId, subscriber),
            [client],
        ),
    };
}
