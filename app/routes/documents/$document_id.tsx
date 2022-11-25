import {BlobFactory} from "~/client/blob_factory/blob_factory";
import {useColorScheme} from "~/client/design/color_scheme";
import {DocumentContentEditor} from "~/client/documents/document_content_editor";
import {useDeveloperConsoleSettingsObject} from "~/client/helpers/developer_console";
import {useLoaderDataWithSchema} from "~/client/helpers/use_loader_data_with_schema";
import {getDocument} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {themeColors} from "~/shared/design/theme_colors";
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
        seed: {
            defaultValue: document.id,
            schema: Schema.string,
        },
        smoothness: {
            defaultValue: 150,
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
        shouldDrawOutside: {
            defaultValue: true,
            schema: Schema.boolean,
        },
        shouldDrawInside: {
            defaultValue: true,
            schema: Schema.boolean,
        },
        colorLevelInsideLight: {
            defaultValue: 20,
            schema: Schema.integer,
        },
        colorLevelInsideDark: {
            defaultValue: 80,
            schema: Schema.integer,
        },
        colorLevelOutsideLight: {
            defaultValue: 10,
            schema: Schema.integer,
        },
        colorLevelOutsideDark: {
            defaultValue: 90,
            schema: Schema.integer,
        },
        minBlobCount: {
            defaultValue: 6,
            schema: Schema.integer,
        },
        maxBlobCount: {
            defaultValue: 10,
            schema: Schema.integer,
        },
        spreadX: {
            defaultValue: 0.1,
            schema: Schema.float,
        },
        minY: {
            defaultValue: 0,
            schema: Schema.float,
        },
        maxY: {
            defaultValue: 200,
            schema: Schema.float,
        },
        minRadiusFactor: {
            defaultValue: 0.05,
            schema: Schema.float,
        },
        maxRadiusFactor: {
            defaultValue: 0.15,
            schema: Schema.float,
        },
        baseThemeColor: {
            defaultValue: "blue",
            schema: Schema.enum(themeColors),
        },
        colorSpread: {
            defaultValue: 0,
            schema: Schema.float,
        },
        hueSpread: {
            defaultValue: 45,
            schema: Schema.float,
        },
    });

    return (
        <main>
            <BlobFactory
                height={800}
                fadeToBlank={true}
                randomSeed={settings.seed}
                settings={{
                    ...settings,
                    colorLevelInside:
                        colorScheme === "light"
                            ? settings.colorLevelInsideLight
                            : settings.colorLevelInsideDark,
                    colorLevelOutside:
                        colorScheme === "light"
                            ? settings.colorLevelOutsideLight
                            : settings.colorLevelOutsideDark,
                    backgroundColor: colorScheme === "light" ? "grey-0" : "grey-100",
                }}
            />
            <DocumentContentEditor document={document} />
        </main>
    );
}
