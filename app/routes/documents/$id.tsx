import {DocumentContentEditor} from "~/client/documents/document-content-editor";
import {useLoaderDataWithSchema} from "~/client/helpers/schema/use-loader-data-with-schema";
import {getDocument} from "~/server/dynamo/documents-table";
import {jsonWithSchema} from "~/server/helpers/schema/json-with-schema";
import {DocumentModel} from "~/shared/documents/document-model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

const schema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params}: {params: {id: string}}) {
    const documentId = Schema.id.deserialize(params.id);

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
