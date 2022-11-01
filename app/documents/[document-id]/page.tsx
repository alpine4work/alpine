import {notFound} from "next/navigation";
import {
    DocumentContentEditorBridge,
    propsSchema,
} from "~/app/documents/[document-id]/document-content-editor-bridge";
import * as x from "~/app/documents/[document-id]/document-content-editor-bridge";
import {getDocument} from "~/server/dynamo/documents-table";
import {Schema} from "~/shared/schema/schema";

export default async function DocumentPage({params}: {params: {"document-id": string}}) {
    console.log(x);

    const documentId = Schema.id.deserialize(params["document-id"]);

    const document = await getDocument(documentId);
    if (!document) throw notFound();

    return <DocumentContentEditorBridge {...propsSchema.serialize({document})} />;
}
