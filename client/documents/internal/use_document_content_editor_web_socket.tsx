import {StepMap} from "prosemirror-transform";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {useDocumentRouteContext} from "~/client/documents/document_route_context_provider";
import {
    DocumentContentEditorWebSocketClient,
    reduceDocumentContentReferences,
} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStore} from "~/client/helpers/store/use_store";
import {DocumentContent, emptyDocumentContent} from "~/shared/content/document_content_schema";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_schema";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {assert} from "~/shared/helpers/control/assert";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromClient} from "~/shared/messaging/messaging_realtime_schema";
import {
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

/**
 * Setup a WebSocket connection to the document collaboration service. If we
 * are in the document route then we'll have a shared WebSocket client in
 * context to use.
 *
 * We expect that you'll load the document on the server and provide an
 * `initialDocument` prop. However when opening a peek on top of a document the
 * document is already loaded so shouldn't need to be loaded again. In this
 * case `initialDocument` will be null. In the edge case that the document
 * hasn't loaded at all yet then we return an empty, inert, editor state.
 */
export function useDocumentContentEditorWebSocket(
    documentId: DocumentId,
    initialDocument: DocumentModel | null,
): {
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
    sendCommentThreadMessage: Memo<
        (
            commentThreadId: DocumentCommentThreadId,
            message: MessagingRealtimeMessageFromClient,
        ) => Promise<void>
    >;
} {
    assert(!initialDocument || documentId === initialDocument.id);

    const routeContext = useDocumentRouteContext();

    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const initializeState = () => {
        // If we have a usable client in our route context then use that. Otherwise
        // create a new client.
        if (routeContext?.client.documentId === documentId) return routeContext;

        // In the edge case where a document is not provided but we can't reuse an
        // existing WebSocket client then put our content editor in an inert state.
        //
        // We don't expect this case to ever be reachable but maybe in the following
        // race condition:
        //
        // 1. User starts loading comment thread peek on top of document
        // 2. User navigates away from document before peek finishes loading
        // 3. Peek stays and finishes loading with no document, there is no WebSocket
        //    to reuse in context. We have inert previews in the comment thread peek
        //
        // This seems acceptable. The race condition should be uncommon. Erring isn't
        // correct because this case is possible. We could detect this case and load
        // the entire document in a backfill response but that's some annoying code to
        // write for an edge case like this.
        if (!initialDocument) return null;

        return {
            connectCountRef: {current: 0},
            client: new DocumentContentEditorWebSocketClient(
                () => contextRef.current,
                initialDocument,
            ),
        };
    };

    const [state, setState] = useState(initializeState);

    // If the document ID changes then we need to re-initialize state.
    if (state && state.client.documentId !== documentId) setState(initializeState());

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!state) return;
        if (!shouldConnect) return;

        state.connectCountRef.current++;

        if (state.connectCountRef.current === 1) {
            state.client.connect();
        }

        return () => {
            state.connectCountRef.current--;

            if (state.connectCountRef.current === 0) {
                state.client.disconnect();
            }
        };
    }, [shouldConnect, state]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const clientState = useStore(state?.client.state ?? null);

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (clientState?.errorState.hasError) throw clientState.errorState.error;

    return {
        editorState: clientState?.editorState ?? emptyCollaborativeDocumentContentState.get(),
        onChangeEditorState: useCallback(
            editorState => {
                state?.client.changeEditorState(editorState);
            },
            [state?.client],
        ),
        otherPresenceStateByConnectionId:
            clientState?.otherPresenceStateByConnectionId ?? ImmutableMap.empty(),
        rememberedSteps: clientState?.rememberedSteps ?? emptyArray,
        toggleShouldConnect,
        sendCommentThreadMessage: useCallback(
            async (commentThreadId, message) => {
                // TODO(calebmer): Noop-ing in our edge case where `state` is null does not
                // seem great...
                await state?.client.sendCommentThreadMessage(commentThreadId, message);
            },
            [state?.client],
        ),
    };
}
