import {MetaFunction} from "@remix-run/server-runtime";
import {DocumentContentView} from "~/client/documents/document_content_view";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {DocumentId} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);

    const document = await getDocument(await context.auth.authenticate(), documentId);
    if (!document) throw new NotFoundError("Document not found");

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document}, {propagateEventData});
}

export const meta: MetaFunction = ({data}) => {
    const {document} = getLoaderDataWithSchema(LoaderSchema, data);

    return {
        title: `${document.getTitle()}${metaTitlePostfix}`,
    };
};

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
