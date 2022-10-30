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
import {generateId, Id} from "~/shared/id/id";
import {getDocument, updateDocumentContent} from "~/shared/network/documents-network-definition";
import {Schema, SchemaType} from "~/shared/schema/schema";
import {cast} from "~/shared/helpers/control/cast";
import {logger} from "~/shared/logger";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

// sync every 3 seconds:
const syncDelayMs = 3_000;
// destroy durable objects after 1 hour of inactivity:
const destroyDelayMs = 60 * 60 * 1000;

const DocumentCollaborationDurableObjectAlarmSchema = Schema.union({
    sync: Schema.object({
        type: Schema.value("sync"),
    }),
    destroy: Schema.object({
        type: Schema.value("destroy"),
    }),
});
type DocumentCollaborationDurableObjectAlarm = SchemaType<
    typeof DocumentCollaborationDurableObjectAlarmSchema
>;

type InitializedState = {
    readonly versionsRange: DurableObjectValue<DocumentCollaborationStepRange>;
    readonly steps: DocumentCollaborationStepStore;
    readonly documentId: Id;
    snapshot: DocumentContent;
    readonly alarmData: DurableObjectValue<DocumentCollaborationDurableObjectAlarm | null>;
};

/**
 * Each document collaboration DO represents an edit session. Only one may exist per document at a
 * time. The lifecycle of the DO is:
 * 1. A request is received that causes the DO to get initialized
 * 2. Clients create websocket connections to the DO
 * 3. Edits come in. These update an internal copy of the snapshot, have conflicts resolved, get
 *    written to the object's persistent storage, and get broadcast to other connections
 * 4. Periodically, these updates get written back to dynamo DB
 * 5. After a period of inactivity, the DO destroys itself
 *
 * Each of these steps is roughly transactional, but the DO can be reset (have memory wiped) at any
 * point between the steps. It's important to write any information that needs to persist a memory
 * wipe to the durable storage.
 */
export class DocumentCollaborationDurableObject {
    documentId!: DurableObjectValue<Id | null>;
    connections = new Set<DocumentCollaborationSocketConnection>();
    initializedState: InitializedState | null = null;

    constructor(private readonly object: DurableObjectState) {
        void this.object.blockConcurrencyWhile(async () => {
            this.documentId = await DurableObjectValue.createNullable(
                this.object.storage,
                "documentId",
                Schema.id,
            );
            const documentId = this.documentId.get();
            if (documentId) {
                await this.initializeIfNeeded(documentId);
            }
        });
    }

    getState() {
        assert(this.initializedState, "object must be initialized");
        return this.initializedState;
    }

    async initializeIfNeeded(documentId: Id): Promise<InitializedState> {
        if (this.documentId.get()) {
            assert(this.documentId.get() === documentId);
        }

        if (this.initializedState) {
            return this.initializedState;
        }

        return await this.object.blockConcurrencyWhile(async () => {
            const {document} = await getDocument({id: documentId});
            assert(document, "document must exist");
            this.documentId.set(documentId);

            const versionsRange = await DurableObjectValue.create(
                this.object.storage,
                "versionsRange",
                DocumentCollaborationStepRangeSchema,
                () => ({
                    startAfterVersion: document.version,
                    endVersion: document.version,
                    lastSyncedVersion: document.version,
                }),
            );

            const steps = new DocumentCollaborationStepStore(
                this.object,
                documentId,
                versionsRange,
            );

            const alarmData = await DurableObjectValue.createNullable(
                this.object.storage,
                "alarmData",
                DocumentCollaborationDurableObjectAlarmSchema,
            );

            const {startAfterVersion, endVersion} = versionsRange.get();
            assert(startAfterVersion <= document.version);

            let snapshot;
            if (endVersion > document.version) {
                // we have ops that our durable object has seen but the source-of-truth server
                // hasn't, so lets fast-forward our snapshot:
                let content = document.content;
                for (const {step} of await steps.readStepsSince(document.version)) {
                    content = applyStepToContent(content, step);
                }
                snapshot = content;
            } else {
                snapshot = document.content;
            }

            logger.info(`initialized at version ${document.version}`);

            this.initializedState = {
                snapshot,
                versionsRange,
                steps,
                alarmData,
                documentId,
            };

            // in the absence of anything else happening, make sure we tear down this DO eventually
            await this.scheduleDestroy();

            return this.initializedState;
        });
    }

