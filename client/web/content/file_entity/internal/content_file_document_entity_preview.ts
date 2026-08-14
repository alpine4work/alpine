import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {renderBlobsArtToHtml} from "~/client/web/blobs/blobs_art_html.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {setupContentFileEntityPreviewContainer} from "~/client/web/content/file_entity/internal/content_file_entity_preview_container.js";
import {renderContentFileEntitySiteBreadcrumb} from "~/client/web/content/file_entity/internal/render_content_file_entity_site_breadcrumb.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {renderContentFragmentToHtmlGeneratorStore} from "~/client/web/content/render_content_to_html.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {getPlatformRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_layout.js";
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
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
        siteRegistry,
        currentAccount,
        transformScale: originalTransformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        suppressHydrationWarning,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        siteRegistry: SiteRegistry;
        currentAccount: AccountModel | null;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers;
        suppressHydrationWarning: () => void;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileDocumentEntityModelSchema);

    const {
        scaledContainerHtml: scaledDocHtml,
        transformScale,
        scaledWidthPx,
        blockMaxWidthPx,
        containerPaddingPx,
    } = setupContentFileEntityPreviewContainer(html, {
        layout,
        platform,
        spacingScale,
        withoutContainerPaddingY: true,
        transformScaleBaseFontSize: "75",
        scaledContainerStyles: [
            // Document title top margin is computed using safe area inset. So zero out safe
            // area inset which shouldn't apply here.
            "--safe-area-inset-top-base: 0px",
            "--safe-area-inset-top: 0px",
        ],
        calculateScaledContainerTransformStyle: config => {
            if (fileEntity.site) {
                // Don't translate the container down for breadcrumb spacing — the cover is
                // anchored to the container's top edge, so a translateY would push the cover down
                // and chop it off from the top of the box. The breadcrumb block carries the
                // container-top-to-breadcrumb-top spacing as `padding-top` instead. Skip the
                // negative `titlePaddingTop` translateY — the title's own top spacing is
                // suppressed via `withoutTitleTopSpacingDocClassName` below.
                return `scale(${config.transformScale})`;
            }
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

    if (fileEntity.site) {
        // Wrap the breadcrumb in a block-styled div so it lines up horizontally with the
        // doc's title and paragraphs below (which inherit the same
        // `max-width: blockMaxWidthVar` + centered margins via their block class). Without
        // the wrapper, the breadcrumb hugs `scaledDocHtml`'s left edge while the title
        // sits at the centered block's left edge — visibly out of alignment for the
        // full-width preview.
        const breadcrumbBlockHtml = scaledDocHtml.appendChild(new HtmlElementGenerator("div"));
        breadcrumbBlockHtml.setAttribute("class", contentStyles.docBlockClassName);
        // Match the container-top-to-breadcrumb-top spacing used by every other entity
        // preview (a single container padding from the box top). This spacing lives here
        // instead of on the scaled container's transform so the cover keeps bleeding from
        // the box top. Divide by the transform scale since this padding is in the
        // container's pre-scale coordinates.
        breadcrumbBlockHtml.setAttribute(
            "style",
            `padding-top: ${containerPaddingPx / transformScale}px`,
        );
        renderContentFileEntitySiteBreadcrumb({
            get,
            siteRegistry,
            parent: breadcrumbBlockHtml,
            site: fileEntity.site,
            platform,
        });
    }

    const cover: DocumentContentCover = content.doc.attrs.cover;
    if (cover?.type === "Blobs") {
        const canvasHtml = renderBlobsArtToHtml(cover, {suppressHydrationWarning});
        scaledDocHtml.appendChild(canvasHtml);
    }

    const docHtml = scaledDocHtml.appendChild(new HtmlElementGenerator("div"));
    docHtml.setAttribute(
        "class",
        classNames(
            contentStyles.docClassName,
            contentStyles.narrowRouteLayoutDocClassName,
            contentStyles.withUserSelectNoneDocClassName,
            // Strip the title's top breathing room when a site breadcrumb sits above the title
            // — otherwise the title's `min-height` leaves a `titlePaddingTop` gap between the
            // title text and the first body block.
            fileEntity.site && contentStyles.withoutTitleTopSpacingDocClassName,
            isContentTitleEmpty(content.doc) && contentStyles.emptyTitleClassName,
            isContentBodyEmpty(content.doc) && contentStyles.emptyBodyClassName,
        ),
    );

    const docFragmentHtml = renderContentFragmentToHtmlGeneratorStore(get, content, {
        placeholder: "Share your ideas…",
        isInert: true,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        siteRegistry,
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
        suppressHydrationWarning,
        // Include `data-file` attributes on files so
        // `addContentFileDocumentEntityPreviewBehavior()` can figure out what file is
        // being rendered for a given `fileClassName` HTML element.
        //
        // TODO(calebmer): We could also set `withPosAttribute: true` and use the
        // `data-pos` attribute to lookup the file ProseMirror node in the content like
        // `<ContentView>` does.
        withFileIdAttribute: true,
    });

    docHtml.appendChild(docFragmentHtml);
}

function createDummyDocumentContent(title: string): DocumentContent {
    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node(
            "doc",
            {
                accessPolicy: cast<AccessPolicy>({
                    type: "Local",
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
