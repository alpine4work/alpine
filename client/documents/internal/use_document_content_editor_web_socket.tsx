import {useCallback, useEffect, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {useDocumentRouteContext} from "~/client/documents/document_route_context_provider";
import {DocumentContentEditorWebSocketClient} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStore} from "~/client/helpers/store/use_store";
import {DocumentContentWithReferences, DocumentModel} from "~/shared/models/document_model";

/**
 * Setup a WebSocket connection to the document collaboration service. If we
 * are in the document route then we'll have a shared WebSocket client in
 * context to use.
 */
export function useDocumentContentEditorWebSocket(initialDocument: DocumentModel) {
    const routeContext = useDocumentRouteContext();

    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const [{connectCountRef, client}] = useState(() => {
        // If we have a usable client in our route context then use that. Otherwise
        // create a new client.
        if (routeContext?.client.documentId === initialDocument.id) return routeContext;

        return {
            connectCountRef: {current: 0},
            client: new DocumentContentEditorWebSocketClient(
                () => contextRef.current,
                initialDocument,
            ),
        };
    });

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        connectCountRef.current++;

        if (connectCountRef.current === 1) {
            client.connect();
        }

        return () => {
            connectCountRef.current--;

            // eslint-disable-next-line react-hooks/exhaustive-deps
            if (connectCountRef.current === 0) {
                client.disconnect();
            }
        };
    }, [client, connectCountRef, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const state = useStore(client.state);

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (state.errorState.hasError) throw state.errorState.error;

    return {
        editorState: state.editorState,
        onChangeEditorState: (editorState: ContentEditorState<DocumentContentWithReferences>) =>
            client.changeEditorState(editorState),
        otherPresenceStateByConnectionId: state.otherPresenceStateByConnectionId,
        rememberedSteps: state.rememberedSteps,
        toggleShouldConnect,
    };
}
