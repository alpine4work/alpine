import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {renderAccountAvatar} from "~/client/accounts/account_avatar_html.js";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {setupContentFileEntityPreviewContainer} from "~/client/content/file_entity/internal/content_file_entity_preview_container.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {actuallyRenderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewHeaderDesktopPostMetadataPaddingLeft,
    postContentViewHeaderMobileAvatarSize,
    postContentViewHeaderMobilePostMetadataPaddingLeft,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles, forumStyles, sprinkles} from "~/client/styles/styles.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FilePostEntityModelSchema} from "~/shared/forum/file_post_entity_model_schema.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFilePostEntityPreview(
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
    const post = unknownFileEntity.deserialize(FilePostEntityModelSchema);

    const {scaledContainerHtml, transformScale, scaledWidthPx, blockMaxWidthPx} =
        setupContentFileEntityPreviewContainer(html, {
            layout,
            platform,
            spacingScale,
            withoutContainerPaddingY: true,
            transformScaleBaseFontSize: "75",
            scaledContainerClassName: sprinkles({
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
            }),
        });

    // Header section with author avatar and post metadata
    {
        const headerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

        headerHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                alignItems: "center",
                paddingTop: postContentViewOuterMarginY,
            }),
        );

        // Author avatar
        const authorAccountData = get(accountRegistry.getAccountStore(post.author));
        const avatarSize =
            platform === "mobile"
                ? postContentViewHeaderMobileAvatarSize
                : postContentViewHeaderAvatarSize;
        headerHtml.appendChild(
            renderAccountAvatar({
                accountData: authorAccountData,
                size: avatarSize,
            }),
        );

        // Author name, channel, and created time
        const metadataHtml = headerHtml.appendChild(new HtmlElementGenerator("div"));
        metadataHtml.setAttribute(
            "class",
            sprinkles({
                paddingLeft:
                    platform === "mobile"
                        ? postContentViewHeaderMobilePostMetadataPaddingLeft
                        : postContentViewHeaderDesktopPostMetadataPaddingLeft,
                overflow: "hidden",
            }),
        );

        // Top "row" of header
        {
            const authorAndChannelHtml = metadataHtml.appendChild(new HtmlElementGenerator("div"));
            authorAndChannelHtml.setAttribute(
                "class",
                forumStyles.postHeaderAuthorAndChannelClassName,
            );
            // Author name
            const authorNameHtml = authorAndChannelHtml.appendChild(
                new HtmlElementGenerator("span"),
            );
            authorNameHtml.setAttribute("class", forumStyles.postHeaderAuthorClassName);
            authorNameHtml.appendChild(new HtmlTextGenerator(authorAccountData.name));

            if (post.channelName) {
                const inHtml = authorAndChannelHtml.appendChild(new HtmlElementGenerator("span"));
                inHtml.appendChild(new HtmlTextGenerator(" in "));

                const channelNameHtml = authorAndChannelHtml.appendChild(
                    new HtmlElementGenerator("span"),
                );
                channelNameHtml.setAttribute(
                    "class",
                    sprinkles({
                        color: "grey-100",
                        fontStyle: "semi-bold",
                    }),
                );
                channelNameHtml.appendChild(new HtmlTextGenerator(post.channelName));
            }
        }

        // Bottom "row" of header
        {
            const createdTimeHtml = metadataHtml.appendChild(new HtmlElementGenerator("div"));
            createdTimeHtml.setAttribute("class", forumStyles.postHeaderCreatedTimeClassName);

            const dateText = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                clientInfo.locale,
                clientInfo.timeZone,
                currentDate,
                post.createdTime,
                {withLongMonth: false, withLongWeekday: false, withoutTime: false},
            );

            createdTimeHtml.appendChild(new HtmlTextGenerator(dateText));
        }
    }

    // Post content section
    {
        const contentHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));
        contentHtml.setAttribute(
            "class",
            classNames(
                contentStyles.docClassName,
                contentStyles.narrowRouteLayoutDocClassName,
                contentStyles.withUserSelectNoneDocClassName,
                isContentBodyEmpty(post.content.doc) && contentStyles.emptyBodyClassName,
                sprinkles({
                    paddingTop: postContentViewInnerMarginY,
                }),
            ),
        );

        const contentFragmentHtml = actuallyRenderContentFragmentToHtmlGeneratorStore(
            get,
            post.content,
            {
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
            },
        );

        contentHtml.appendChild(contentFragmentHtml);
    }
}
