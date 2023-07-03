import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {DocumentCollaborationConnection} from "~/server/documents/document_collaboration_connection.js";
import {DocumentCollaborationContentManager} from "~/server/documents/document_collaboration_content_manager.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {NotFoundError} from "~/shared/error/error.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {authorizeDocumentAccess, getDocument} from "~/shared/rpc/documents_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

class DocumentCollaborationDurableObject {
    public static readonly serviceName = "DocumentCollaborationService";

    private readonly _processContext: WorkerProcessContext;
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        typeof DocumentCollaborationProtocol,
        DocumentCollaborationConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
    }): Promise<DocumentCollaborationDurableObject> {
        const documentId = Schema.id<DocumentId>().deserialize(idName);

        const {document} = await getDocument(initializeActionContext, {documentId});

        return new DocumentCollaborationDurableObject({
            processContext,
            spaceId: document.spaceId,
            id: document.id,
            initialVersion: document.version,
            initialContent: document.content.doc,
            destroy,
        });
    }

    private constructor({
        processContext,
        spaceId,
        id,
        initialVersion,
        initialContent,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        destroy: () => void;
    }) {
        // Propagate the document id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({
            context: {spaceId, documentId: id},
        });

        this._processContext = processContext;
        this.spaceId = spaceId;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            spaceId,
            id,
            initialVersion,
            initialContent,
            sendEventToAll: (context, event) =>
                this._webSocketServer.sendEventToAll(context, event),
            killProcess: context => this._destroy(context),
        });
        this._destroyCallback = destroy;

        this._webSocketServer = new WebSocketServer(
            this._processContext,
            DocumentCollaborationProtocol,
            async ({
                connectActionContext,
                connectionId,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
            }) => {
                await authorizeDocumentAccess(connectActionContext, {documentId: id});

                return new DocumentCollaborationConnection({
                    connectionId,
                    contentManager: this._contentManager,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                    killProcess: context => this._destroy(context),
                });
            },
        );
    }

    public fetch(context: WorkerActionContext, request: Request): Promise<Response> {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }

    private _destroy(context: WorkerProcessContext) {
        this._webSocketServer.closeAll(context);
        this._destroyCallback();
    }
}

const DocumentCollaborationDurableObjectWrapper = createDurableObject(
    DocumentCollaborationDurableObject,
);
export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};
