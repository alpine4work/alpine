import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {DocumentCollaborationConnection} from "~/server/documents/document_collaboration_connection";
import {DocumentCollaborationContentManager} from "~/server/documents/document_collaboration_content_manager";
import {ActionContext, SessionActionContext} from "~/server/dynamo/context/action_context";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {authorizeDocumentAccess, getDocument} from "~/server/dynamo/documents_table";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol";
import {DocumentContent} from "~/shared/documents/document_content_schema";
import {NotFoundError} from "~/shared/error/error";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

class DocumentCollaborationDurableObject {
    public static readonly serviceName = "DocumentCollaborationService";

    private readonly _processContext: ProcessContext;
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
        processContext: ProcessContext;
        initializeActionContext: ActionContext;
        idName: string;
        destroy: () => void;
    }): Promise<DocumentCollaborationDurableObject> {
        const documentId = Schema.id<DocumentId>().deserialize(idName);

        const document = await getDocument(initializeActionContext, documentId);

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
        processContext: ProcessContext;
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
                await authorizeDocumentAccess(connectActionContext, id);

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

    public fetch(context: ActionContext, request: Request): Promise<Response> {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: SessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }

    private _destroy(context: ProcessContext) {
        this._webSocketServer.closeAll(context);
        this._destroyCallback();
    }
}

const DocumentCollaborationDurableObjectWrapper = createDurableObject(
    DocumentCollaborationDurableObject,
);
export {DocumentCollaborationDurableObjectWrapper as DocumentCollaborationDurableObject};
