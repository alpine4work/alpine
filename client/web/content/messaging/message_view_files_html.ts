import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {renderContentFileEntityPreview} from "~/client/web/content/internal/content_file_entity_preview.js";
import {renderContentFilePreview} from "~/client/web/content/internal/content_file_preview.js";
import {computeContentFileRowLikeLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {RemLength} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFile} from "~/shared/messaging/message_model.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderMessageViewFiles(
    get: <Value>(store: Store<Value>) => Value,
    contentContainerHtml: HtmlElementGenerator,
    {
        files,
        paddingTop,
        blockWidthPx,
        getContext,
        clientInfo,
        spaceId: nullableSpaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        currentAccount,
        transformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        suppressHydrationWarning,
        withFileIdAttribute,
    }: {
        files: ReadonlyArray<MessageContentPayloadModelFile>;
        paddingTop: RemLength | null;
        blockWidthPx: number;
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
        suppressHydrationWarning: () => void;
        withFileIdAttribute?: boolean;
    },
) {
    const filesContainerHtml = contentContainerHtml.appendChild(new HtmlElementGenerator("div"));
    filesContainerHtml.setAttribute(
        "class",
        sprinkles({
            display: "flex",
            flexDirection: "column",
            gap: contentStyles.fileRowGapWidth,
        }),
    );

    if (paddingTop !== null) {
        filesContainerHtml.setAttribute("style", `padding-top: ${paddingTop}`);
    }

    const spaceId = assertExists(nullableSpaceId);
    const maxFileRowCount = 3;
    const fileSchema = ContentBaseProsemirrorSchemaWithFiles.get();

    for (let rowIndex = 0; rowIndex < files.length; rowIndex += maxFileRowCount) {
        const rowFiles = files.slice(rowIndex, rowIndex + maxFileRowCount);

        const fileDatas = rowFiles.map(file => {
            if (file.type === "Null") return null;
            if (file.type === "FileEntity") return file.fileEntityId;
            return get(fileRegistry.getFileStore(file));
        });

        const fileLayouts = computeContentFileRowLikeLayout(fileDatas, {
            maxFileCount: maxFileRowCount,
            blockWidth: blockWidthPx,
            platform,
            spacingScale,
        });

        const fileRowHtml = filesContainerHtml.appendChild(new HtmlElementGenerator("div"));
        fileRowHtml.setAttribute(
            "class",
            sprinkles({
                width: "full",
                userSelect: "none",
                gap: contentStyles.fileRowGapWidth,
            }),
        );
        fileRowHtml.setAttribute(
            "style",
            [
                `height: ${Math.max(...fileLayouts.map(({height}) => height))}px`,
                "display: grid",
                "grid-template-rows: 1fr",
                `grid-template-columns: ${fileLayouts.map(({widthFr}) => `${widthFr}fr`).join(" ")}`,
                // Left align message files instead of center aligning message files. This matches
                // the more conversational format of messages as opposed to the carefully edited
                // prose format of documents.
                //
                // NOTE(calebmer, 2026-03-12): I don't think this matters anymore now that we
                // layout file rows with the requirement that we always fills the block width.
                "justify-content: start",
            ].join("; "),
        );

        for (let fileIndex = 0; fileIndex < rowFiles.length; fileIndex++) {
            const file = rowFiles[fileIndex]!;
            const fileLayout = fileLayouts[fileIndex]!;
            const fileNode = fileSchema.node("file", {
                fileId:
                    file.type === "Null"
                        ? file.fileId
                        : file.type === "FileEntity"
                          ? file.fileEntityId
                          : file.file.id,
            });

            let fileHtml: HtmlElementGenerator;

            if (file.type === "FileEntity") {
                fileHtml = renderContentFileEntityPreview(get, {
                    node: fileNode,
                    fileEntityId: file.fileEntityId,
                    fileEntityResult: file.fileEntityResult,
                    fileEntityRenderers,
                    layout: fileLayout,
                    getContext,
                    clientInfo,
                    spaceId: spaceId,
                    accountRegistry,
                    searchEntityRegistry,
                    fileRegistry,
                    currentAccount,
                    blockWidth: blockWidthPx,
                    transformScale,
                    platform,
                    spacingScale,
                    routeLayout,
                    isInitialAppRender,
                    currentDate,
                    suppressHydrationWarning,
                });

                if (withFileIdAttribute) {
                    fileHtml.setAttribute("data-file", file.fileEntityId);
                }
            } else {
                fileHtml = renderContentFilePreview({
                    spaceId: spaceId,
                    node: fileNode,
                    file: file.type !== "Null" ? get(fileRegistry.getFileStore(file)) : undefined,
                    layout: fileLayout,
                    blockWidth: blockWidthPx,
                    transformScale,
                    platform,
                    spacingScale,
                    isInitialAppRender,
                    // Message previews are inert, so disable media controls.
                    withoutInteractivity: true,
                });

                if (withFileIdAttribute) {
                    fileHtml.setAttribute(
                        "data-file",
                        file.type === "Null" ? file.fileId : file.file.id,
                    );
                }
            }

            fileHtml.setAttribute(
                "class",
                classNames(
                    fileHtml.getAttribute("class"),
                    contentStyles.alwaysShowFileBorderClassName,
                ),
            );

            fileRowHtml.appendChild(fileHtml);
        }
    }
}
