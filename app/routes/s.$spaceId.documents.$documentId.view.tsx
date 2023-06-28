import {DocumentContentView} from "~/client/documents/document_content_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {getDocument} from "~/server/dynamo/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);

    const document = await getDocument(await context.actor.authenticate(), documentId);

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => ({
    title: document.getTitle(),
}));

export default function DocumentViewRoute() {
    const {document} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <SpaceRouteScrollView>
            <DocumentContentView
                // Re-render when the document changes
                key={document.id}
                document={document}
            />
        </SpaceRouteScrollView>
    );
}
