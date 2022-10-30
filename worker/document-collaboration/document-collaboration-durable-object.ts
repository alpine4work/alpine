import {Mapping, Step} from "prosemirror-transform";
import {DocumentCollaborationSocketConnection} from "~/worker/document-collaboration/document-collaboration-socket-connection";
import {
    DocumentCollaborationStepRange,
    DocumentCollaborationStepRangeSchema,
    DocumentCollaborationStepStore,
} from "~/worker/document-collaboration/document-collaboration-step-store";
import {DurableObjectValue} from "~/worker/helpers/durable-object-value";
import {
    DocumentCollaborationCommittedStep,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationReadSnapshotResponse,
} from "~/shared/documents/document-collaboration-schema";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document-content-schema";
import {DataLossError, FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";
import {getDocument} from "~/shared/network/documents-network-definition";
import {Schema} from "~/shared/schema/schema";

export class DocumentCollaborationDurableObject {
    // these are all initialized asynchronously, but it's convenient to assume
    // they exist. be careful!
    documentId!: DurableObjectValue<Id | null>;
    versionsRange!: DurableObjectValue<DocumentCollaborationStepRange>;
    steps!: DocumentCollaborationStepStore;
    snapshot!: DocumentContent;

    connections = new Set<DocumentCollaborationSocketConnection>();

    constructor(private readonly state: DurableObjectState) {
        void this.state.blockConcurrencyWhile(async () => {
            this.documentId = await DurableObjectValue.createNullable(
                this.state.storage,
                "documentId",
                Schema.id,
            );
            const documentId = this.documentId.get();
            if (documentId) {
                await this.initializeIfNeeded(documentId);
            }
        });
    }

    async initializeIfNeeded(documentId: Id) {
        if (this.documentId.get()) {
            assert(this.documentId.get() === documentId);
        }

        if (this.snapshot) {
            return;
        }

        await this.state.blockConcurrencyWhile(async () => {
            const {document} = await getDocument({id: documentId});
            assert(document, "document must exist");
            this.documentId.set(documentId);

            this.versionsRange = await DurableObjectValue.create(
                this.state.storage,
                "versionsRange",
                DocumentCollaborationStepRangeSchema,
                () => ({startAfterVersion: document.version, endVersion: document.version}),
            );

            this.steps = new DocumentCollaborationStepStore(
                this.state,
                documentId,
                this.versionsRange,
            );

            const {startAfterVersion, endVersion} = this.versionsRange.get();
            assert(startAfterVersion <= document.version);
            if (endVersion > document.version) {
                // we have ops that our durable object has seen but the source-of-truth server
                // hasn't, so lets fast-forward our snapshot:
                let content = document.content;
                for (const {step} of await this.steps.readStepsSince(document.version)) {
                    content = applyStepToContent(content, step);
                }
                this.snapshot = content;
            } else {
                this.snapshot = document.content;
            }
        });
    }

    getSnapshotVersion(): number {
        return this.versionsRange.get().endVersion;
    }

    async fetch(request: Request): Promise<Response> {
        const documentId = Schema.id.deserialize(request.headers.get("x-document-id"));
        await this.initializeIfNeeded(documentId);

        const url = new URL(request.url);
        const path = url.pathname.slice(1).split("/");

        switch (path[0]) {
            case "ws": {
                if (request.headers.get("Upgrade") !== "websocket") {
                    return new Response("not a websocket request", {status: 400});
                }

                const socketPair = new WebSocketPair();
                const clientSocket = socketPair[0];
                const serverSocket = socketPair[1];

                const connection = new DocumentCollaborationSocketConnection(serverSocket, this);
                const unsubscribeClose = connection.onClose(() => {
                    unsubscribeClose();
                    this.connections.delete(connection);
                });
                this.connections.add(connection);

                return new Response(null, {status: 101, webSocket: clientSocket});
            }
            case "read-snapshot": {
                console.log(this);
                return DocumentCollaborationReadSnapshotResponse.send({
                    version: this.getSnapshotVersion(),
                    snapshot: this.snapshot,
                });
            }
            default: {
                return new Response("document route not found", {status: 404});
            }
        }
    }

    /**
     * Copy pasted & modified from documents-table.ts
     */
    // TODO: update this with changes from latest version
    async updateDocument(
        clientVersion: number,
        clientSteps: ReadonlyArray<Step>,
        clientId: Id,
        clientRequestId: Id,
    ) {
        await this.state.blockConcurrencyWhile(async () => {
            if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
                throw new InvalidArgumentError("Expected a positive integer version number");

            if (clientVersion > this.getSnapshotVersion())
                throw new FailedPreconditionError(
                    "Can not update document with steps at version ahead of the document's current version",
                );

            let newContent = this.snapshot;
            let newSteps: ReadonlyArray<Step>;

            // If the client's version is the same as our server version then we can
            // directly apply the client's steps to the content.
            if (clientVersion === this.getSnapshotVersion()) {
                for (const step of clientSteps) {
                    newContent = applyStepToContent(newContent, step);
                }

                newSteps = clientSteps;
            }
            // If the client is trying to update an older document version then we need to
            // rebase the client steps against steps which were applied before it.
            else {
                assert(clientVersion < this.getSnapshotVersion());

                // Get the steps that were applied to bring our document from the provided
                // version to the document's current version.
                const stepsToRebaseAgainst = await this.steps.readStepsSince(clientVersion);
                assert(stepsToRebaseAgainst.length === this.getSnapshotVersion() - clientVersion);

                const invertedClientSteps = [];

                // Make sure all steps from the client were valid against the document at
                // `clientVersion`. So revert back to to that version and try applying our
                // client steps.
                //
                // We will drop any steps we can't rebase. But we still want to validate that
                // the original steps were ok.
                {
                    let clientContent = newContent;

                    for (let i = stepsToRebaseAgainst.length - 1; i >= 0; i--) {
                        const step = stepsToRebaseAgainst[i]!;
                        const stepResult = step.step.invert(clientContent).apply(clientContent);
                        if (!stepResult.doc)
                            throw new DataLossError(
                                `Could not apply inverse of saved document step: ${stepResult.failed!}`,
                            );

                        assert(isDocumentContent(stepResult.doc));
                        clientContent = stepResult.doc;
                    }

                    for (const step of clientSteps) {
                        clientContent = applyStepToContent(clientContent, step);
                        invertedClientSteps.push(step.invert(clientContent));
                    }
                }

                // See the guide for information on how to rebase a chain of steps against
                // another chain of steps:
                // https://prosemirror.net/docs/guide/#transform.rebasing
                //
                // Also see the client-side rebasing implementation:
                // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L14-L27
                const mapping = new Mapping();

                for (let i = invertedClientSteps.length - 1; i >= 0; i--)
                    mapping.appendMap(invertedClientSteps[i]!.getMap());
                for (let i = 0; i < stepsToRebaseAgainst.length; i++)
                    mapping.appendMap(stepsToRebaseAgainst[i]!.step.getMap());

                const rebasedSteps = [];
                let mapFrom = clientSteps.length;

                for (let i = 0; i < clientSteps.length; i++) {
                    const rebasedStep = clientSteps[i]!.map(mapping.slice(mapFrom));
                    mapFrom--;

                    // Silently ignore steps we can't rebase. That's what the client
                    // implementation does:
                    // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                    if (!rebasedStep) continue;

                    const rebasedStepResult = rebasedStep.apply(newContent);

                    // Silently ignore steps we can't rebase. That's what the client
                    // implementation does:
                    // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                    if (!rebasedStepResult.doc) continue;

                    assert(isDocumentContent(rebasedStepResult.doc));
                    newContent = rebasedStepResult.doc;
                    rebasedSteps.push(rebasedStep);
                    mapping.appendMap(rebasedStep.getMap());
                }

                newSteps = rebasedSteps;
            }

            const oldVersion = this.getSnapshotVersion();
            const newVersion = this.getSnapshotVersion() + newSteps.length;

            const committedSteps: ReadonlyArray<DocumentCollaborationCommittedStep> = newSteps.map(
                (step, i) => ({
                    step,
                    version: this.getSnapshotVersion() + i + 1,
                }),
            );
            assert(committedSteps[committedSteps.length - 1]?.version === newVersion);

            this.steps.writeCommittedSteps(committedSteps);
            this.snapshot = newContent;

            this.broadcastToClients({
                type: "steps",
                steps: newSteps,
                version: oldVersion,
                clientId,
                requestId: clientRequestId,
            });
        });
    }

    broadcastToClients(message: DocumentCollaborationMessageFromServer) {
        for (const client of this.connections) {
            client.send(message);
        }
    }
}

function applyStepToContent(content: DocumentContent, step: Step) {
    const stepResult = step.apply(content);
    if (!stepResult.doc)
        throw new FailedPreconditionError(
            `Could not apply step to document: ${stepResult.failed!}`,
        );

    assert(isDocumentContent(stepResult.doc));
    return stepResult.doc;
}
