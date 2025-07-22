import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {renderAccountAvatar} from "~/client/accounts/account_avatar_html.js";
import {accountAvatarPileSizes} from "~/client/accounts/account_avatar_pile_size.js";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {setupContentFileEntityPreviewContainer} from "~/client/content/file_entity/internal/content_file_entity_preview_container.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {renderContentFragmentToHtmlGeneratorStore} from "~/client/content/render_content_to_html.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/state/add_unfocusable_button_behavior_to_element.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {Reporter} from "~/client/design/reporter.js";
import {bellIconSvg} from "~/client/icons/bell_icon_svg.js";
import {bellRingingIconSvg} from "~/client/icons/bell_ringing_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {spinnerGapIconSvg} from "~/client/icons/spinner_gap_icon_svg.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {
    channelViewHeaderSectionGap,
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
} from "~/client/styles/forum_shared_styles.js";
import {
    backgroundColorVar,
    contentStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {renderedMaxChannelTopContributorCount} from "~/shared/forum/channel_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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

    const {
        scaledContainerHtml,
        transformScale,
        scaledWidthPx,
        blockMaxWidthPx,
        isSmallerThanHalfOfBlockMaxWidth,
    } = setupContentFileEntityPreviewContainer(html, {
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
                // Bring the people section a little closer to the channel name.
                marginBottom: "-1",
            }),
        );

        const nameHtml = nameContainerHtml.appendChild(new HtmlElementGenerator("div"));

        nameHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: "500",
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
            `display: ${isSmallerThanHalfOfBlockMaxWidth ? "none" : "flex"}`,
        );

        subscribeButtonHtml.setAttribute(
            "data-subscribed",
            JSON.stringify(fileEntity.isSubscribed),
        );

        subscribeButtonHtml.appendChild(
            createSvgHtmlGenerator(
                bellIconSvg({
                    weight: "bold",
                    className:
                        contentStyles.fileChannelEntityPreviewSubscribeButtonBellIconClassName,
                }),
            ),
        );

        subscribeButtonHtml.appendChild(
            createSvgHtmlGenerator(
                bellRingingIconSvg({
                    weight: "regular",
                    className:
                        contentStyles.fileChannelEntityPreviewSubscribeButtonBellRingingIconClassName,
                }),
            ),
        );

        subscribeButtonHtml.appendChild(
            createSvgHtmlGenerator(
                spinnerGapIconSvg({
                    className: classNames(
                        spinAnimationClassName,
                        contentStyles.fileChannelEntityPreviewSubscribeButtonSpinnerGapIconClassName,
                    ),
                }),
            ),
        );
    }

    {
        const peopleSection = scaledContainerHtml.appendChild(new HtmlElementGenerator("div"));

        {
            const avatarSize = "7";
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
                (scaledWidthPx - convertRemLengthToPx(avatarSize, spacingScale)) /
                    convertRemLengthToPx(avatarOverlapWidth, spacingScale),
            );

            const accountCount = fileEntity.contributorCount;

            const previewAccounts = fileEntity.topContributors
                .map(account => get(accountRegistry.getAccountStore(account)))
                // If we have any removed accounts then sort them to the end of the array.
                // Prefer showing accounts that are still a part of the space.
                //
                // Same sort as in `<ChannelViewContributorsSection>`.
                .sort((account1, account2) => {
                    if (account1.space.removal) return -1;
                    if (account2.space.removal) return 1;
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

    const subscribeButtonElement = assertExists(
        element.getElementsByClassName(
            contentStyles.fileChannelEntityPreviewSubscribeButtonClassName,
        )[0],
    ) as HTMLDivElement;

    let cleanupSubscribeButton: (() => void) | undefined;
    if (!isInert) {
        cleanupSubscribeButton = addUnfocusableButtonBehaviorToElement(subscribeButtonElement, {
            pressClassName: contentStyles.fileChannelEntityPreviewSubscribeButtonPressedClassName,
            onPress: () => {
                // Only run one async operation at a time...
                if (subscribeButtonElement.hasAttribute("data-loading")) return;

                const isSubscribed: boolean = JSON.parse(
                    subscribeButtonElement.getAttribute("data-subscribed-override") ??
                        subscribeButtonElement.getAttribute("data-subscribed") ??
                        "false",
                );

                const setIsSubscribed = (isSubscribed: boolean) => {
                    // Our local `isSubscribed` state is saved in the DOM as a data attribute. We
                    // need to pick a name for the data attribute which doesn't conflict with
                    // `data-subscribed` which is managed by `HtmlGenerator`. If
                    // `renderContentFileChannelEntityPreview()` reruns then we don't want it to
                    // override our local `isSubscribed` state when patching nodes.
                    //
                    // Behaviors functions like this have to manage state in the DOM since we're not
                    // a traditional stateful React component.
                    subscribeButtonElement.setAttribute(
                        "data-subscribed-override",
                        JSON.stringify(isSubscribed),
                    );
                };

                runPromiseWithoutAwaiting(async () => {
                    subscribeButtonElement.setAttribute("data-loading", "");

                    const timeout = createTimeout(() => {
                        subscribeButtonElement.setAttribute("data-loading-indicator", "");
                    }, delayLoadingIndicatorLimitMs);

                    try {
                        // Optimistically update the button.
                        setIsSubscribed(!isSubscribed);

                        if (isSubscribed) {
                            await unsubscribeFromChannel(getContext(), {channelId: fileEntity.id});
                        } else {
                            await subscribeToChannel(getContext(), {channelId: fileEntity.id});
                        }
                    } catch (error) {
                        // If the request failed then revert our button back to the original state.
                        setIsSubscribed(isSubscribed);

                        getReporter().displayError(
                            !isSubscribed
                                ? "Couldn’t subscribe to channel"
                                : "Couldn’t unsubscribe from channel",
                            error,
                        );
                    } finally {
                        timeout.clear();
                        subscribeButtonElement.removeAttribute("data-loading");
                        subscribeButtonElement.removeAttribute("data-loading-indicator");
                    }
                });
            },
        });
    }

    return () => {
        cleanupSubscribeButton?.();
    };
}
