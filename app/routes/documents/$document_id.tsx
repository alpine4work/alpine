import {BlobFactory} from "~/client/blob_factory/blob_factory";
import {BlobFactoryInterpolateMode} from "~/client/blob_factory/blob_factory_types";
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
        shouldForceOutsideChromaLightness: {
            defaultValue: true,
            schema: Schema.boolean,
        },
        forcedOutsideChroma: {
            defaultValue: 70,
            schema: Schema.float,
        },
        forcedOutsideLightness: {
            defaultValue: 75,
            schema: Schema.float,
        },
        interpolateMode: {
            defaultValue: BlobFactoryInterpolateMode.Naive,
            schema: Schema.enum([
                BlobFactoryInterpolateMode.Naive,
                BlobFactoryInterpolateMode.Min,
                BlobFactoryInterpolateMode.Vector,
            ]),
        },
        colorLevel: {
            defaultValue: 30,
            schema: Schema.integer,
        },
        minBlobCount: {
            defaultValue: 5,
            schema: Schema.integer,
        },
        maxBlobCount: {
            defaultValue: 8,
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
            defaultValue: 1.2,
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
                    colorLevel:
                        colorScheme === "light"
                            ? 0 + settings.colorLevel
                            : 100 - settings.colorLevel,
                    forcedOutsideLightness:
                        colorScheme === "light"
                            ? 0 + settings.forcedOutsideLightness
                            : 100 - settings.forcedOutsideLightness,
                    backgroundColor: colorScheme === "light" ? "grey-0" : "grey-100",
                }}
            />
            <DocumentContentEditor document={document} />
        </main>
    );
}
