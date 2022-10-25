import {ContentEditorState} from "~/client/content/content-editor";
import {WebSocketClient} from "~/client/network/websocket-client";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationReadSnapshotResponse,
} from "~/shared/documents/document-collaboration-schema";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {assert} from "~/shared/helpers/control/assert";
import {cast} from "~/shared/helpers/control/cast";
import {Id} from "~/shared/id/id";
import {Schema} from "~/shared/schema/schema";

// TODO:
// - [ ] stop trying to reconnect when tab is dormant
// - [ ] rethink reconnection / back-off strategy
// - [ ] handle edge case: steps received from server don't match expected
//       (ie dropped steps in between)
// - [ ] handle edge case: disconnect/error after sending steps to server
// - [ ] handle edge case: no acknowledgement after sending steps to server (timeout?)

function httpToWs(url: string) {
    return url.replace(/^http(s?):\/\//, "ws$1://");
}

const COLLABORATION_WORKER_HOST = Schema.string.deserialize(
    process.env.NEXT_PUBLIC_COLLABORATION_WORKER_ORIGIN ?? null,
);

export class DocumentCollaborationWorkerConnection {
    private isDestroyed = false;
    private readonly destroyCallbacks: Array<() => void> = [];
    private readonly socket: WebSocketClient<
        DocumentCollaborationMessageFromServer,
        DocumentCollaborationMessageFromClient
    >;
    private unacknowledgedStepsId: string | number | null = null;

    constructor(
        private readonly documentId: Id,
        private readonly getState: () => ContentEditorState<DocumentContent>,
        private readonly setState: (
            next:
                | ContentEditorState<DocumentContent>
                | ((
                      next: ContentEditorState<DocumentContent> | null,
                  ) => ContentEditorState<DocumentContent>),
        ) => void,
    ) {
        this.socket = new WebSocketClient(
            DocumentCollaborationMessageFromServerSchema,
            DocumentCollaborationMessageFromClientSchema,
            httpToWs(`${COLLABORATION_WORKER_HOST}/documents/${this.documentId}/ws`),
        );

        this.destroyCallbacks.push(() => this.socket.disconnect());

        this.destroyCallbacks.push(
            // whenever we connect, we should fetch all version since the last
            this.socket.onConnect(() => {
                const currentLatestVersion = this.getState().getVersion();
                this.socket.send({type: "listenSince", version: currentLatestVersion});
            }),
        );

        this.destroyCallbacks.push(this.socket.onMessage(message => this.handleMessage(message)));

        this.socket.connect();
        // void this.initialize();
    }

    // private async initialize() {
    //     const initialData = await DocumentCollaborationReadSnapshotResponse.receive(
    //         await fetch(`${EDIT_WORKER_HOST}/documents/${this.documentId}/read-snapshot`),
    //     );
    //     if (this.isDestroyed) return;

    //     this.setState(
    //         ContentEditorState.createCollab({
    //             content: initialData.snapshot,
    //             version: initialData.version,
    //         }),
    //     );

    //     // only connect the websocket connection after the initial data is loaded:
    //     this.socket.connect();
    // }

    onConnect(cb: () => void) {
        return this.socket.onConnect(cb);
    }
    onDisconnect(cb: () => void) {
        return this.socket.onDisconnect(cb);
    }

    destroy() {
        this.isDestroyed = true;
        for (const cb of this.destroyCallbacks) {
            cb();
        }
    }

    stateDidChange(newState: ContentEditorState<DocumentContent>) {
        if (this.unacknowledgedStepsId) return;

        const changes = newState.sendableSteps();
        if (!changes) return;

        this.unacknowledgedStepsId = changes.clientId;
        this.socket.send({
            type: "steps",
            clientId: changes.clientId,
            version: changes.version,
            steps: changes.steps,
        });
    }

    private handleMessage(message: DocumentCollaborationMessageFromServer) {
        // replace with exhaustive switch when we have more message types
        cast<"steps">(message.type);

        const state = this.getState();

        // TODO: remove this assertion, fetch missing versions instead?
        assert(message.version === this.getState().getVersion());

        let newState = state.receiveSteps(
            message.steps.map(step => ({step, clientId: message.clientId})),
        );
        if (message.clientId === this.unacknowledgedStepsId) {
            this.unacknowledgedStepsId = null;
        }
        this.setState(newState);
    }
}
