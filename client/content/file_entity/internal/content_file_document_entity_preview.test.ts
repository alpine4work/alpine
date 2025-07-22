import {CalendarDate} from "@internationalized/date";
import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {renderContentFileDocumentEntityPreview} from "~/client/content/file_entity/internal/content_file_document_entity_preview.js";
import {normalizeHtmlClassNameHashesForTest} from "~/client/content/file_entity/internal/test_helpers/normalize_html_class_name_hashes_for_test.js";
import {getFileRegistry} from "~/client/content/file_registry_context.js";
import {getSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentContentSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {defaultClientInfo} from "~/shared/remix/client_info.js";

// Fixed IDs for deterministic snapshots
const spaceId = assertId<SpaceId>("2pm2pfcv5b2r52nkz2yy1r2x4c");
const currentDate = new CalendarDate(2025, 5, 1);

function createBasicFileDocumentEntityModel({
    id,
    title,
    hasPreview = false,
    content = "Sample content",
}: {
    id: DocumentId;
    title: string;
    hasPreview?: boolean;
    content?: string;
}): FileEntityModel {
    const doc = assertDocumentContent(
        DocumentContentProsemirrorSchema.node(
            "doc",
            {
                accessPolicy: cast<AccessPolicy>({
                    accountGrantById: emptyMap,
                    defaultGrant: null,
                    urlGrant: null,
                }),
                hasPresentShortcut: false,
                cover: null,
            },
            [
                DocumentContentProsemirrorSchema.node(
                    "title",
                    null,
                    title.length > 0 ? [DocumentContentProsemirrorSchema.text(title)] : [],
                ),
                DocumentContentProsemirrorSchema.node(
                    "paragraph",
                    null,
                    content.length > 0 ? [DocumentContentProsemirrorSchema.text(content)] : [],
                ),
            ],
        ),
    );

    const serializedDoc = DocumentContentSchema.serialize(doc);
    const deserializedDoc = DocumentContentSchema.deserialize(serializedDoc);

    const baseModel = {
        type: "Document" as const,
        versions: [0, 1],
        id,
        version: 1,
        titleWithoutFallback: title,
        preview: hasPreview
            ? {
                  version: 1,
                  content: {
                      doc: deserializedDoc,
                      references: emptyDocumentContentReferences,
                  },
              }
            : null,
    };

    return new FileEntityModel(FileDocumentEntityModelSchema, baseModel);
}

// Fixed document ID for deterministic snapshots
const documentId = assertId<DocumentId>("rkb0rfnty8jc5p5trcp3nmwq68");

describe("renderContentFileDocumentEntityPreview - HTML Snapshots", () => {
    const basicParams = {
        getContext: () => {
            throw new UnimplementedError("`getContext()` is unimplemented in this test file");
        },
        clientInfo: defaultClientInfo,
        spaceId,
        accountRegistry: getAccountRegistry(spaceId),
        searchEntityRegistry: getSearchEntityRegistry(spaceId),
        fileRegistry: getFileRegistry(spaceId),
        currentAccount: null,
        transformScale: 1,
        routeLayout: "narrow" as const,
        isInitialAppRender: false,
        currentDate,
        fileEntityRenderers: null as ContentFileEntityRenderers | null,
    };

    const spacingScales = ["small", "medium", "large"] as const;
    const layouts = [
        {width: 100, name: "fourth-width", height: 200},
        {width: 200, name: "third-width", height: 300},
        {width: 300, name: "half-width", height: 400},
        {width: 800, name: "full-width", height: 500},
    ] as const;
    const platforms = ["desktop", "mobile"] as const;

    const testCases = [
        {
            name: "basic-document",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "Test Document",
                    hasPreview: false,
                }),
        },
        {
            name: "document-with-preview",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "Document with Preview",
                    hasPreview: true,
                }),
        },
        {
            name: "empty-title-document",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "",
                    hasPreview: false,
                }),
        },
        {
            name: "empty-content-document",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "Empty Content Document",
                    hasPreview: true,
                    content: "",
                }),
        },
        {
            name: "long-title-document",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "This is a very long document title that should be truncated properly in the preview",
                    hasPreview: true,
                }),
        },
        {
            name: "long-content-document",
            createEntity: () =>
                createBasicFileDocumentEntityModel({
                    id: documentId,
                    title: "Long Content Document",
                    hasPreview: true,
                    content: Array.from(
                        {length: 8},
                        (_, i) =>
                            `${i}. This is a very long content that should be truncated properly in the preview and demonstrate how the document preview handles overflow text content.`,
                    ).join(" "),
                }),
        },
    ] as const;

    spacingScales.forEach(spacingScale => {
        describe(`spacingScale: ${spacingScale}`, () => {
            layouts.forEach(layout => {
                platforms.forEach(platform => {
                    testCases.forEach(testCase => {
                        test(`${layout.name} ${platform} ${testCase.name}`, () => {
                            const fileEntity = testCase.createEntity();
                            const html = new HtmlElementGenerator("div");

                            renderContentFileDocumentEntityPreview(
                                store => store.getSnapshot(),
                                html,
                                {
                                    ...basicParams,
                                    fileEntity,
                                    layout: {
                                        width: layout.width,
                                        widthFr: 1,
                                        height: layout.height,
                                    },
                                    platform,
                                    spacingScale,
                                    suppressHydrationWarning: noop,
                                },
                            );

                            expect(
                                normalizeHtmlClassNameHashesForTest(html.generateHtml()),
                            ).toMatchSnapshot();
                        });
                    });
                });
            });
        });
    });
});
