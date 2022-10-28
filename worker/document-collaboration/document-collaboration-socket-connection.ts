import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
} from "~/shared/documents/document-collaboration-schema";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter, Unsubscribe} from "~/shared/helpers/control/event-emitter";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId} from "~/shared/id/id";
import {DocumentCollaborationDurableObject} from "~/worker/document-collaboration/document-collaboration-durable-object";

export class DocumentCollaborationSocketConnection {
    private closeEvent = new EventEmitter();

    constructor(
        private readonly socket: WebSocket,
        private readonly session: DocumentCollaborationDurableObject,
    ) {
        // @ts-expect-error why aren't my cloudflare types getting picked up properly?
        socket.accept();

        socket.addEventListener("close", () => {
            this.closeEvent.emit();
        });

        socket.addEventListener("message", event => {
            console.log("message", event.data);

            if (event.data === "ping") {
                this.sendRawMessage("pong");
                return;
            }

            void (async () => {
                try {
                    const message = DocumentCollaborationMessageFromClientSchema.deserialize(
                        JSON.parse(event.data),
                    );
                    await this.handleMessage(message);
                } catch (err) {
                    console.log("Error handling websocket message, closing connection:", err);
                    this.socket.close();
                }
            })();
        });
    }

    async handleMessage(message: DocumentCollaborationMessageFromClient) {
        switch (message.type) {
            case "listenSince": {
                assert(
                    message.version <= this.session.getSnapshotVersion(),
                    "client cannot be ahead of server",
                );
                if (message.version === this.session.getSnapshotVersion()) {
                    // client has the latest version, nothing to send
                    return;
                }
                // client has versions to catch up on:
                this.send({
                    type: "steps",
                    steps: (await this.session.steps.readStepsSince(message.version)).map(
                        step => step.step,
                    ),
                    version: message.version,
                    // TODO: populate these two correctly
                    clientId: generateId(),
                    requestId: generateId(),
                });
                return;
            }
            case "steps": {
                await this.session.updateDocument(
                    message.version,
                    message.steps,
                    message.clientId,
                    message.requestId,
                );
                return;
            }
            default: {
                throw exhaustive(message);
            }
        }
    }

    private sendRawMessage(message: string): void {
        try {
            this.socket.send(message);
        } catch (error) {
            console.log("error sending message, closing connection", error);
            this.closeEvent.emit();
            this.socket.close();
        }
    }

    send(message: DocumentCollaborationMessageFromServer): void {
        this.sendRawMessage(
            JSON.stringify(DocumentCollaborationMessageFromServerSchema.serialize(message)),
        );
    }

    onClose(callback: () => void): Unsubscribe {
        return this.closeEvent.subscribe(callback);
    }
}
