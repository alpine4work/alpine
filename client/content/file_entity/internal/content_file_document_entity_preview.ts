import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {getBlobsHtmlGenerator} from "~/client/blobs/get_blobs_html_generator.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {setupContentFileEntityPreviewContainer} from "~/client/content/file_entity/internal/content_file_entity_preview_container.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {actuallyRenderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {getPlatformRouteLayout} from "~/client/remix/route_layout_context.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {contentStyles} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileDocumentEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        fileEntity: unknownFileEntity,
        layout,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        currentAccount,
        transformScale: originalTransformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        currentAccount: AccountModel | null;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers | null;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileDocumentEntityModelSchema);

    const {
        scaledContainerHtml: scaledDocHtml,
        transformScale,
        scaledWidthPx,
        blockMaxWidthPx,
    } = setupContentFileEntityPreviewContainer(html, {
        layout,
        platform,
        spacingScale,
        withoutContainerPaddingY: true,
        transformScaleBaseFontSize: "75",
        scaledContainerStyles: [
            // Document title top margin is computed using safe area inset. So zero out
            // safe area inset which shouldn't apply here.
            "--safe-area-inset-top-base: 0px",
            "--safe-area-inset-top: 0px",
        ],
        calculateScaledContainerTransformStyle: config => {
            // Document-specific margin top calculation
            const marginTopPx = Math.max(
                config.paddingPx * 1.5,
                (layout.width - config.blockMaxWidthPx * config.transformScale) / 2,
            );
            return `translateY(${marginTopPx}px) scale(${config.transformScale}) translateY(-${
                contentStyles.titlePaddingTop[getPlatformRouteLayout(platform, "narrow")]
            })`;
        },
    });

    const content = fileEntity.preview?.content ?? {
        doc: createDummyDocumentContent(fileEntity.titleWithoutFallback),
        references: emptyDocumentContentReferences,
    };

    const cover: DocumentContentCover = content.doc.attrs.cover;
    if (cover?.type === "Blobs") {
        const canvasHtml = getBlobsHtmlGenerator(cover);
        scaledDocHtml.appendChild(canvasHtml);
    }

    const docHtml = scaledDocHtml.appendChild(new HtmlElementGenerator("div"));
    docHtml.setAttribute(
        "class",
        classNames(
            contentStyles.docClassName,
            contentStyles.narrowRouteLayoutDocClassName,
            contentStyles.withUserSelectNoneDocClassName,
            isContentTitleEmpty(content.doc) && contentStyles.emptyTitleClassName,
            isContentBodyEmpty(content.doc) && contentStyles.emptyBodyClassName,
        ),
    );

    const docFragmentHtml = actuallyRenderContentFragmentToHtmlGeneratorStore(get, content, {
        placeholder: "Share your ideas…",
        isInert: true,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        currentAccount,
        // If we render files/tables inside the preview make sure they have an
        // appropriately scaled block width (important for row of 3 recursive docs use
        // case). Make sure that block width doesn't exceed the max width, though
        // (important for row of 1 recursive docs use case).
        blockWidth: Math.min(scaledWidthPx, blockMaxWidthPx),
        transformScale: originalTransformScale * transformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
    });

    docHtml.appendChild(docFragmentHtml);
}

function createDummyDocumentContent(title: string): DocumentContent {
    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node(
            "doc",
            {
                accessPolicy: cast<AccessPolicy>({
                    accountGrantById: emptyMap,
                    defaultGrant: null,
                    urlGrant: null,
                }),
            },
            [
                DocumentContentProsemirrorSchema.node(
                    "title",
                    null,
                    title.length > 0 ? [DocumentContentProsemirrorSchema.text(title)] : [],
                ),
                DocumentContentProsemirrorSchema.node("paragraph"),
            ],
        ),
    );
}
