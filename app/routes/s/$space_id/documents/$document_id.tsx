import {useId} from "react";
import {DocumentBlobFactory, useDocumentBlobSettings} from "~/client/blob_factory/document_blobs";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {LoaderArgs} from "~/server/remix/loader_context";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id.deserialize(params.document_id ?? null);

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

    const blobFactorySettings = useDocumentBlobSettings({defaultSeed: document.id});

    return (
        <main id={id} className={sprinkles({height: "full"})}>
            <DocumentBlobFactory settings={blobFactorySettings} containerId={id} />
            <DocumentContentEditor document={document} />
        </main>
    );
}
