import {useMemo} from "react";
import {BlobFactory} from "~/client/blob_factory/blob_factory";
import {
    BlobFactoryInterpolateMode,
    BlobFactoryMode,
    BlobFactorySettings,
} from "~/client/blob_factory/blob_factory_types";
import {useColorScheme} from "~/client/design/color_scheme";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/helpers/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
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
    const colorScheme = useColorScheme();

    const settings: BlobFactorySettings = useMemo(
        () => ({
            smoothness: 300,
            blurSize: 200,
            blurSpread: 0.9,
            mode: BlobFactoryMode.Blur,
            interpolateMode: BlobFactoryInterpolateMode.Naive,
            hueBias: 180,
            colorLevel: colorScheme === "dark" ? 90 : 10,
        }),
        [colorScheme],
    );

    return (
        <main
            // className={sprinkles({
            //     height: "full",
            // })}
            style={{background: colorScheme === "dark" ? "black" : "light"}}
        >
            <BlobFactory height={800} fadeToBlank={true} settings={settings} />
            <DocumentContentEditor document={document} />
        </main>
    );
}
