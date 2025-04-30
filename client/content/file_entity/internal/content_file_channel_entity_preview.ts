import classNames from "classnames";
import {renderAccountAvatar} from "~/client/accounts/account_avatar_html.js";
import {accountAvatarPileSizes} from "~/client/accounts/account_avatar_pile_size.js";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileClientStore} from "~/client/content/file_client_store.js";
import {actuallyRenderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/state/add_unfocusable_button_behavior_to_element.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {bellIconSvg} from "~/client/icons/bell_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {
    channelSubscribeButtonFontWeight,
    channelViewHeaderSectionGap,
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/styles/forum_shared_styles.js";
import {backgroundColorVar, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {renderedMaxChannelTopContributorCount} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

export function renderContentFileChannelEntityPreview(
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
        transformScale,
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
    const fileEntity = unknownFileEntity.deserialize(FileChannelEntityModelSchema);

    const isSmallerThanHalfOfBlockMaxWidth =
        layout.width <=
        ((contentStyles.blockMaxWidthRem[platform] - contentStyles.fileRowGapWidthRem) / 2) *
            remPxBySpacingScale[spacingScale];

    const isSmallerThanThirdOfBlockMaxWidth =
        layout.width <=
        ((contentStyles.blockMaxWidthRem[platform] - contentStyles.fileRowGapWidthRem * 2) / 3) *
            remPxBySpacingScale[spacingScale];

    const containerHtml = html.appendChild(new HtmlElementGenerator("div"));
    const containerPadding = "5";

    containerHtml.setAttribute(
        "class",
        sprinkles({
            padding: containerPadding,
            display: "flex",
            flexDirection: "column",
            gap: channelViewHeaderSectionGap,
        }),
    );

    {
        const nameContainerHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

        nameContainerHtml.setAttribute(
            "class",
            sprinkles({
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "3",
                // Bring the people section a little closer to the channel name.
                marginBottom: "-1",
            }),
        );

        const nameHtml = nameContainerHtml.appendChild(new HtmlElementGenerator("div"));

        nameHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: isSmallerThanThirdOfBlockMaxWidth ? "400" : "500",
                fontStyle: "truncate-bold",
            }),
        );

        nameHtml.appendChild(new HtmlTextGenerator(fileEntity.name));

        const subscribeButtonHtml = nameContainerHtml.appendChild(new HtmlElementGenerator("div"));

        subscribeButtonHtml.setAttribute(
            "class",
            contentStyles.fileChannelEntityPreviewSubscribeButtonClassName,
        );

        subscribeButtonHtml.setAttribute(
            "style",
            `display: ${
                isSmallerThanHalfOfBlockMaxWidth ? "none" : "flex"
            }; font-weight: ${channelSubscribeButtonFontWeight}`,
        );

        subscribeButtonHtml.appendChild(
            createSvgHtmlGenerator(
                bellIconSvg({
                    weight: "bold",
                    className: sprinkles({width: "3", height: "3", fill: "grey-0"}),
                }),
            ),
        );

        subscribeButtonHtml.appendChild(new HtmlTextGenerator("Subscribe"));
    }

    {
        const peopleSection = containerHtml.appendChild(new HtmlElementGenerator("div"));

        {
            const avatarSize = isSmallerThanThirdOfBlockMaxWidth ? "6" : "7";
            const {avatarOverlapWidth, borderWidth, overflowFontSize, overflowScale} =
                accountAvatarPileSizes[avatarSize];

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

            // The max number of accounts we can render in our preview. Calculates the
            // amount of available space then divides by the avatar overlap width.
            const maxPreviewAccountCount = Math.floor(
                (layout.width -
                    (convertRemLengthToPx(containerPadding, spacingScale) * 2 +
                        convertRemLengthToPx(avatarSize, spacingScale))) /
                    convertRemLengthToPx(avatarOverlapWidth, spacingScale),
            );

            const accountCount = fileEntity.contributorCount;

            const previewAccounts = fileEntity.topContributors
                .map(account => get(accountStore.getAccountStore(account)))
                // If we have any removed accounts then sort them to the end of the array.
                // Prefer showing accounts that are still a part of the space.
                //
                // Same sort as in `<ChannelViewContributorsSection>`.
                .sort((account1, account2) => {
                    if (account1.space.wasRemoved) return -1;
                    if (account2.space.wasRemoved) return 1;
                    return 0;
                })
                .slice(0, Math.min(renderedMaxChannelTopContributorCount, maxPreviewAccountCount));

            for (let index = 0; index < previewAccounts.length; index++) {
                const account = previewAccounts[index]!;

                const accountAvatarContainerHtml = peopleSectionAvatarPileHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                accountAvatarContainerHtml.setAttribute(
                    "class",
                    sprinkles({
                        height: avatarSize,
                        width: avatarOverlapWidth,
                        position: "relative",
                    }),
                );

                accountAvatarContainerHtml.setAttribute("style", `z-index: ${1 + index}`);

                accountAvatarContainerHtml.appendChild(
                    renderAccountAvatar({
                        accountData: account,
                        size: avatarSize,
                        backgroundBorderWidth:
                            previewAccounts.length > 1 || accountCount > previewAccounts.length
                                ? borderWidth
                                : undefined,
                    }),
                );
            }

            if (accountCount > previewAccounts.length) {
                const overflowContainerHtml = peopleSectionAvatarPileHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                overflowContainerHtml.setAttribute(
                    "class",
                    sprinkles({
                        height: avatarSize,
                        width: avatarOverlapWidth,
                        position: "relative",
                    }),
                );

                overflowContainerHtml.setAttribute(
                    "style",
                    `z-index: ${1 + previewAccounts.length}`,
                );

                const overflowOuterHtml = overflowContainerHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                overflowOuterHtml.setAttribute(
                    "class",
                    sprinkles({
                        height: avatarSize,
                        width: avatarSize,
                        borderRadius: "full",
                    }),
                );

                overflowOuterHtml.setAttribute(
                    "style",
                    `box-shadow: 0px 0px 0px ${borderWidth}px ${backgroundColorVar}`,
                );

                const overflowInnerHtml = overflowOuterHtml.appendChild(
                    new HtmlElementGenerator("div"),
                );

                overflowInnerHtml.setAttribute(
                    "class",
                    sprinkles({
                        height: avatarSize,
                        width: avatarSize,
                        borderRadius: "full",
                        backgroundColor: "grey-10",
                        fontSize: overflowFontSize,
                        color: "grey-70",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                    }),
                );

                const overflowTextHtml = overflowInnerHtml.appendChild(
                    new HtmlElementGenerator("span"),
                );

                if (overflowScale !== undefined) {
                    overflowTextHtml.setAttribute("style", `transform: scale(${overflowScale})`);
                }

                overflowTextHtml.appendChild(
                    new HtmlTextGenerator(`+${accountCount - previewAccounts.length}`),
                );
            }
        }
    }

    {
        const descriptionSectionHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

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
                ),
            );

            descriptionHtml.setAttribute("style", "user-select: none; -webkit-user-select: none");

            // NOCOMMIT: Render empty description. Perhaps with placeholder?
            const descriptionFragmentHtml = actuallyRenderContentFragmentToHtmlGeneratorStore(
                get,
                fileEntity.description,
                {
                    isInert: true,
                    getContext,
                    spaceId,
                    accountStore,
                    fileStore,
                    currentAccount,
                    blockWidth,
                    transformScale,
                    platform,
                    spacingScale,
                    isInitialAppRender,
                    fileEntityRenderers,
                },
            );

            descriptionHtml.appendChild(descriptionFragmentHtml);
        }
    }
}

export function addContentFileChannelEntityPreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {}: {fileEntity: FileEntityModel; spaceId: SpaceId},
) {
    const subscribeButtonElement = assertExists(
        element.getElementsByClassName(
            contentStyles.fileChannelEntityPreviewSubscribeButtonClassName,
        )[0],
    ) as HTMLDivElement;

    const cleanupSubscribeButton = addUnfocusableButtonBehaviorToElement(subscribeButtonElement, {
        pressClassName: contentStyles.fileChannelEntityPreviewSubscribeButtonPressedClassName,
        onPress: () => {
            // NOCOMMIT: Implement subscribing/unsubscribing after merging channel
            // subscription code.
        },
    });

    return () => {
        cleanupSubscribeButton();
    };
}
