import Head from "next/head";
import {Step} from "prosemirror-transform";
import {useEffect, useReducer, useRef} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {useEvent} from "~/client/helpers/lifecycle/use-event";
import {WebSocketClient} from "~/client/helpers/websocket-client";
import {useNetworkPresenceChannel} from "~/client/network/use-network-presence-channel";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
} from "~/shared/documents/document-collaboration-schema";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {assert} from "~/shared/helpers/control/assert";
import {cast} from "~/shared/helpers/control/cast";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id, generateId} from "~/shared/id/id";
import {DocumentEditorPresenceChannel} from "~/shared/network/documents-network-definition";
import {Schema} from "~/shared/schema/schema";

const workerOrigin = Schema.string.deserialize(process.env.NEXT_PUBLIC_WORKER_ORIGIN ?? null);

type DocumentCollaborationWebSocketClient = WebSocketClient<
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromClient
>;

type State = {
    editorState: ContentEditorState<DocumentContent>;
    isConnected: boolean;
    pendingRequest: {
        readonly requestId: Id;
        readonly steps: ReadonlyArray<Step>;
        readonly clientId: Id;
        readonly version: number;
    } | null;
};

function getInitialState(initialDocument: DocumentModel): State {
    const editorState = ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });

    return {
        editorState,
        isConnected: false,
        pendingRequest: null,
    };
}

type Action = EditAction | SetIsConnectedAction | HandleMessageAction;

type EditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type SetIsConnectedAction = {
    readonly type: "SetIsConnected";
    readonly isConnected: boolean;
};

type HandleMessageAction = {
    readonly type: "HandleMessage";
    readonly message: DocumentCollaborationMessageFromServer;
};

function reduce(state: State, action: Action): State {
    switch (action.type) {
        case "Edit": {
            if (state.pendingRequest) {
                return {
                    ...state,
                    editorState: action.editorState,
                };
            }

            const toSend = action.editorState.sendableSteps();
            return {
                ...state,
                editorState: action.editorState,
                pendingRequest: toSend
                    ? {
                          steps: toSend.steps,
                          version: toSend.version,
                          clientId: toSend.clientId,
                          requestId: generateId(),
                      }
                    : null,
            };
        }
        case "SetIsConnected":
            return {...state, isConnected: action.isConnected};
        case "HandleMessage": {
            const message = action.message;
            // replace with exhaustive switch when we have more message types
            cast<"steps">(message.type);

            // websocket messages should always be delivered in order.
            // we're more likely to error out and disconnect (and therefore reconnect
            // and re-request missing messages) than get out-of-order messages.
            assert(message.version === state.editorState.getVersion());

            const isResponseToCurrentPendingRequest =
                state.pendingRequest?.requestId === message.requestId;

            const newState: State = {
                ...state,
                editorState: state.editorState.receiveSteps(
                    message.steps.map(step => ({step, clientId: message.clientId})),
                ),
                pendingRequest: isResponseToCurrentPendingRequest ? null : state.pendingRequest,
            };

            if (isResponseToCurrentPendingRequest) {
                // state just changed, so let's treat this as an 'edit' so we can send out
                // any more steps to the server:
                return reduce(newState, {type: "Edit", editorState: newState.editorState});
            }
            return newState;
        }
        default:
            throw exhaustive(action);
    }
}

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different version is passed in then remount our
            // stateful content editor component.
            key={document.version}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const documentId = initialDocument.id;

    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const connectionRef = useRef<DocumentCollaborationWebSocketClient>();

    const onConnect = useEvent((socket: DocumentCollaborationWebSocketClient) => {
        socket.send({type: "listenSince", version: state.editorState.getVersion()});
    });

    useEffect(() => {
        const socket = new WebSocketClient(
            DocumentCollaborationMessageFromServerSchema,
            DocumentCollaborationMessageFromClientSchema,
            WebSocketClient.httpToWs(`${workerOrigin}/documents/${documentId}/ws`),
        );

        connectionRef.current = socket;

        const unsubscribeConnect = socket.onConnect(() => {
            dispatch({type: "SetIsConnected", isConnected: true});
            onConnect(socket);
        });
        const unsubscribeDisconnect = socket.onDisconnect(() => {
            dispatch({type: "SetIsConnected", isConnected: false});
        });
        const unsubscribeMessage = socket.onMessage(message => {
            dispatch({type: "HandleMessage", message});
        });

        socket.connect();

        return () => {
            unsubscribeConnect();
            unsubscribeDisconnect();
            unsubscribeMessage();
            socket.disconnect();
            connectionRef.current = undefined;
        };
    }, [documentId, onConnect]);

    useEffect(() => {
        if (state.pendingRequest) {
            assert(connectionRef.current);
            connectionRef.current.send({type: "steps", ...state.pendingRequest});
        }
    }, [state.pendingRequest]);

    useNetworkPresenceChannel(
        DocumentEditorPresenceChannel,
        {documentId},
        {
            version: state.editorState.getVersion(),
        },
    );

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={state.editorState}
                onChange={editorState => dispatch({type: "Edit", editorState})}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
            />
        </>
    );
}
