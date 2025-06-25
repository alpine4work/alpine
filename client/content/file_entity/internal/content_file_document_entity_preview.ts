import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {actuallyRenderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {getPlatformRouteLayout} from "~/client/remix/route_layout_context.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
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
        fileRegistry,
        currentAccount,
        transformScale: originalTransformScale,
        platform,
        spacingScale,
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
        fileRegistry: FileRegistry;
        currentAccount: AccountModel | null;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers | null;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileDocumentEntityModelSchema);

    const remPx = remPxBySpacingScale[spacingScale];
    const blockMaxWidthPx = contentStyles.blockMaxWidthRem[platform] * remPx;

    const isSmallerThanHalfOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx) / 2;

    const isSmallerThanThirdOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 2) / 3;

    // This case is primarily for `<MessageInputFileEntityPreview>`. We need to
    // render super small previews in that case.
    const isSmallerThanFourthOfBlockMaxWidth =
        layout.width <= (blockMaxWidthPx - contentStyles.fileRowGapWidthRem * remPx * 3) / 4;

    const padding = isSmallerThanFourthOfBlockMaxWidth
        ? "2"
        : isSmallerThanThirdOfBlockMaxWidth
        ? "3"
        : isSmallerThanHalfOfBlockMaxWidth
        ? "4"
        : "5";
    const paddingPx = parseRemLength(padding) * remPx;

    html.setAttribute(
        "class",
        classNames(html.getAttribute("class"), sprinkles({paddingX: padding})),
    );

    // By default, scale font size 100 text to font size 75. Scale to smaller font
    // sizes depending on the width of our preview.
    const transformScale =
        (isSmallerThanFourthOfBlockMaxWidth
            ? fontSizesBySpacingScale["25"].small.fontSize / 2
            : fontSizesBySpacingScale[
                  isSmallerThanThirdOfBlockMaxWidth
                      ? "25"
                      : isSmallerThanHalfOfBlockMaxWidth
                      ? "50"
                      : "75"
              ].small.fontSize) / fontSizesBySpacingScale["100"].small.fontSize;

    // The width we need to render our document at to fill the downscaled entity
    // preview.
    const scaledWidthPx = (layout.width - paddingPx * 2) / transformScale;

    // The margin top we want to use for our document.
    //
    // - At least use 150% of our x padding
    // - If our content reaches the block max width and is centered then we want to
    //   use the same centering margin x as the margin top
    const marginTopPx = Math.max(
        paddingPx * 1.5,
        (layout.width - blockMaxWidthPx * transformScale) / 2,
    );

    const scaledDocHtml = html.appendChild(new HtmlElementGenerator("div"));

    scaledDocHtml.setAttribute(
        "style",
        [
            `width: ${scaledWidthPx}px`,
            "transform-origin: 0 0",
            `transform: translateY(${marginTopPx}px) scale(${transformScale}) translateY(-${
                contentStyles.titlePaddingTop[getPlatformRouteLayout(platform, "narrow")]
            })`,
            // Document title top margin is computed using safe area inset. So zero out
            // safe area inset which shouldn't apply here.
            "--safe-area-inset-top-base: 0px",
            "--safe-area-inset-top: 0px",
        ].join("; "),
    );

    const content = fileEntity.preview?.content ?? {
        doc: createDummyDocumentContent(fileEntity.titleWithoutFallback),
        references: emptyDocumentContentReferences,
    };

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