    getSnapshotVersion(): number {
        return this.getState().versionsRange.get().endVersion;
    }

    async fetch(request: Request): Promise<Response> {
        const documentId = Schema.id.deserialize(request.headers.get("x-document-id"));
        const state = await this.initializeIfNeeded(documentId);

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
                return DocumentCollaborationReadSnapshotResponse.send({
                    version: this.getSnapshotVersion(),
                    snapshot: state.snapshot,
                });
            }
            default: {
                return new Response("document route not found", {status: 404});
            }
        }
    }

    async alarm() {
        const state = this.initializedState;
        assert(state, "object must be initialized!");

        const alarm = state.alarmData.get();
        if (!alarm) return;

        switch (alarm.type) {
            case "sync": {
                const {endVersion, lastSyncedVersion} = state.versionsRange.get();
                if (endVersion === lastSyncedVersion) {
                    this.onSyncComplete(endVersion);
                    return;
                }

                const unsyncedSteps = await state.steps.readStepsSince(lastSyncedVersion);
                logger.info(`writing ${unsyncedSteps.length} steps back to server...`);
                const {newVersion} = await updateDocumentContent({
                    id: state.documentId,
                    version: lastSyncedVersion,
                    steps: unsyncedSteps.map(({step}) => step),
                    clientId: generateId(),
                    fastForwardOnly: true,
                });

                assert(newVersion === endVersion);
                state.versionsRange.setIn("lastSyncedVersion", newVersion);
                state.alarmData.set(null);
                logger.info(`synced up to v${newVersion}`);

                this.onSyncComplete(newVersion);

                return;
            }
            case "destroy": {
                logger.info("destroy alarm triggered");
                const {endVersion, lastSyncedVersion} = state.versionsRange.get();
                if (endVersion !== lastSyncedVersion) {
                    await this.scheduleSync();
                    return;
                }
                if (this.connections.size) {
                    // we still have sockets connected! let's wait a while longer to try and destroy:
                    logger.info("sockets still present, re-scheduling");
                    this.object.storage.deleteAlarm();
                    await this.scheduleDestroy();
                    return;
                }

                logger.info("no connections or unwritten writes, destroying storage...");
                await this.object.storage.deleteAll();
                this.initializedState = null;
                return;
            }
            default:
                throw exhaustive(alarm);
        }
    }

    async hasAlarm(): Promise<boolean> {
        return (await this.object.storage.getAlarm()) !== null;
    }

    async scheduleSync() {
        const currentAlarm = this.getState().alarmData.get();

        if ((await this.hasAlarm()) && currentAlarm && currentAlarm.type === "sync") {
            logger.debug("sync already scheduled, skipping");
            return;
        }

        this.getState().alarmData.set({type: "sync"});
        this.object.storage.setAlarm(Date.now() + syncDelayMs);
        logger.debug("scheduled sync");
    }

    async onSyncComplete(syncedVersion: number) {
        const state = this.getState();
        this.getState().alarmData.set(null);

        if (state.versionsRange.get().endVersion !== syncedVersion) {
            logger.info("more writes found after sync, scheduling sync");
            await this.scheduleSync();
        } else {
            logger.info("all writes flushed successfully, scheduling destroy");
            await this.scheduleDestroy();
        }
    }

    async scheduleDestroy(): Promise<void> {
        const currentAlarm = this.getState().alarmData.get();

        if ((await this.hasAlarm()) && currentAlarm) {
            logger.debug("alarm already scheduled, skipping schedule destroy");
            return;
        }

        this.getState().alarmData.set({type: "destroy"});
        this.object.storage.setAlarm(Date.now() + destroyDelayMs);
        logger.debug("scheduled destory");
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
        await this.object.blockConcurrencyWhile(async () => {
            if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
                throw new InvalidArgumentError("Expected a positive integer version number");

            if (clientVersion > this.getSnapshotVersion())
                throw new FailedPreconditionError(
                    "Can not update document with steps at version ahead of the document's current version",
                );

            const state = this.getState();

            let newContent = state.snapshot;
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
                const stepsToRebaseAgainst = await state.steps.readStepsSince(clientVersion);
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

            state.steps.writeCommittedSteps(committedSteps);
            state.snapshot = newContent;

            await this.scheduleSync();

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
