import {BlobFactory} from "~/client/blob_factory/blob_factory";
import {
    BlobFactoryInterpolateMode,
    BlobFactoryMode,
} from "~/client/blob_factory/blob_factory_types";
import {useColorScheme} from "~/client/design/color_scheme";
import {useDeveloperConsoleSettingsObject} from "~/client/developer_console";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useLoaderDataWithSchema} from "~/client/helpers/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";

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

    const settings = useDeveloperConsoleSettingsObject("blobs", {
        smoothness: {
            defaultValue: 300,
            schema: Schema.float,
        },
        blurSize: {
            defaultValue: 200,
            schema: Schema.float,
        },
        blurSpread: {
            defaultValue: 0.9,
            schema: Schema.float,
        },
        mode: {
            defaultValue: BlobFactoryMode.Blur,
            schema: Schema.enum([
                BlobFactoryMode.Blur,
                BlobFactoryMode.Fill,
                BlobFactoryMode.Inside,
                BlobFactoryMode.Outside,
            ]),
        },
        interpolateMode: {
            defaultValue: BlobFactoryInterpolateMode.Naive,
            schema: Schema.enum([
                BlobFactoryInterpolateMode.Naive,
                BlobFactoryInterpolateMode.Min,
                BlobFactoryInterpolateMode.Vector,
            ]),
        },
        hueBias: {
            defaultValue: 180,
            schema: Schema.integer,
        },
        colorLevel: {
            defaultValue: 10,
            schema: Schema.integer,
        },
    });

    return (
        <main>
            <BlobFactory
                height={800}
                fadeToBlank={true}
                settings={{
                    ...settings,
                    colorLevel:
                        colorScheme === "light"
                            ? 0 + settings.colorLevel
                            : 100 - settings.colorLevel,
                    backgroundColor: colorScheme === "light" ? "grey-0" : "grey-100",
                }}
            />
            <DocumentContentEditor document={document} />
        </main>
    );
}
