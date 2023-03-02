import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {DocumentCollaborationContentManager} from "~/server/documents/document_collaboration_content_manager";
import {DocumentCollaborationDurableObjectConnection} from "~/server/documents/document_collaboration_durable_object_connection";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDocument} from "~/server/dynamo/documents_table";
import {DocumentContent} from "~/shared/content/document_content_schema";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
} from "~/shared/documents/document_collaboration_schema";
import {NotFoundError} from "~/shared/error/error";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

class DocumentCollaborationDurableObject {
    public static serviceName = "DocumentCollaborationService" as const;

    private readonly _context: ProcessContext;
    public readonly spaceId: SpaceId;
    public readonly id: DocumentId;
    private readonly _contentManager: DocumentCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServer: WebSocketServer<
        DocumentCollaborationMessageFromClient,
        DocumentCollaborationMessageFromServer,
        DocumentCollaborationDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        initializeRequestContext,
        idName,
        destroy,
    }: {
        processContext: ProcessContext;
        initializeRequestContext: RequestContext;
        idName: string;
        destroy: () => void;
    }): Promise<DocumentCollaborationDurableObject> {
        const documentId = Schema.id<DocumentId>().deserialize(idName);

        const document = await getDocument(initializeRequestContext, documentId);
        if (!document) throw new NotFoundError("Document not found");

        return new DocumentCollaborationDurableObject({
            context: processContext,
            spaceId: document.spaceId,
            id: document.id,
            initialVersion: document.version,
            initialContent: document.content.doc,
            destroy,
        });
    }

    private constructor({
        context,
        spaceId,
        id,
        initialVersion,
        initialContent,
        destroy,
    }: {
        context: ProcessContext;
        spaceId: SpaceId;
        id: DocumentId;
        initialVersion: number;
        initialContent: DocumentContent;
        destroy: () => void;
    }) {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({context: {spaceId, documentId: id}});

        this._context = context;
        this.spaceId = spaceId;
        this.id = id;
        this._contentManager = new DocumentCollaborationContentManager({
            spaceId,
            id,
            initialVersion,
            initialContent,
            sendMessageToAll: (context, message) =>
                this._webSocketServer.sendMessageToAll(context, message),
            destroyDurableObject: context => this._destroy(context),
        });
        this._destroyCallback = destroy;

        this._webSocketServer = new WebSocketServer(
            this._context,
            DocumentCollaborationMessageFromClientSchema,
            DocumentCollaborationMessageFromServerSchema,
            ({connectionId, sendMessage, sendMessageToOthers, iterateOtherConnections}) =>
                new DocumentCollaborationDurableObjectConnection({
                    connectionId,
                    contentManager: this._contentManager,
                    sendMessage,
                    sendMessageToOthers,
                    iterateOtherConnections,
                    destroyDurableObject: context => this._destroy(context),
                }),
        );
    }

    public fetch(context: RequestContext, request: Request): Response {
        // Propagate the document id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, documentId: this.id},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context, request);
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
