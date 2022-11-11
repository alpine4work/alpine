import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/helpers/schema/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/helpers/schema/json_with_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

const schema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params}: {params: {document_id: string}}) {
    const documentId = Schema.id.deserialize(params.document_id);

    const document = await getDocument(documentId);
    if (!document) throw new NotFoundError("Document not found");

    return jsonWithSchema(schema, {document});
}

export default function DocumentRoute() {
    const {document} = useLoaderDataWithSchema(schema);

    return (
        <main className={sprinkles({height: "full"})}>
            <DocumentContentEditor document={document} />
        </main>
    );
}
