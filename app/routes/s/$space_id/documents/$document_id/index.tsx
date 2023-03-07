import {useEffect} from "react";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
import {createDocument, getDocument} from "~/server/dynamo/documents_table";
import {getContentReferencesFromNode} from "~/server/dynamo/helpers/get_content_references";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {emptyDocumentContent} from "~/shared/content/document_content_schema";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
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

            const [newDocument, contentReferences] = await runAllPromises([
                createDocument(await context.auth.authenticate(), {
                    id: documentId,
                    spaceId,
                    content,
                }),
                getContentReferencesFromNode(await context.auth.authenticate(), spaceId, content),
            ]);

            document = new DocumentModel({
                ...newDocument,
                spaceId,
                content: {
                    doc: content,
                    references: contentReferences,
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

    return jsonWithSchema(schema, {document}, {propagateEventData});
}

export default function DocumentRoute() {
    const {document} = useLoaderDataWithSchema(schema);

    // Silently remove the `create` query parameter. We don't invoke a function
    // that would tell `react-router-dom` about the URL update since we don't want
    // to re-render or re-run our loader.
    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.has("create")) {
            url.searchParams.delete("create");
            window.history.replaceState(null, "", url);
        }
    }, []);

    return (
        <SpaceRouteScrollView>
            <DocumentContentEditor
                // Re-render when the document changes
                key={document.id}
                document={document}
            />
        </SpaceRouteScrollView>
    );
}
