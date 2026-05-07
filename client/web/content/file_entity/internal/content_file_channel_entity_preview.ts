import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {renderAccountAvatarPile} from "~/client/web/accounts/account_avatar_pile_html.js";
import {accountAvatarPileSizes} from "~/client/web/accounts/account_avatar_pile_size.js";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {setupContentFileEntityPreviewContainer} from "~/client/web/content/file_entity/internal/content_file_entity_preview_container.js";
import {
    addContentFileEntitySubscribeButtonBehavior,
    renderContentFileEntitySubscribeButton,
} from "~/client/web/content/file_entity/internal/content_file_entity_subscribe_button.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {renderContentFragmentToHtmlGeneratorStore} from "~/client/web/content/render_content_to_html.js";
import {ContentFileLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {lockBoldFillIconSvg} from "~/client/web/icons/lock_bold_fill_icon_svg.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {
    channelViewHeaderSectionGap,
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {renderedMaxChannelTopContributorCount} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {subscribeToChannel, unsubscribeFromChannel} from "~/shared/rpc/forum_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileChannelEntityPreview(
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
        fileEntityRenderers: ContentFileEntityRenderers | null;
        suppressHydrationWarning: () => void;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileChannelEntityModelSchema);

    const {scaledContainerHtml, transformScale, scaledWidthPx, isSmallerThanHalfOfBlockMaxWidth} =
        setupContentFileEntityPreviewContainer(html, {
            layout,
            platform,
            spacingScale,
            transformScaleBaseFontSize: "100",
            scaledContainerClassName: sprinkles({
                display: "flex",
                flexDirection: "column",
                gap: channelViewHeaderSectionGap,
            }),
        });

    {
        const nameContainerHtml = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

        nameContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "3",
                // Make sure we don't grow beyond the subscribe button height. The 500 font size
                // name is 2px larger than the subscribe button height.
                height: contentStyles.fileEntityPreviewSubscribeButtonHeight,
            }),
        );

        const titleContainerHtml = nameContainerHtml.appendChild(new HtmlElementGenerator("div"));
        titleContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                alignItems: "center",
                gap: platform === "mobile" ? "1.5" : "2",
                minWidth: "0",
            }),
        );

        if (fileEntity.isPrivate) {
            titleContainerHtml.appendChild(
                createSvgHtmlGenerator(
                    lockBoldFillIconSvg({
                        className: sprinkles({flexShrink: "0"}),
                        size: spacing[platform === "mobile" ? "3" : "4"],
                    }),
                ),
            );
        }

        const nameHtml = titleContainerHtml.appendChild(new HtmlElementGenerator("div"));
        nameHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: "500",
                fontStyle: "truncate-bold",
            }),
        );

        nameHtml.appendChild(new HtmlTextGenerator(fileEntity.name));

        renderContentFileEntitySubscribeButton(nameContainerHtml, {
            isVisible: !isSmallerThanHalfOfBlockMaxWidth,
            isSubscribed: fileEntity.isSubscribed,
        });
    }

    {
        const peopleSection = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

        {
            const avatarSize = "7";
            const {avatarOverlapWidth} = accountAvatarPileSizes[avatarSize];

            const peopleSectionAvatarPileHtml = peopleSection.appendChild(
                new HtmlElementGenerator("div"),
            );

            peopleSectionAvatarPileHtml.setAttribute(
                "class",
                sprinkles({
                    position: "relative",
                    zIndex: "0",
                    height: avatarSize,
                    display: "flex",
                }),
            );

            // The max number of accounts we can render in our preview. Calculates the amount
            // of available space then divides by the avatar overlap width.
            const maxPreviewAccountCount = Math.floor(
                (scaledWidthPx - convertRemLengthToPx(avatarSize, spacingScale)) /
                    convertRemLengthToPx(avatarOverlapWidth, spacingScale),
            );

            const accountCount = fileEntity.contributorCount;

            const previewAccounts = fileEntity.topContributors
                .map(account => get(accountRegistry.getAccountStore(account)))
                // If we have any removed accounts then sort them to the end of the array. Prefer
                // showing accounts that are still a part of the space.
                //
                // Same sort as in `<ChannelViewContributorsSection>`.
                .sort((account1, account2) => {
                    if (account1.space.state.type !== "Active") return -1;
                    if (account2.space.state.type !== "Active") return 1;
                    return 0;
                })
                .slice(0, Math.min(renderedMaxChannelTopContributorCount, maxPreviewAccountCount));

            peopleSectionAvatarPileHtml.appendChild(
                renderAccountAvatarPile({
                    spacingScale,
                    size: avatarSize,
                    previewAccounts,
                    accountCount,
                }),
            );
        }
    }

    {
        const descriptionSectionHtml = scaledContainerHtml.appendChild(
            new HtmlElementGenerator("div"),
        );

        {
            const descriptionSectionTitleHtml = descriptionSectionHtml.appendChild(
                new HtmlElementGenerator("div"),
            );

            descriptionSectionTitleHtml.setAttribute(
                "class",
                sprinkles({
                    color: channelViewMetadataSectionTitleColor,
                    fontSize: channelViewMetadataSectionTitleFontSize,
                    marginBottom: channelViewMetadataSectionTitleMarginBottom,
                }),
            );

            descriptionSectionTitleHtml.appendChild(new HtmlTextGenerator("About"));

            const descriptionHtml = descriptionSectionHtml.appendChild(
                new HtmlElementGenerator("div"),
            );

            descriptionHtml.setAttribute(
                "class",
                classNames(
                    contentStyles.docClassName,
                    contentStyles.narrowRouteLayoutDocClassName,
                    contentStyles.withUserSelectNoneDocClassName,
                    contentStyles.withoutBlockMaxWidthDocClassName,
                    isContentBodyEmpty(fileEntity.description.doc) &&
                        contentStyles.emptyBodyClassName,
                ),
            );

            descriptionHtml.setAttribute("style", "user-select: none; -webkit-user-select: none");

            const descriptionFragmentHtml = renderContentFragmentToHtmlGeneratorStore(
                get,
                fileEntity.description,
                {
                    // If the description is empty then we render a dummy placeholder to incentivize
                    // adding a description to the channel.
                    placeholder: `Created ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                        clientInfo.locale,
                        clientInfo.timeZone,
                        currentDate,
                        fileEntity.createdTime,
                        {withLongMonth: true, withLongWeekday: true, withoutTime: true},
                    )}`,

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
                    //
                    // We don't use `Math.min(scaledWidthPx, blockMaxWidthPx)` like we do in documents
                    // because we turn off max width (`contentStyles.withoutBlockMaxWidthDocClassName`)
                    // so the post extends end-to-end within the preview. Usually, the file entity
                    // preview width shouldn't be that much more than the block width.
                    blockWidth: scaledWidthPx,
                    transformScale: originalTransformScale * transformScale,
                    platform,
                    spacingScale,
                    routeLayout,
                    isInitialAppRender,
                    currentDate,
                    fileEntityRenderers,
                    suppressHydrationWarning,
                },
            );

            descriptionHtml.appendChild(descriptionFragmentHtml);
        }
    }
}

export function addContentFileChannelEntityPreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        fileEntity: unknownFileEntity,
        getReporter,
        isInert,
    }: {
        fileEntity: FileEntityModel;
        spaceId: SpaceId;
        getReporter: () => Reporter;
        isInert: boolean;
    },
) {
    const fileEntity = unknownFileEntity.deserialize(FileChannelEntityModelSchema);

    return addContentFileEntitySubscribeButtonBehavior(element, {
        getReporter,
        isInert,
        subscribe: () => subscribeToChannel(getContext(), {channelId: fileEntity.id}),
        unsubscribe: () => unsubscribeFromChannel(getContext(), {channelId: fileEntity.id}),
    });
}
