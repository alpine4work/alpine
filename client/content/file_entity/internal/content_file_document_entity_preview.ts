import classNames from "classnames";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileClientStore} from "~/client/content/file_client_store.js";
import {actuallyRenderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {getPlatformRouteLayout} from "~/client/remix/route_layout_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {emptyMap} from "~/shared/helpers/array/empty_map.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileDocumentEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    html: HtmlElementGenerator,
    {
        fileEntity: unknownFileEntity,
        layout,
        getContext,
        spaceId,
        accountStore,
        fileStore,
        currentAccount,
        blockWidth,
        transformScale: originalTransformScale,
        platform,
        spacingScale,
        isInitialAppRender,
        fileEntityRenderers,
    }: {
        fileEntity: FileEntityModel;
        layout: ContentFileLayout;
        getContext: () => AppContext;
        spaceId: SpaceId | null;
        accountStore: AccountClientStore;
        fileStore: FileClientStore;
        currentAccount: AccountModel | null;
        blockWidth: number;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        fileEntityRenderers: ContentFileEntityRenderers | null;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileDocumentEntityModelSchema);

    const isSmallerThanHalfOfBlockMaxWidth =
        layout.width <=
        ((contentStyles.blockMaxWidthRem[platform] - contentStyles.fileRowGapWidthRem) / 2) *
            remPxBySpacingScale[spacingScale];

    const isSmallerThanThirdOfBlockMaxWidth =
        layout.width <=
        ((contentStyles.blockMaxWidthRem[platform] - contentStyles.fileRowGapWidthRem * 2) / 3) *
            remPxBySpacingScale[spacingScale];

    const transformScale =
        fontSizesBySpacingScale[
            isSmallerThanThirdOfBlockMaxWidth
                ? "25"
                : isSmallerThanHalfOfBlockMaxWidth
                ? "50"
                : "75"
        ].small.fontSize / fontSizesBySpacingScale["100"].small.fontSize;

    const padding = isSmallerThanThirdOfBlockMaxWidth
        ? "3"
        : isSmallerThanHalfOfBlockMaxWidth
        ? "4"
        : "5";
    const paddingPx = convertRemLengthToPx(padding, spacingScale);
    const scaledPaddingPx = paddingPx / transformScale;

    const scaledBlockMaxWidthPx =
        convertRemLengthToPx(contentStyles.blockMaxWidth[platform], spacingScale) * transformScale;

    const marginXPx = Math.max(paddingPx * 1.5, (layout.width - scaledBlockMaxWidthPx) / 2);

    const scaledDocHtml = html.appendChild(new HtmlElementGenerator("div"));

    scaledDocHtml.setAttribute(
        "style",
        [
            `width: ${(1 / transformScale) * 100}%`,
            "transform-origin: 0 0",
            `transform: translateY(${marginXPx}px) scale(${transformScale}) translateY(-${
                contentStyles.titlePaddingTop[getPlatformRouteLayout(platform, "narrow")]
            })`,
            // Document title top margin is computed using safe area inset. So zero out
            // safe area inset which shouldn't apply here.
            "--safe-area-inset-top-base: 0px",
            "--safe-area-inset-top: 0px",
        ].join("; "),
    );

    const docHtml = scaledDocHtml.appendChild(new HtmlElementGenerator("div"));
    docHtml.setAttribute(
        "class",
        classNames(
            contentStyles.docClassName,
            contentStyles.narrowRouteLayoutDocClassName,
            contentStyles.withUserSelectNoneDocClassName,
        ),
    );

    docHtml.setAttribute(
        "style",
        `padding-left: ${scaledPaddingPx}px; padding-right: ${scaledPaddingPx}px`,
    );

    const docFragmentHtml = actuallyRenderContentFragmentToHtmlGeneratorStore(
        get,
        fileEntity.preview?.content ?? {
            doc: createDummyDocumentContent(fileEntity.titleWithoutFallback),
            references: emptyDocumentContentReferences,
        },
        {
            isInert: true,
            getContext,
            spaceId,
            accountStore,
            fileStore,
            currentAccount,
            blockWidth,
            transformScale: originalTransformScale * transformScale,
            platform,
            spacingScale,
            isInitialAppRender,
            fileEntityRenderers,
        },
    );

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
