import {useId} from "react";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {DocumentId} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);

    const document = await getDocument(await context.auth.authenticate(), documentId);
    if (!document) throw new NotFoundError("Document not found");

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(schema, {document}, {propagateEventData});
}

export default function DocumentRoute() {
    const id = useId().replace(/:/g, "_");
    const {document} = useLoaderDataWithSchema(schema);

    return (
        <main id={id} className={sprinkles({height: "full"})}>
            <DocumentContentEditor document={document} />
        </main>
    );
}
