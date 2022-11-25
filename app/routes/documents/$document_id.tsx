import {useId, useState} from "react";
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
import {Vector2} from "~/shared/helpers/geometry/vector2";
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
    const id = useId().replace(/:/g, "_");
    const {document} = useLoaderDataWithSchema(schema);
    const colorScheme = useColorScheme();
    const [textFill, setTextFill] = useState<{url: string; offsetX: number; size: Vector2} | null>(
        null,
    );

    const settings = useDeveloperConsoleSettingsObject("blobs", {
        textFillEnabled: {
            defaultValue: true,
            schema: Schema.boolean,
        },
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
        colorLevelTextLight: {
            defaultValue: 75,
            schema: Schema.integer,
        },
        colorLevelTextDark: {
            defaultValue: 20,
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
        <main id={id}>
            {/* the actual background */}
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
            {/* the text fill */}
            {settings.textFillEnabled && (
                <BlobFactory
                    style={{opacity: 0}}
                    height={800}
                    randomSeed={settings.seed}
                    settings={{
                        ...settings,
                        shouldDrawInside: false,
                        colorLevelInside: 0,
                        colorLevelOutside:
                            colorScheme === "light"
                                ? settings.colorLevelTextLight
                                : settings.colorLevelTextDark,
                        backgroundColor: colorScheme === "light" ? "grey-0" : "grey-100",
                        // make sure the whole image is filled with color
                        blurSpread: 1,
                    }}
                    onDraw={(canvas, size, contentWidthPx) => {
                        setTextFill({
                            url: canvas.toDataURL(),
                            size,
                            offsetX: -(size.x - contentWidthPx) / 2,
                        });
                    }}
                />
            )}
            <DocumentContentEditor document={document} />
            {settings.textFillEnabled && textFill && (
                <style>{`
                    #${id} .contentSchemaTitle {
                        background-image: url(${textFill.url});
                        background-size: ${textFill.size.x}px ${textFill.size.y}px;
                        background-position: ${textFill.offsetX}px 0;
                        background-clip: text;
                        -webkit-background-clip: text;
                        text-fill-color: transparent;
                        -webkit-text-fill-color: transparent;
                    }
                `}</style>
            )}
        </main>
    );
}
