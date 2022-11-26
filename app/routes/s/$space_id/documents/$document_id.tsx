import {useId} from "react";
import {DocumentBlobFactory, useDocumentBlobSettings} from "~/client/blob_factory/document_blobs";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/helpers/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {DocumentModel} from "~/shared/documents/document_model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";

const schema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: DataFunctionArgs) {
    const documentId = Schema.id.deserialize(params.document_id ?? null);

    const document = await getDocument(await context.authenticate(), documentId);
    if (!document) throw new NotFoundError("Document not found");

    return jsonWithSchema(schema, {document});
}

export default function DocumentRoute() {
    const id = useId().replace(/:/g, "_");
    const {document} = useLoaderDataWithSchema(schema);

    const blobFactorySettings = useDocumentBlobSettings({defaultSeed: document.id});

    return (
        <main id={id}>
            <DocumentBlobFactory settings={blobFactorySettings} containerId={id} />
            <DocumentContentEditor document={document} />
        </main>
    );
}
