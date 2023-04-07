import {ShouldReloadFunction, useSearchParams} from "@remix-run/react";
import {useEffect} from "react";
import {AppContext} from "~/client/context/app_context";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
// eslint-disable-next-line no-internal-imports
import {DocumentContentEditorWebSocketClient} from "~/client/documents/internal/document_content_editor_web_socket_client";
// eslint-disable-next-line no-internal-imports
import {DocumentRouteContext} from "~/client/documents/internal/types/document_route_context";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
import {createDocument, getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {emptyDocumentContent} from "~/shared/content/document_content_schema";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {
    DocumentModel,
    emptyDocumentContentReferences,
    getDocumentContentTitle,
} from "~/shared/models/document_model";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context, request}: LoaderArgs) {
    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);

    let document: DocumentModel | null = null;

    // If the `create` query parameter is included then we will attempt to create
    // the document if it does not already exist. If the document does already
    // exist then we will load it.
    if (url.searchParams.has("create")) {
        try {
            const content = emptyDocumentContent;

            const newDocument = await createDocument(await context.auth.authenticate(), {
                id: documentId,
                spaceId,
                content,
            });

            document = new DocumentModel({
                ...newDocument,
                spaceId,
                content: {
                    doc: content,
                    references: emptyDocumentContentReferences,
                },
            });
        } catch (error) {
            if (error instanceof FailedPreconditionError) {
                // The document already exists! Try reading it...
            } else {
                throw error;
            }
        }
    }

    if (document === null)
        document = await getDocument(await context.auth.authenticate(), documentId);

    if (!document) throw new NotFoundError("Document not found");

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => ({
    title: document.getTitle(),
}));

// If only the `create` search param on the URL changed, we don't need to reload.
export const unstable_shouldReload: ShouldReloadFunction = ({url: _url, prevUrl: _prevUrl}) => {
    const url = new URL(_url);
    const prevUrl = new URL(_prevUrl);

    url.searchParams.delete("create");
    prevUrl.searchParams.delete("create");

    return url.toString() !== prevUrl.toString();
};

export default function DocumentRoute() {
    const {document} = useLoaderDataWithSchema(LoaderSchema);
    const [searchParams, setSearchParams] = useSearchParams();
    const updateMetaTitle = useUpdateMetaTitle();

    // Remove the `create` search param.
    useEffect(() => {
        if (searchParams.has("create")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            setSearchParams(newSearchParams);
        }
    }, [searchParams, setSearchParams]);

    return (
        <DocumentContentEditor
            // Re-render when the document changes
            key={document.id}
            document={document}
            onDocumentContentChange={content =>
                updateMetaTitle(`${getDocumentContentTitle(content)}${metaTitlePostfix}`)
            }
        />
    );
}

// See `<DocumentRouteContextProvider>` for how this is used.
DocumentRoute.createDocumentRouteContext = (
    getContext: () => AppContext,
    loaderData: SchemaSerializedObjectValue,
): DocumentRouteContext => {
    const {document} = getLoaderDataWithSchema(LoaderSchema, loaderData);

    return {
        connectCountRef: {current: 0},
        client: new DocumentContentEditorWebSocketClient(getContext, document.id, document),
    };
};
