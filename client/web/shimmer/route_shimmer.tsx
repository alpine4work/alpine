import {Check, SpinnerGap} from "phosphor-react";
import {ComponentType, ReactNode, memo, useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {textInputClassName} from "~/client/web/design/text_input.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    ContentParagraphShimmer1,
    ContentParagraphShimmer2,
    ContentParagraphShimmer3,
} from "~/client/web/shimmer/content_shimmer.js";
import {InboxEntryShimmer} from "~/client/web/shimmer/inbox_entry_shimmer.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/web/shimmer/internal/mobile_back_button.js";
import {MobileSettingsRowsShimmer} from "~/client/web/shimmer/internal/mobile_settings_rows_shimmer.js";
import {SpaceBotListSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_bot_list_settings_route_shimmer.js";
import {SpaceBotSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_bot_settings_route_shimmer.js";
import {SpaceGeneralSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_general_settings_route_shimmer.js";
import {SpaceIntegrationsSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_integrations_settings_route_shimmer.js";
import {SpaceSlackIntegrationSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_integrations_slack_route_shimmer.js";
import {SpaceNotificationsSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_notification_settings_route_shimmer.js";
import {SpaceNotionImportSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_notion_import_settings_route_shimmer.js";
import {SpacePeopleSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_people_settings_route_shimmer.js";
import {SpaceProfileSettingsRouteShimmer} from "~/client/web/shimmer/internal/space_profile_settings_route_shimmer.js";
import {MessageShimmer} from "~/client/web/shimmer/message_shimmer.js";
import {
    PostShimmer,
    PostShimmerFooter,
    PostShimmerHeader,
} from "~/client/web/shimmer/post_shimmer.js";
import {SearchEntityShimmer} from "~/client/web/shimmer/search_entity_shimmer.js";
import {TaskRowShimmer} from "~/client/web/shimmer/task_row_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/web/shimmer/use_coordinated_shimmer_animations.js";
import {chatViewTopBarWithInboxBannerAdjustmentY} from "~/client/web/styles/chat_shared_styles.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadPreviewHeight,
} from "~/client/web/styles/document_shared_styles.js";
import {
    createWidgetPrimaryMenuBarItemBackgroundInsetY,
    createWidgetPrimaryMenuBarItemDesktopPaddingX,
    createWidgetPrimaryMenuBarItemHeight,
    feedCreateSectionForYouHeadingMarginBottom,
    feedCreateSectionGap,
    feedCreateSectionHeadingFontSize,
    feedCreateSectionHeadingLineHeight,
    feedCreateSectionSearchBarContainerPaddingX,
    feedCreateSectionSearchBarContainerPaddingY,
    feedViewSideBarLeftFlex,
    feedViewSideBarPaddingX,
    feedViewSideBarRightFlex,
    feedViewSideBarSpaceNameFontSize,
    feedViewSideBarSpaceNameNegativeMarginBottom,
    feedViewSideBarWidth,
} from "~/client/web/styles/feed_shared_styles.js";
import {
    channelCreatorDescriptionFieldMinHeightPx,
    channelCreatorFieldHelpMarginTop,
    channelCreatorGap,
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
    channelFilesViewFileMaxSize,
    channelFilesViewFileMinSize,
    channelFilesViewFileRowFileCount,
    channelFilesViewMaxWidth,
    channelViewAsidePaddingTop,
    channelViewAsideSectionGap,
    channelViewHeaderNarrowRouteLayoutMarginTop,
    channelViewHeaderSectionGap,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
    postContentViewCommentMargin,
    postContentViewInnerMarginY,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
    postFauxInputCreateButtonHeight,
    postFauxInputCreateButtonInnerButtonHeight,
    postFauxInputCreateButtonMarginTop,
    postListViewAsideFlex,
    postListViewAsideMaxWidth,
    postListViewAsidePaddingLeft,
    postListViewAsidePaddingRight,
    postViewContentPaddingTop,
    postViewFlex,
} from "~/client/web/styles/forum_shared_styles.js";
import {inboxBannerHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonNegativeMarginX,
    messageInputEditorMinHeightPx,
    messageInputMinHeightPx,
    messageInputPaddingY,
    messageViewAccountAvatarSize,
    messageViewMarginY,
    messageViewRailGap,
    messageViewTimestampDividerHeight,
    messageViewTimestampDividerMarginY,
} from "~/client/web/styles/messaging_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
    searchEntityHeaderPaddingTop,
    searchEntityViewDefaultPaddingX,
    searchEntityViewMediaSize,
    searchEntityViewTitleFontSize,
    searchMobileInputBorderRadius,
    searchMobileInputMarginBottom,
    searchMobileInputMarginTop,
    searchMobileInputMinHeight,
} from "~/client/web/styles/search_shared_styles.js";
import {
    Sprinkles,
    colorSchemeVars,
    contentStyles,
    fontSizes,
    pulseAnimationClassName,
    spinAnimationClassName,
    tasksStyles,
} from "~/client/web/styles/styles.js";
import {
    taskDetailNotesFieldLabelPaddingBottom,
    taskDetailViewDenseFieldGap,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewHeaderMarginBottom,
    taskDetailViewSectionGap,
    taskDetailViewStatusButtonMobilePaddingBottom,
    taskDetailViewStatusButtonMobilePaddingTop,
    taskDetailViewStatusButtonSize,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
    taskDetailViewTitleFontSize,
    taskDetailViewTitleLineHeight,
    taskGridViewColumnHeaderHeight,
    taskGridViewPaddingBottomWithoutNext,
    taskQueryViewCustomizationMobileLayoutMarginTop,
    taskQueryViewCustomizationMobileSectionGap,
    taskQueryViewCustomizationMobileSectionHeaderFontSize,
    taskQueryViewCustomizationMobileSectionHeaderHeight,
    taskQueryViewCustomizationMobileSectionHeaderMarginBottom,
    taskQueryViewCustomizationMobileSectionMarginBottom,
    taskQueryViewCustomizationMobileSectionOptionHeight,
    taskRowViewCollectionsColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewDragHandleWidthRem,
    taskRowViewExpandButtonWidthRem,
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {
    Spacing,
    convertRemLengthToPx,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

/**
 * Shimmer component for each space route. The test
 * `app/tests/space_routes.test.ts` makes sure we have a shimmer definition for
 * each space route.
 *
 * If a shimmer definition is `false` that means we show a generic fullscreen
 * loading spinner instead of a custom shimmer.
 */
const shimmerOptionsByRouteId: Record<
    AppSpaceRouteId,
    | {
          inboxBannerMaxWidth?: Spacing | "full";
          component: ComponentType<{
              searchParams: URLSearchParams;
              withInboxBanner: boolean;
              // Avoid TypeScript error "object has no properties in common" error.
              withBackButton?: undefined;
              titleWidth?: undefined;
          }>;
      }
    | false
> = {
    "routes/s.$spaceId._index": {component: FeedRouteShimmer},
    "routes/s.$spaceId.channels.$channelId._index": {component: ChannelRouteShimmer},
    "routes/s.$spaceId.channels.$channelId.files": {component: ChannelFilesRouteShimmer},
    "routes/s.$spaceId.channels.new": {component: ChannelCreatorRouteShimmer},
    "routes/s.$spaceId.chat.$chatId._index": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: ChatRouteShimmer,
    },
    "routes/s.$spaceId.chat.$chatId.messages.$index.reactions": {component: ReactionsRouteShimmer},
    "routes/s.$spaceId.chat.new": {component: NewChatRouteShimmer},
    "routes/s.$spaceId.chat.room.new": {component: RoomChatCreatorRouteShimmer},
    "routes/s.$spaceId.chat.with.$accountId": {component: ChatRouteShimmer},
    "routes/s.$spaceId.create._index": {component: CreateRouteShimmer},
    "routes/s.$spaceId.create.more": {component: CreateRouteShimmer},
    // Empty route...empty shimmer.
    "routes/s.$spaceId.dev.empty": {component: () => null},
    "routes/s.$spaceId.dev.feed": {component: FeedRouteShimmer},
    "routes/s.$spaceId.documents.$documentId._index": {component: DocumentRouteShimmer},
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId._index": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: DocumentCommentThreadRouteShimmer,
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions": {
        component: ReactionsRouteShimmer,
    },
    "routes/s.$spaceId.documents.$documentId.duplicate": {
        component: ContentDuplicationRouteShimmer,
    },
    "routes/s.$spaceId.favorites": {component: SearchFavoritesRouteShimmer},
    "routes/s.$spaceId.inbox": {component: InboxRouteShimmer},
    "routes/s.$spaceId.more._index": {component: MoreRouteShimmer},
    "routes/s.$spaceId.more.settings": {
        component: () => <MobileSettingsRowsShimmer titleWidth="28" sectionCounts={[2, 4]} />,
    },
    "routes/s.$spaceId.more.switch-space": {component: MoreSwitchSpaceRouteShimmer},
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: ChannelPostsNotificationRouteShimmer,
    },
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: DocumentCommentThreadRouteShimmer,
    },
    "routes/s.$spaceId.notifications.unsubscribe": false,
    "routes/s.$spaceId.posts.$postId._index": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: PostRouteShimmer,
    },
    "routes/s.$spaceId.posts.$postId.reactions": {
        component: ReactionsRouteShimmer,
    },
    "routes/s.$spaceId.posts.$postId.comments.$index.reactions": {component: ReactionsRouteShimmer},
    "routes/s.$spaceId.posts.new.$draftId": {component: NewPostRouteShimmer},
    "routes/s.$spaceId.search": {component: SearchRouteShimmer},
    "routes/s.$spaceId.settings.bots._index": {component: SpaceBotListSettingsRouteShimmer},
    "routes/s.$spaceId.settings.bots.$botId": {component: SpaceBotSettingsRouteShimmer},
    "routes/s.$spaceId.settings.general": {component: SpaceGeneralSettingsRouteShimmer},
    "routes/s.$spaceId.settings.integrations._index": {
        component: SpaceIntegrationsSettingsRouteShimmer,
    },
    "routes/s.$spaceId.settings.integrations.notion": {
        component: SpaceNotionImportSettingsRouteShimmer,
    },
    "routes/s.$spaceId.settings.integrations.slack": {
        component: SpaceSlackIntegrationSettingsRouteShimmer,
    },

    "routes/s.$spaceId.settings.people": {component: SpacePeopleSettingsRouteShimmer},
    "routes/s.$spaceId.settings.profile": {component: SpaceProfileSettingsRouteShimmer},
    "routes/s.$spaceId.settings.notifications": {component: SpaceNotificationsSettingsRouteShimmer},

    "routes/s.$spaceId.tasks._index": {component: TaskPersonalRouteShimmer},
    // TODO: `inboxBannerMaxWidth` for this route.
    "routes/s.$spaceId.tasks.$taskId._index": {component: TaskDetailRouteShimmer},
    "routes/s.$spaceId.tasks.$taskId.comments.$index.reactions": {component: ReactionsRouteShimmer},
    "routes/s.$spaceId.tasks.$taskId.duplicate": {component: ContentDuplicationRouteShimmer},
    "routes/s.$spaceId.tasks.collections.$collectionId": {component: TaskCollectionRouteShimmer},
    "routes/s.$spaceId.tasks.view": {component: TaskQueryRouteShimmer},

    // These routes currently only perform a redirect. They don't render any UI and so
    // don't need a shimmer.
    "routes/s.$spaceId.accounts.$accountId": false,
    "routes/s.$spaceId.settings._index": false,

    // This route is only used to handle the OAuth callback from Slack. It doesn't
    // render any UI and so doesn't need a shimmer.
    "routes/s.$spaceId.integrations.slack.oauth": false,

    // NOTE(rohit): We don't have a design for layout routes.
    "routes/s.$spaceId.settings": false,

    "routes/s.$spaceId.invite._index": false,
    "routes/s.$spaceId.invite.reject-and-mark-as-spam": false,
    "routes/s.$spaceId.invite.accept": {component: FeedRouteShimmer},
};

const RouteShimmerMemo = memo(RouteShimmer);
export {RouteShimmerMemo as RouteShimmer};

function RouteShimmer({
    routeId,
    searchParams,
    withInboxBanner,
}: {
    routeId: string | null;
    searchParams: URLSearchParams;
    withInboxBanner: boolean;
}) {
    const routeLayout = useRouteLayout();

    const shimmerOptions = routeId
        ? cast<{[key: string]: (typeof shimmerOptionsByRouteId)[AppSpaceRouteId]}>(
              shimmerOptionsByRouteId,
          )[routeId.replace(".peek.", ".")]
        : undefined;

    const containerRef = useCoordinatedShimmerAnimations({isDisabled: !shimmerOptions});

    if (!shimmerOptions) {
        return (
            <Box
                width="full"
                height="full"
                overflow="hidden"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <SpinnerGap
                    className={spinAnimationClassName}
                    color={colorSchemeVars["grey-70"]}
                    size={spacing[routeLayout === "narrow" ? "6" : "8"]}
                />
            </Box>
        );
    }

    if (!withInboxBanner) {
        return (
            <Box ref={containerRef} width="full" height="full" overflow="hidden">
                <shimmerOptions.component
                    searchParams={searchParams}
                    withInboxBanner={withInboxBanner}
                />
            </Box>
        );
    } else {
        return (
            <Box
                ref={containerRef}
                width="full"
                height="full"
                overflow="hidden"
                position="relative"
                style={{
                    // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                    // like it.
                    "--safe-area-inset-top": `calc(var(--safe-area-inset-top-base, 0px) + ${spacing[inboxBannerHeight]})`,
                }}
            >
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    style={{
                        paddingTop: "var(--safe-area-inset-top-base, 0px)",
                    }}
                >
                    <Box
                        display="flex"
                        alignItems="center"
                        marginX="center"
                        maxWidth={shimmerOptions.inboxBannerMaxWidth ?? "full"}
                        height={inboxBannerHeight}
                        paddingX={screenPaddingX}
                    >
                        <TextShimmer fontSize="50" width="16" />
                        <Box flexGrow="1" />
                        <Box
                            flexShrink="0"
                            className={pulseAnimationClassName}
                            height="6"
                            borderRadius="1"
                            backgroundColor="grey-10"
                        >
                            <Box opacity="0">
                                <Button
                                    // Render a non-interactive button to get the exact right size for the button
                                    // shimmer.
                                    isDisabled={true}
                                    isFocusable={false}
                                    isTabbable={false}
                                    variant="neutral"
                                    height="6"
                                    paddingX="2"
                                    icon={<Check />}
                                >
                                    Done
                                </Button>
                            </Box>
                        </Box>
                    </Box>
                </Box>
                <Box width="full" height="full" overflow="hidden">
                    <shimmerOptions.component
                        searchParams={searchParams}
                        withInboxBanner={withInboxBanner}
                    />
                </Box>
            </Box>
        );
    }
}

export function FeedRouteShimmer() {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();

    return (
        <Box overflow="hidden" width="full" height="full" display="flex" flexDirection="column">
            {platform !== "desktop" && (
                <Box flexShrink="0" width="full" paddingX={screenPaddingX}>
                    <Box height="safe-area-inset-top" />
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        paddingX={navigationBarMobileGap}
                    >
                        <TextShimmer fontSize="100" width="24" />
                    </Box>
                </Box>
            )}
            <Box
                overflow="hidden"
                flexGrow="1"
                width="full"
                display="flex"
                justifyContent="space-between"
            >
                {platform === "desktop" && (
                    <Box
                        width="full"
                        style={{flex: feedViewSideBarLeftFlex, maxWidth: feedViewSideBarWidth}}
                        paddingX={feedViewSideBarPaddingX}
                    >
                        <Box
                            display="flex"
                            alignItems="center"
                            height={navigationBarHeight}
                            marginBottom={`-${feedViewSideBarSpaceNameNegativeMarginBottom}`}
                            paddingX={searchEntityViewDefaultPaddingX}
                        >
                            <TextShimmer fontSize={feedViewSideBarSpaceNameFontSize} width="32" />
                        </Box>
                        <Box paddingX={searchEntityViewDefaultPaddingX}>
                            <Spacer space={searchEntityHeaderPaddingTop} />
                            <TextShimmer
                                fontSize={{
                                    fontSize: fontSizes[searchEntityHeaderFontSize].fontSize,
                                    lineHeight: spacing[searchEntityHeaderLineHeight],
                                }}
                                width="16"
                            />
                        </Box>
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="64"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="32"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="48"
                        />
                        <Box paddingX={searchEntityViewDefaultPaddingX}>
                            <Spacer space={searchEntityHeaderPaddingTop} />
                            <TextShimmer
                                fontSize={{
                                    fontSize: fontSizes[searchEntityHeaderFontSize].fontSize,
                                    lineHeight: spacing[searchEntityHeaderLineHeight],
                                }}
                                width="12"
                            />
                        </Box>
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="48"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="24"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="24"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="24"
                        />
                        <Box paddingX={searchEntityViewDefaultPaddingX}>
                            <Spacer space={searchEntityHeaderPaddingTop} />
                            <TextShimmer
                                fontSize={{
                                    fontSize: fontSizes[searchEntityHeaderFontSize].fontSize,
                                    lineHeight: spacing[searchEntityHeaderLineHeight],
                                }}
                                width="16"
                            />
                        </Box>
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="48"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="32"
                        />
                        <SearchEntityShimmer
                            paddingX={searchEntityViewDefaultPaddingX}
                            marginX="0"
                            titleWidth="32"
                        />
                    </Box>
                )}
                <Box
                    width="full"
                    maxWidth={contentStyles.contentMaxWidth}
                    style={{flex: postViewFlex}}
                >
                    {platform === "desktop" && (
                        <Box
                            height={navigationBarHeight}
                            paddingX={feedCreateSectionSearchBarContainerPaddingX}
                            paddingY={feedCreateSectionSearchBarContainerPaddingY}
                        >
                            <Box
                                position="relative"
                                display="flex"
                                alignItems="center"
                                height="full"
                                boxShadow="elevation-5-with-grey-10-border"
                                borderRadius="full"
                            />
                        </Box>
                    )}
                    {platform === "mobile" && (
                        <Box paddingX={screenPaddingX}>
                            <TextShimmer
                                fontSize={{
                                    fontSize:
                                        fontSizes[feedCreateSectionHeadingFontSize[platform]]
                                            .fontSize,
                                    lineHeight: feedCreateSectionHeadingLineHeight[platform],
                                }}
                                width="9"
                            />
                        </Box>
                    )}
                    <Box
                        paddingX={platform === "desktop" ? screenPaddingX : undefined}
                        marginX={
                            platform === "desktop"
                                ? `-${createWidgetPrimaryMenuBarItemDesktopPaddingX}`
                                : undefined
                        }
                        marginTop={`-${createWidgetPrimaryMenuBarItemBackgroundInsetY}`}
                        marginBottom={
                            platform !== "desktop"
                                ? `-${createWidgetPrimaryMenuBarItemBackgroundInsetY}`
                                : undefined
                        }
                    >
                        <Box height={createWidgetPrimaryMenuBarItemHeight} display="flex">
                            <CreateWidgetPrimaryMenuBarItemShimmer />
                            <CreateWidgetPrimaryMenuBarItemShimmer />
                            <CreateWidgetPrimaryMenuBarItemShimmer />
                            <CreateWidgetPrimaryMenuBarItemShimmer isLastItem={true} />
                        </Box>
                    </Box>
                    <Box paddingX={screenPaddingX} position="relative">
                        {platform === "mobile" && (
                            <>
                                <Spacer space={feedCreateSectionGap[platform]} />
                                <TextShimmer
                                    fontSize={{
                                        fontSize:
                                            fontSizes[feedCreateSectionHeadingFontSize[platform]]
                                                .fontSize,
                                        lineHeight: feedCreateSectionHeadingLineHeight[platform],
                                    }}
                                    width="16"
                                />
                                <SearchEntityShimmer paddingX="0" marginX="0" titleWidth="96" />
                                <SearchEntityShimmer paddingX="0" marginX="0" titleWidth="64" />
                                <SearchEntityShimmer paddingX="0" marginX="0" titleWidth="48" />
                                <SearchEntityShimmer paddingX="0" marginX="0" titleWidth="96" />
                                <SearchEntityShimmer paddingX="0" marginX="0" titleWidth="64" />
                            </>
                        )}
                        <Spacer space={feedCreateSectionGap[platform]} />
                        <TextShimmer
                            fontSize={{
                                fontSize:
                                    fontSizes[feedCreateSectionHeadingFontSize[platform]].fontSize,
                                lineHeight: feedCreateSectionHeadingLineHeight[platform],
                            }}
                            width="16"
                        />
                        <Spacer space={feedCreateSectionForYouHeadingMarginBottom} />
                    </Box>
                    <PostShimmer />
                    <PostShimmer />
                    <PostShimmer />
                    <PostShimmer />
                    <PostShimmer withBottomBorder />
                </Box>
                {platform !== "mobile" && spacingScale !== "small" && (
                    <Box
                        width="full"
                        style={{flex: feedViewSideBarRightFlex, maxWidth: feedViewSideBarWidth}}
                    />
                )}
            </Box>
        </Box>
    );
}

function CreateWidgetPrimaryMenuBarItemShimmer({isLastItem}: {isLastItem?: boolean}) {
    const platform = usePlatform();

    return (
        <Box
            position="relative"
            zIndex="0"
            flexGrow="1"
            width="full"
            minWidth="flex-fit"
            height={createWidgetPrimaryMenuBarItemHeight}
            paddingX={
                platform === "desktop" ? createWidgetPrimaryMenuBarItemDesktopPaddingX : undefined
            }
            display="flex"
            alignItems="center"
            justifyContent={platform === "desktop" ? "space-between" : "center"}
            gap="2"
        >
            <Box display="flex" alignItems="center" gap="1.5">
                <Box
                    width={searchEntityViewMediaSize}
                    height={searchEntityViewMediaSize}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box
                        className={pulseAnimationClassName}
                        width="3"
                        height="3"
                        backgroundColor="grey-5"
                        borderRadius="full"
                    />
                </Box>
                <Box width="8">
                    <TextShimmer fontSize={searchEntityViewTitleFontSize} width="8" />
                </Box>
            </Box>
            {!isLastItem && (
                <Box
                    position="absolute"
                    zIndex="10"
                    top="3"
                    bottom="3"
                    width="border"
                    backgroundColor="grey-5"
                    pointerEvents="none"
                    style={{
                        // Rounds up to 0.5px on high-DPI screens and rounds down to 0px on low-DPI
                        // screens.
                        right: -0.45,
                    }}
                />
            )}
        </Box>
    );
}

function ChannelRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <Box width="full" display="flex" justifyContent="center">
            <Box width="full" maxWidth={contentStyles.contentMaxWidth} style={{flex: postViewFlex}}>
                <Box position="relative" paddingX={screenPaddingX}>
                    <Box height="safe-area-inset-top" />
                    <Box
                        display="flex"
                        justifyContent={platform === "mobile" ? "space-between" : undefined}
                        alignItems="center"
                        height={navigationBarHeight}
                    >
                        {platform === "mobile" && <MobileBackButton />}
                        <TextShimmer
                            width={platform === "mobile" ? "24" : "32"}
                            fontSize={platform === "mobile" ? "100" : "400"}
                        />
                        {platform === "mobile" && <MobileBackButtonSpacer />}
                    </Box>
                    {routeLayout === "narrow" && (
                        <Box
                            paddingTop={channelViewHeaderNarrowRouteLayoutMarginTop}
                            display="flex"
                            flexDirection="column"
                            gap={channelViewHeaderSectionGap}
                        >
                            <Box
                                className={pulseAnimationClassName}
                                position="relative"
                                zIndex="0"
                                display="flex"
                            >
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="10" isFirst />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="20" />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="30" />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="40" />
                            </Box>
                            <Box marginBottom="-1.5">
                                <TextShimmer fontSize="75" width="10" />
                                <Spacer space="1" />
                                <TextShimmer
                                    fontSize={{
                                        ...fontSizes["100"],
                                        lineHeight: contentStyles.paragraphFontSize.lineHeight,
                                    }}
                                    width="48"
                                />
                            </Box>
                        </Box>
                    )}
                    <Box height={postFauxInputCreateButtonMarginTop[routeLayout]} />
                    <Box
                        className={pulseAnimationClassName}
                        display="flex"
                        justifyContent="flex-end"
                        alignItems="center"
                        width="full"
                        height={postFauxInputCreateButtonHeight}
                        padding="2.5"
                        boxShadow="elevation-5-with-grey-10-border"
                        borderRadius="1.5"
                    >
                        <Box
                            paddingX="2"
                            height={postFauxInputCreateButtonInnerButtonHeight}
                            minWidth="16"
                            backgroundColor="grey-10"
                            borderRadius="1"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            style={{
                                // We include the text for layout but we don't want to render it.
                                color: "transparent",
                            }}
                        >
                            Post
                        </Box>
                    </Box>
                    <Box height={postContentViewOuterMarginY} />
                    <Box
                        position="absolute"
                        left="0"
                        right="0"
                        height={routeLayout === "narrow" ? "border" : "border-thick"}
                        backgroundColor="grey-5"
                        style={{bottom: -1}}
                    />
                </Box>
                <PostShimmer />
                <PostShimmer />
                <PostShimmer />
                <PostShimmer />
                <PostShimmer />
            </Box>
            {routeLayout !== "narrow" && (
                <Box
                    width="full"
                    maxWidth={postListViewAsideMaxWidth}
                    style={{flex: postListViewAsideFlex}}
                >
                    <Box height="safe-area-inset-top" />
                    <Box height={navigationBarHeight} />
                    <Box
                        paddingLeft={postListViewAsidePaddingLeft}
                        paddingRight={postListViewAsidePaddingRight}
                        paddingBottom={screenPaddingX}
                        display="flex"
                        flexDirection="column"
                        gap={channelViewAsideSectionGap}
                        style={{paddingTop: channelViewAsidePaddingTop}}
                    >
                        <Box>
                            <Box marginBottom={channelViewMetadataSectionTitleMarginBottom}>
                                <TextShimmer
                                    width="16"
                                    ragRight="6"
                                    fontSize={channelViewMetadataSectionTitleFontSize}
                                    color="grey-5"
                                />
                            </Box>
                            <Box
                                className={pulseAnimationClassName}
                                position="relative"
                                zIndex="0"
                                display="flex"
                            >
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="40" isFirst />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="30" />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="20" />
                                <ChannelRouteContributorsAccountAvatarShimmer zIndex="10" />
                            </Box>
                        </Box>
                        <Box>
                            <TextShimmer
                                width="9"
                                fontSize={channelViewMetadataSectionTitleFontSize}
                                color="grey-5"
                            />
                            <Spacer space="1" />
                            <TextShimmer
                                width="32"
                                fontSize={contentStyles.paragraphFontSize}
                                color="grey-5"
                            />
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

function ChannelRouteContributorsAccountAvatarShimmer({
    zIndex,
    isFirst,
}: {
    zIndex: Sprinkles["zIndex"];
    isFirst?: boolean;
}) {
    return (
        <Box
            position="relative"
            zIndex={zIndex}
            backgroundColor="grey-10"
            width="7"
            height="7"
            marginLeft={isFirst ? "0" : "-1"}
            borderRadius="full"
            style={{
                boxShadow: `0px 0px 0px 2px ${colorSchemeVars["grey-0"]}`,
            }}
        />
    );
}

function ChannelFilesRouteShimmer() {
    const platform = usePlatform();
    const clientInfo = useClientInfo();
    const spacingScale = useSpacingScale();
    const remPx = remPxBySpacingScale[spacingScale];

    const [containerRef, containerSize] = useResizeObserver();

    const maxWidth = channelFilesViewMaxWidth[platform];

    const fileSizePx = clamp(
        convertRemLengthToPx(spacing[channelFilesViewFileMinSize], spacingScale),
        ((containerSize?.width ?? clientInfo.screenWidth) -
            screenPaddingXRem[platform] * 2 * remPx -
            contentStyles.fileRowGapWidthRem * (channelFilesViewFileRowFileCount - 1) * remPx) /
            channelFilesViewFileRowFileCount,
        convertRemLengthToPx(spacing[channelFilesViewFileMaxSize], spacingScale),
    );

    return (
        <Box ref={containerRef} display="flex" flexDirection="column" alignItems="center">
            <Box flexShrink="0" paddingTop="safe-area-inset" width="full" style={{maxWidth}}>
                <Box
                    position="relative"
                    height={navigationBarHeight}
                    maxWidth={contentStyles.contentMaxWidth}
                >
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="center"
                        alignItems={platform !== "mobile" ? "flex-start" : "center"}
                        width="full"
                        maxWidth={contentStyles.contentMaxWidth}
                        height="full"
                        paddingX={screenPaddingX}
                    >
                        <TextShimmer fontSize="200" width="32" />
                        <TextShimmer fontSize="75" width="8" />
                    </Box>
                </Box>
            </Box>
            <Box
                className={pulseAnimationClassName}
                width="full"
                paddingX={screenPaddingX}
                gap={contentStyles.fileRowGapWidth}
                style={{
                    maxWidth,
                    display: "grid",
                    gridTemplateColumns: `repeat(${channelFilesViewFileRowFileCount}, 1fr)`,
                    gridTemplateRows: `repeat(3, ${fileSizePx}px)`,
                }}
            >
                {createArrayWithLength(channelFilesViewFileRowFileCount * 3, index => (
                    <Box
                        key={index}
                        backgroundColor="grey-5"
                        style={{width: fileSizePx, height: fileSizePx}}
                    />
                ))}
            </Box>
        </Box>
    );
}

function ChannelCreatorRouteShimmer() {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();

    return (
        <Box display="flex" flexDirection="column" alignItems="center">
            <Box
                flexShrink="0"
                paddingTop="safe-area-inset"
                width="full"
                maxWidth={peekNarrowLayoutWidth}
            >
                <Box
                    display="flex"
                    alignItems="center"
                    position="relative"
                    height={navigationBarHeight}
                    paddingX={platform === "mobile" ? navigationBarMobileGap : screenPaddingX}
                >
                    {platform === "mobile" && <MobileBackButton />}
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="center"
                        alignItems={platform !== "mobile" ? "flex-start" : "center"}
                        width="full"
                        height="full"
                    >
                        <TextShimmer
                            fontSize={
                                platform !== "mobile"
                                    ? channelCreatorNavigationBarDesktopTitleFontSize
                                    : "100"
                            }
                            width={platform !== "mobile" ? "32" : "20"}
                            ragRight={platform !== "mobile" ? "4" : undefined}
                        />
                    </Box>
                    <Box display="flex" justifyContent="flex-end" width="7">
                        <Box
                            className={pulseAnimationClassName}
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-10"
                            paddingX="3"
                            height="7"
                            borderRadius="1"
                        >
                            <Box opacity="0" fontSize="100">
                                Create
                            </Box>
                        </Box>
                    </Box>
                </Box>
                <Box paddingTop={channelCreatorMarginTop} paddingX={screenPaddingX}>
                    <TextShimmer fontSize="75" width="10" ragRight="2" />
                    <Spacer space="1.5" />
                    <Box height="9" className={textInputClassName}></Box>
                    <Spacer space={channelCreatorFieldHelpMarginTop} />
                    <TextShimmer fontSize="50" width="full" ragRight="6" />
                    <TextShimmer fontSize="50" width="24" />
                    <Spacer space={channelCreatorGap} />
                    <TextShimmer fontSize="75" width="16" />
                    <Spacer space="1.5" />
                    <Box
                        className={textInputClassName}
                        style={{
                            height: channelCreatorDescriptionFieldMinHeightPx[spacingScale],
                        }}
                    ></Box>
                    <Spacer space={channelCreatorFieldHelpMarginTop} />
                    <TextShimmer fontSize="50" width="full" ragRight="3" />
                    <TextShimmer fontSize="50" width="64" />
                </Box>
            </Box>
        </Box>
    );
}

function ContentDuplicationRouteShimmer() {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();

    return (
        <Box display="flex" flexDirection="column" alignItems="center">
            <Box
                flexShrink="0"
                paddingTop="safe-area-inset"
                width="full"
                maxWidth={peekNarrowLayoutWidth}
            >
                <Box
                    display="flex"
                    alignItems="center"
                    position="relative"
                    height={navigationBarHeight}
                    paddingX={platform === "mobile" ? navigationBarMobileGap : screenPaddingX}
                >
                    {platform === "mobile" && <MobileBackButton />}
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="center"
                        alignItems={platform !== "mobile" ? "flex-start" : "center"}
                        width="full"
                        height="full"
                    >
                        {/* Title: "Duplicate "[title]"" */}
                        <TextShimmer
                            fontSize={
                                platform !== "mobile"
                                    ? channelCreatorNavigationBarDesktopTitleFontSize
                                    : "100"
                            }
                            width={platform !== "mobile" ? "48" : "32"}
                            ragRight={platform !== "mobile" ? "4" : undefined}
                        />
                    </Box>
                    {/* "Create" button */}
                    <Box display="flex" justifyContent="flex-end">
                        <Box
                            className={pulseAnimationClassName}
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-10"
                            paddingX="3"
                            height="7"
                            borderRadius="1"
                        >
                            <Box opacity="0" fontSize="100">
                                Create
                            </Box>
                        </Box>
                    </Box>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    gap={channelCreatorGap}
                    paddingTop={channelCreatorMarginTop}
                    paddingX={screenPaddingX}
                >
                    {/* First text input */}
                    <Box pointerEvents="auto">
                        <TextShimmer fontSize="75" width="10" />
                        <Spacer space="1.5" />
                        <Box height="9" className={textInputClassName} />
                    </Box>
                    {/* Second text input */}
                    <Box>
                        <TextShimmer fontSize="75" width="14" />
                        <Spacer space="1.5" />
                        <Box height="9" className={textInputClassName} />
                    </Box>
                    {/* Content input */}
                    <Box>
                        <TextShimmer fontSize="75" width="14" ragRight="2" />
                        <Spacer space="1.5" />
                        <Box
                            className={textInputClassName}
                            style={{
                                height: channelCreatorDescriptionFieldMinHeightPx[spacingScale],
                            }}
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function ChatRouteShimmer({withInboxBanner}: {withInboxBanner: boolean}) {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" paddingTop="safe-area-inset">
                <Box position="relative" height={navigationBarHeight}>
                    <ChatTopBarBorderShimmer />
                    {platform === "mobile" && (
                        <Box
                            position="absolute"
                            top="0"
                            bottom="0"
                            left={navigationBarMobileGap}
                            display="flex"
                            alignItems="center"
                        >
                            <MobileBackButton />
                        </Box>
                    )}
                    <Box
                        display="flex"
                        flexDirection={platform !== "mobile" ? "row" : "column"}
                        justifyContent={platform !== "mobile" ? "flex-start" : "center"}
                        alignItems="center"
                        gap={platform !== "mobile" ? messageViewRailGap : "1"}
                        width="full"
                        maxWidth={contentStyles.contentMaxWidth}
                        height="full"
                        marginX="center"
                        paddingX={screenPaddingX}
                        paddingBottom={
                            withInboxBanner
                                ? chatViewTopBarWithInboxBannerAdjustmentY[platform]
                                : undefined
                        }
                    >
                        <Box
                            className={pulseAnimationClassName}
                            flexShrink="0"
                            width={messageViewAccountAvatarSize}
                            height={messageViewAccountAvatarSize}
                            backgroundColor="grey-10"
                            borderRadius="full"
                        />
                        <TextShimmer
                            fontSize={platform !== "mobile" ? "200" : "50"}
                            width={platform === "mobile" ? "12" : "32"}
                        />
                    </Box>
                </Box>
            </Box>
            <MessagingViewShimmer withTopAlignedMessages={false} messages="fill" />
        </Box>
    );
}

function NewChatRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" position="relative" zIndex="10" paddingTop="safe-area-inset">
                <ChatTopBarBorderShimmer />
                {platform === "mobile" && (
                    <Box
                        height={navigationBarHeight}
                        paddingX={navigationBarMobileGap}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        <MobileBackButton />
                        <TextShimmer fontSize="100" width="24" />
                        <MobileBackButtonSpacer />
                    </Box>
                )}
                <Box height={platform !== "mobile" ? "12" : "10"}>
                    <Box
                        display="flex"
                        alignItems="center"
                        width="full"
                        maxWidth={contentStyles.contentMaxWidth}
                        height="full"
                        marginX="center"
                        paddingX={screenPaddingX}
                    >
                        <TextShimmer fontSize={platform !== "mobile" ? "100" : "50"} width="32" />
                    </Box>
                </Box>
            </Box>
            <MessagingViewShimmer withTopAlignedMessages={false} messages="few" />
        </Box>
    );
}

function ChatTopBarBorderShimmer() {
    return (
        <Box
            pointerEvents="none"
            position="absolute"
            height="border"
            backgroundColor="grey-5-translucent"
            style={{
                bottom: -1,
                left: `max(-${spacing["3"]}, (100% - ${
                    spacing[contentStyles.contentMaxWidth]
                }) / 2 - ${spacing["3"]})`,
                right: `max(-${spacing["3"]}, (100% - ${
                    spacing[contentStyles.contentMaxWidth]
                }) / 2 - ${spacing["3"]})`,
                maskImage: `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`,
            }}
        />
    );
}

function RoomChatCreatorRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box display="flex" flexDirection="column" alignItems="center">
            <Box
                flexShrink="0"
                paddingTop="safe-area-inset"
                width="full"
                maxWidth={peekNarrowLayoutWidth}
            >
                <Box
                    display="flex"
                    alignItems="center"
                    position="relative"
                    height={navigationBarHeight}
                    paddingX={platform === "mobile" ? navigationBarMobileGap : screenPaddingX}
                >
                    {platform === "mobile" && <MobileBackButton />}
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="center"
                        alignItems={platform !== "mobile" ? "flex-start" : "center"}
                        width="full"
                        height="full"
                    >
                        <TextShimmer
                            fontSize={
                                platform !== "mobile"
                                    ? channelCreatorNavigationBarDesktopTitleFontSize
                                    : "100"
                            }
                            width={platform !== "mobile" ? "32" : "24"}
                        />
                    </Box>
                    <Box display="flex" justifyContent="flex-end" width="7">
                        <Box
                            className={pulseAnimationClassName}
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-10"
                            paddingX="3"
                            height="7"
                            borderRadius="1"
                        >
                            <Box opacity="0" fontSize="100">
                                Create
                            </Box>
                        </Box>
                    </Box>
                </Box>
                <Box paddingTop={channelCreatorMarginTop} paddingX={screenPaddingX}>
                    <TextShimmer fontSize="75" width="10" ragRight="2" />
                    <Spacer space="1.5" />
                    <Box height="9" className={textInputClassName}></Box>
                    <Spacer space={channelCreatorFieldHelpMarginTop} />
                    <TextShimmer fontSize="50" width="full" ragRight="6" />
                    <TextShimmer fontSize="50" width="48" />
                </Box>
            </Box>
        </Box>
    );
}

function MessagingViewShimmer({
    messages,
    withTopAlignedMessages,
}: {
    messages: "fill" | "few";
    withTopAlignedMessages: boolean;
}) {
    return (
        <>
            <Box
                overflow="hidden"
                flexGrow="1"
                display="flex"
                flexDirection="column"
                justifyContent={
                    withTopAlignedMessages && messages === "few" ? "flex-start" : "flex-end"
                }
            >
                {withTopAlignedMessages && messages === "few" && (
                    <Box
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        height={messageViewTimestampDividerHeight}
                        marginBottom={messageViewTimestampDividerMarginY}
                    >
                        <TextShimmer width="16" fontSize="50" />
                    </Box>
                )}
                {messages === "fill" && (
                    <>
                        <MessageShimmer
                            width="48"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                        />
                        <MessageShimmer
                            width="64"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                            shouldMergeWithPreviousMessage={true}
                        />
                        <MessageShimmer
                            width="128"
                            heightLines={1}
                            shouldMergeWithPreviousMessage={true}
                        />
                        <MessageShimmer width="128" heightLines={1} />
                        <MessageShimmer width="160" heightLines={2} />
                        <MessageShimmer width="96" heightLines={1} />
                        <MessageShimmer
                            width="64"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                        />
                        <MessageShimmer
                            width="32"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                            shouldMergeWithPreviousMessage={true}
                        />
                        <MessageShimmer
                            width="128"
                            heightLines={1}
                            shouldMergeWithPreviousMessage={true}
                        />
                        <MessageShimmer
                            width="96"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                        />
                        <MessageShimmer
                            width="32"
                            heightLines={1}
                            shouldMergeWithPreviousMessage={true}
                        />
                        <MessageShimmer width="160" heightLines={3} />
                        <MessageShimmer
                            width="32"
                            heightLines={1}
                            shouldMergeWithNextMessage={true}
                        />
                        <MessageShimmer
                            width="96"
                            heightLines={1}
                            shouldMergeWithPreviousMessage={true}
                        />
                    </>
                )}
                <MessageShimmer width="32" heightLines={1} />
                <MessageShimmer width="64" heightLines={1} shouldMergeWithNextMessage={true} />
                <MessageShimmer width="96" heightLines={1} shouldMergeWithPreviousMessage={true} />
                <MessageShimmer width="128" heightLines={1} />
            </Box>
            <MessageInputShimmer />
            <Box flexShrink="0" height="safe-area-inset-bottom" />
        </>
    );
}

function MessageInputShimmer() {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();

    return (
        <Box
            flexShrink="0"
            backgroundColor="grey-0"
            style={{height: messageInputMinHeightPx[platform][spacingScale]}}
        >
            <Box
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
                height="full"
                marginX="center"
                paddingX={screenPaddingX}
                paddingY={messageInputPaddingY}
            >
                <Box
                    position="relative"
                    marginX={messageInputEditorIconButtonNegativeMarginX}
                    style={{
                        height: messageInputEditorMinHeightPx[platform][spacingScale],
                    }}
                >
                    <Box
                        width="full"
                        height="full"
                        border="grey-10"
                        style={{
                            borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                        }}
                    />
                    <Box
                        position="absolute"
                        right="0"
                        top="0"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            width: messageInputEditorMinHeightPx[platform][spacingScale],
                            height: messageInputEditorMinHeightPx[platform][spacingScale],
                        }}
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width={messageViewAccountAvatarSize}
                            height={messageViewAccountAvatarSize}
                            backgroundColor="grey-10"
                            borderRadius="full"
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

// Not much going on for the create route shimmer. We expect create routes to load
// very fast given they don't have any data they need to load from the server.
// Create route shimmers mostly exist for completeness and to make sure a route
// like `/create/more` has a back button in its shimmer.
function CreateRouteShimmer({withBackButton}: {withBackButton?: boolean}) {
    const platform = usePlatform();

    withBackButton &&= platform === "mobile";

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <Box width="full" height="full">
            <Box width="full" maxWidth={maxWidth} paddingTop="safe-area-inset" marginX="center">
                <Box
                    width="full"
                    height={navigationBarHeight}
                    paddingX={navigationBarMobileGap}
                    display="flex"
                    justifyContent={withBackButton ? "space-between" : "center"}
                    alignItems="center"
                >
                    {withBackButton && <MobileBackButton />}
                    <TextShimmer fontSize="100" width="16" />
                    {withBackButton && <MobileBackButtonSpacer />}
                </Box>
            </Box>
        </Box>
    );
}

function DocumentRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    const titleFontSize = contentStyles.titleFontSize[routeLayout];

    return (
        <Box position="relative" paddingX={screenPaddingX}>
            {platform === "mobile" && (
                <Box position="absolute" top="0" left="0" right="0">
                    <Box height="safe-area-inset-top" />
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        alignItems="center"
                        paddingX={navigationBarMobileGap}
                    >
                        <MobileBackButton />
                    </Box>
                </Box>
            )}
            <Box
                marginX="center"
                width="full"
                paddingRight={routeLayout === "narrow" ? "8" : "12"}
                style={{maxWidth: contentStyles.blockMaxWidth[platform]}}
            >
                <Box height="safe-area-inset-top" />
                <Box
                    style={{
                        height: contentStyles.titlePaddingTop[
                            getPlatformRouteLayout(platform, routeLayout)
                        ],
                    }}
                />
                <TextShimmer width="96" ragRight="8" fontSize={titleFontSize} />
                <Box height={contentStyles.paragraphMargin} />
                <ContentParagraphShimmer1 />
                <Box height={contentStyles.heading1TopMargin[routeLayout]} />
                <TextShimmer
                    width="48"
                    fontSize={contentStyles.headingLevel1FontSize[routeLayout]}
                />
                <Box height={contentStyles.paragraphMargin} />
                <ContentParagraphShimmer2 />
                <Box height={contentStyles.paragraphMargin} />
                <ContentParagraphShimmer3 />
                {routeLayout !== "narrow" && (
                    <>
                        <Box height={contentStyles.heading1TopMargin[routeLayout]} />
                        <TextShimmer
                            width="64"
                            fontSize={contentStyles.headingLevel1FontSize[routeLayout]}
                        />
                        <Box height={contentStyles.paragraphMargin} />
                        <ContentParagraphShimmer1 />
                        <Box height={contentStyles.heading2TopMargin[routeLayout]} />
                        <TextShimmer
                            width="96"
                            fontSize={contentStyles.headingLevel2FontSize[routeLayout]}
                        />
                        <Box height={contentStyles.paragraphMargin} />
                        <ContentParagraphShimmer3 />
                        <Box height={contentStyles.paragraphMargin} />
                        <ContentParagraphShimmer2 />
                    </>
                )}
            </Box>
        </Box>
    );
}

function DocumentCommentThreadRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            <Box flexGrow="1" overflow="hidden">
                <Box height="safe-area-inset-top" />
                {platform === "mobile" && (
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        paddingX={navigationBarMobileGap}
                    >
                        <MobileBackButton />
                        <TextShimmer fontSize="100" width="32" />
                        <MobileBackButtonSpacer />
                    </Box>
                )}
                <Box width="full" maxWidth={contentStyles.contentMaxWidth} marginX="center">
                    <Box
                        height={platform === "mobile" ? "3" : documentCommentThreadHeaderPaddingY}
                    />
                    <Box paddingX={screenPaddingX}>
                        <Box
                            height={documentCommentThreadActionsHeight}
                            display="flex"
                            alignItems="center"
                            gap="2"
                        >
                            <Box
                                className={pulseAnimationClassName}
                                backgroundColor="grey-10"
                                width="7"
                                height="7"
                                borderRadius="full"
                            />
                            <TextShimmer fontSize="75" width="24" />
                        </Box>
                        <Box height={documentCommentThreadHeaderPaddingY} />
                        <Box
                            className={pulseAnimationClassName}
                            width="full"
                            height={documentCommentThreadPreviewHeight}
                            borderRadius="1.5"
                            border="grey-10"
                        />
                    </Box>
                    <Box height="5" />
                    <Box height={messageViewMarginY} />
                    <Box height={messageViewTimestampDividerHeight} />
                    <Box height={messageViewTimestampDividerMarginY} />
                    <MessageShimmer width="32" heightLines={1} />
                    <MessageShimmer width="64" heightLines={1} shouldMergeWithNextMessage={true} />
                    <MessageShimmer
                        width="96"
                        heightLines={1}
                        shouldMergeWithPreviousMessage={true}
                    />
                    <MessageShimmer width="48" heightLines={1} shouldMergeWithNextMessage={true} />
                    <MessageShimmer
                        width="64"
                        heightLines={1}
                        shouldMergeWithNextMessage={true}
                        shouldMergeWithPreviousMessage={true}
                    />
                    <MessageShimmer
                        width="128"
                        heightLines={1}
                        shouldMergeWithPreviousMessage={true}
                    />
                    <MessageShimmer width="96" heightLines={1} />
                </Box>
            </Box>
            <MessageInputShimmer />
            <Box flexShrink="0" height="safe-area-inset-bottom" />
        </Box>
    );
}

function SearchFavoritesRouteShimmer() {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    const maxWidth = routeLayout !== "narrow" ? peekNarrowLayoutWidth : undefined;

    const screenPaddingXWithoutSearchEntityViewPaddingX = mapObjectValues(
        screenPaddingX,
        screenPaddingX => subtractRemLengths(screenPaddingX, searchEntityViewDefaultPaddingX),
    );

    return (
        <Box width="full" height="full">
            <Box width="full" maxWidth={maxWidth} paddingTop="safe-area-inset" marginX="center">
                <Box
                    width="full"
                    height={navigationBarHeight}
                    paddingX={platform === "mobile" ? navigationBarMobileGap : screenPaddingX}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    {platform === "mobile" && <MobileBackButton />}
                    <TextShimmer
                        fontSize={platform === "mobile" ? "100" : "400"}
                        width={platform === "mobile" ? "16" : "24"}
                    />
                    {platform === "mobile" && <MobileBackButtonSpacer />}
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-start"
                    paddingX={screenPaddingX}
                    style={{height: searchAffinityEntityViewMinHeightPx[spacingScale] / 2}}
                >
                    <Box width="full" height="border" backgroundColor="grey-5" />
                </Box>
                <Box
                    style={{
                        paddingLeft: screenPaddingXWithoutSearchEntityViewPaddingX[platform],
                        paddingRight: screenPaddingXWithoutSearchEntityViewPaddingX[platform],
                    }}
                >
                    <SearchEntityShimmer titleWidth="20" marginX="0" />
                    <SearchEntityShimmer titleWidth="48" marginX="0" />
                    <SearchEntityShimmer titleWidth="32" marginX="0" />
                    <SearchEntityShimmer titleWidth="48" marginX="0" />
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    justifyContent="flex-end"
                    paddingX={screenPaddingX}
                    style={{height: searchAffinityEntityViewMinHeightPx[spacingScale] / 2}}
                >
                    <Box width="full" height="border" backgroundColor="grey-5" />
                </Box>
            </Box>
        </Box>
    );
}

function InboxRouteShimmer() {
    const platform = usePlatform();

    const emptySearchParams = useMemo(() => new URLSearchParams(), []);

    if (platform === "mobile") {
        return (
            <Box width="full">
                <Box height="safe-area-inset-top" />
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    paddingX={navigationBarMobileGap}
                >
                    <TextShimmer fontSize="100" width="16" />
                </Box>
                <InboxEntryShimmer
                    withBorderTop
                    paddingX={screenPaddingX}
                    marginX="0"
                    titleRagRight="0"
                    subtitleRagRight="8"
                />
                <InboxEntryShimmer
                    paddingX={screenPaddingX}
                    marginX="0"
                    titleRagRight="6"
                    subtitleRagRight="4"
                />
                <InboxEntryShimmer
                    paddingX={screenPaddingX}
                    marginX="0"
                    titleRagRight="4"
                    subtitleRagRight="6"
                />
                <InboxEntryShimmer
                    paddingX={screenPaddingX}
                    marginX="0"
                    titleRagRight="0"
                    subtitleRagRight="2"
                />
                <InboxEntryShimmer
                    paddingX={screenPaddingX}
                    marginX="0"
                    titleRagRight="6"
                    subtitleRagRight="4"
                />
            </Box>
        );
    } else {
        return (
            <Box width="full" height="full" display="flex" flexDirection="column">
                <Box flexGrow="1" display="flex" flexDirection="row">
                    <Box flexShrink="0" width="96" borderRight="grey-5">
                        <Box flexShrink="0" height={inboxBannerHeight} />
                        <Spacer space="1" />
                        <InboxEntryShimmer withBorderTop titleRagRight="0" subtitleRagRight="8" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                        <InboxEntryShimmer titleRagRight="4" subtitleRagRight="6" />
                        <InboxEntryShimmer titleRagRight="0" subtitleRagRight="2" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                    </Box>
                    <Box flexGrow="1" overflow="hidden">
                        <RouteShimmer
                            routeId="routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration"
                            searchParams={emptySearchParams}
                            withInboxBanner={true}
                        />
                    </Box>
                </Box>
            </Box>
        );
    }
}

function MoreRouteShimmer() {
    const platform = usePlatform();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <Box width="full" height="full">
            <Box
                width="full"
                maxWidth={maxWidth}
                paddingX={screenPaddingX}
                paddingTop="safe-area-inset"
                marginX="center"
            >
                <Box width="full" height={navigationBarHeight} />
                <Box display="flex" alignItems="stretch">
                    <Box
                        flexShrink="0"
                        width="1/2"
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        gap="2"
                        paddingX="2"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            flexShrink="0"
                            width="16"
                            height="16"
                            backgroundColor="grey-10"
                            borderRadius="1"
                        />
                        <TextShimmer fontSize="100" width="14" />
                        <Spacer space="0.5" />
                        <Spacer space="4" />
                    </Box>
                    <Box
                        borderLeft="grey-5"
                        flexShrink="0"
                        width="1/2"
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        gap="2"
                        paddingX="2"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            flexShrink="0"
                            width="16"
                            height="16"
                            backgroundColor="grey-10"
                            borderRadius="full"
                        />
                        <TextShimmer fontSize="100" width="24" />
                        <Spacer space="0.5" />
                        <Spacer space="4" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

function MoreSwitchSpaceRouteShimmer() {
    const platform = usePlatform();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <Box width="full" height="full">
            <Box width="full" maxWidth={maxWidth} paddingTop="safe-area-inset" marginX="center">
                <Box
                    width="full"
                    height={navigationBarHeight}
                    paddingX={navigationBarMobileGap}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <MobileBackButton />
                    <TextShimmer fontSize="300" width="24" />
                    <MobileBackButtonSpacer />
                </Box>
                <Box paddingX={screenPaddingX}>
                    <MoreSwitchSpaceSettingsRowShimmer ragRight="8" withBorderTop />
                    <MoreSwitchSpaceSettingsRowShimmer ragRight="0" />
                    <MoreSwitchSpaceSettingsRowShimmer ragRight="4" />
                </Box>
            </Box>
        </Box>
    );
}

function MoreSwitchSpaceSettingsRowShimmer({
    ragRight,
    withBorderTop,
}: {
    ragRight: Spacing;
    withBorderTop?: boolean;
}) {
    return (
        <Box
            paddingX="2.5"
            paddingY="1.5"
            display="flex"
            alignItems="center"
            gap="2"
            style={{
                boxShadow: [
                    `inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                    ...(withBorderTop ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`] : []),
                ].join(", "),
            }}
        >
            <Box paddingY="2">
                <Box
                    className={pulseAnimationClassName}
                    flexShrink="0"
                    width="8"
                    height="8"
                    backgroundColor="grey-10"
                    borderRadius="1"
                />
            </Box>
            <TextShimmer fontSize="300" width="32" ragRight={ragRight} />
        </Box>
    );
}

function ChannelPostsNotificationRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box height="safe-area-inset-top" />
            {platform === "mobile" && (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    paddingX={navigationBarMobileGap}
                >
                    <MobileBackButton />
                    <Box flexGrow="1" display="flex" justifyContent="center">
                        <TextShimmer fontSize="100" width="32" />
                    </Box>
                    <MobileBackButtonSpacer />
                </Box>
            )}
            <Box
                position="relative"
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
                marginX="center"
            >
                <PostShimmer />
                <PostShimmer />
                <PostShimmer withBottomBorder />
            </Box>
        </Box>
    );
}

function PostRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            <Box flexGrow="1" overflow="hidden">
                <Box height="safe-area-inset-top" />
                {platform === "mobile" ? (
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        alignItems="center"
                        paddingX={navigationBarMobileGap}
                    >
                        <MobileBackButton />
                        <Box flexGrow="1">
                            <PostShimmerHeader avatarSize="7" />
                        </Box>
                    </Box>
                ) : (
                    <Box
                        width="full"
                        height={navigationBarHeight}
                        maxWidth={contentStyles.contentMaxWidth}
                        marginX="center"
                    >
                        <Box height={navigationBarHeight} display="flex" alignItems="center">
                            <Box flexGrow="1">
                                <PostShimmerHeader avatarSize="8" />
                            </Box>
                        </Box>
                    </Box>
                )}
                <Box
                    position="relative"
                    flexShrink="0"
                    width="full"
                    maxWidth={contentStyles.contentMaxWidth}
                    marginX="center"
                    style={{paddingBottom: postContentViewOuterMarginBottom}}
                >
                    <Box
                        paddingX={screenPaddingX}
                        paddingBottom={postContentViewInnerMarginY}
                        style={{paddingTop: postViewContentPaddingTop}}
                    >
                        <ContentParagraphShimmer3 />
                    </Box>
                    <PostShimmerFooter />
                    <Box
                        position="absolute"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        bottom="0"
                        height="border"
                        backgroundColor="grey-5"
                    />
                </Box>
                <Spacer space={postContentViewCommentMargin} />
                <MessageShimmer width="32" heightLines={1} />
                <MessageShimmer width="64" heightLines={1} shouldMergeWithNextMessage={true} />
                <MessageShimmer width="96" heightLines={1} shouldMergeWithPreviousMessage={true} />
            </Box>
            <MessageInputShimmer />
            <Box flexShrink="0" height="safe-area-inset-bottom" />
        </Box>
    );
}

function ReactionsRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    const maxWidth = routeLayout !== "narrow" ? peekNarrowLayoutWidth : undefined;

    return (
        <Box width="full" height="full">
            <Box width="full" maxWidth={maxWidth} paddingTop="safe-area-inset" marginX="center">
                <Box
                    width="full"
                    height={navigationBarHeight}
                    paddingX={platform === "mobile" ? navigationBarMobileGap : screenPaddingX}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    {platform === "mobile" ? <MobileBackButton /> : <Box />}
                    <TextShimmer
                        fontSize={platform === "mobile" ? "100" : "400"}
                        width={platform === "mobile" ? "28" : "32"}
                    />
                    {platform === "mobile" ? <MobileBackButtonSpacer /> : <Box />}
                </Box>
                <Box
                    maxWidth={contentStyles.contentMaxWidth}
                    marginX="auto"
                    paddingX={screenPaddingX}
                    paddingBottom={navigationBarHeight}
                >
                    <ReactionsRouteReactionShimmer />
                    <ReactionsRouteReactionShimmer />
                    <ReactionsRouteReactionShimmer />
                </Box>
            </Box>
        </Box>
    );
}

function ReactionsRouteReactionShimmer() {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap="4"
            paddingY="3"
            style={{
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box flexGrow="1" display="flex" alignItems="center" gap="3">
                <Box
                    className={pulseAnimationClassName}
                    position="relative"
                    backgroundColor="grey-10"
                    width="8"
                    height="8"
                    borderRadius="full"
                />
                <TextShimmer fontSize="100" width="32" ragRight="random" />
            </Box>
            <Box
                flexShrink="0"
                width="8"
                height="8"
                display="flex"
                alignItems="center"
                justifyContent="center"
            >
                <Box
                    className={pulseAnimationClassName}
                    width="5"
                    height="5"
                    backgroundColor="grey-10"
                    borderRadius="1.5"
                />
            </Box>
        </Box>
    );
}

function NewPostRouteShimmer() {
    const platform = usePlatform();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box
                flexShrink="0"
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
                marginX="center"
            >
                <Box height="safe-area-inset-top" />
                {platform === "mobile" ? (
                    <>
                        <Box
                            height={navigationBarHeight}
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            paddingX={navigationBarMobileGap}
                        >
                            <MobileBackButton />
                            <TextShimmer fontSize="100" width="16" />
                            <MobileBackButtonSpacer />
                        </Box>
                        <PostShimmerHeader />
                    </>
                ) : (
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        <Box width="full">
                            <PostShimmerHeader />
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

function SearchRouteShimmer() {
    const platform = usePlatform();

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <Box width="full" maxWidth={maxWidth} marginX="center">
            <Box paddingX={screenPaddingX}>
                <Box height="safe-area-inset-top" />
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    paddingX={navigationBarMobileGap}
                >
                    <TextShimmer fontSize="100" width="16" />
                </Box>
                <Box height={searchMobileInputMarginTop} />
                <Box
                    border="grey-10"
                    style={{
                        height: searchMobileInputMinHeight,
                        borderRadius: searchMobileInputBorderRadius,
                    }}
                />
                <Box height={searchMobileInputMarginBottom} />
                <Box height={searchEntityHeaderPaddingTop} />
                <TextShimmer
                    fontSize={{
                        fontSize: fontSizes[searchEntityHeaderFontSize].fontSize,
                        lineHeight: spacing[searchEntityHeaderLineHeight],
                    }}
                    width="16"
                />
            </Box>
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="64" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="32" />
            <Box paddingX={screenPaddingX}>
                <Box height={searchEntityHeaderPaddingTop} />
                <TextShimmer
                    fontSize={{
                        fontSize: fontSizes[searchEntityHeaderFontSize].fontSize,
                        lineHeight: spacing[searchEntityHeaderLineHeight],
                    }}
                    width="16"
                />
            </Box>
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="48" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="96" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="64" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="48" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="96" />
            <SearchEntityShimmer paddingX={screenPaddingX} marginX="0" titleWidth="64" />
        </Box>
    );
}

// NOTE(calebmer): We intentionally don't include comments in the task detail route
// shimmer since if a user only has view access they won't be able to see the
// comments on the task. (This is a weak reason to not include comments in the
// shimmer.)
function TaskDetailRouteShimmer() {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const platformRouteLayout = getPlatformRouteLayout(platform, routeLayout);

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box
                paddingX={screenPaddingX}
                overflow="hidden"
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
                marginX="center"
                display="flex"
                flexDirection="column"
                position="relative"
            >
                <Box height="safe-area-inset-top" />
                <Box height={navigationBarHeight} display="flex" alignItems="center">
                    {platform === "mobile" && <MobileBackButton />}
                    {platform !== "mobile" && (
                        <Box
                            className={pulseAnimationClassName}
                            backgroundColor="grey-10"
                            width={taskDetailViewStatusButtonSize[platformRouteLayout]}
                            height={taskDetailViewStatusButtonSize[platformRouteLayout]}
                            borderRadius="full"
                        />
                    )}
                </Box>
                {platform === "mobile" && (
                    <Box
                        paddingTop={taskDetailViewStatusButtonMobilePaddingTop}
                        paddingBottom={taskDetailViewStatusButtonMobilePaddingBottom}
                    >
                        <Box
                            className={pulseAnimationClassName}
                            backgroundColor="grey-10"
                            width={taskDetailViewStatusButtonSize[platformRouteLayout]}
                            height={taskDetailViewStatusButtonSize[platformRouteLayout]}
                            borderRadius="full"
                        />
                    </Box>
                )}
                <TextShimmer
                    fontSize={{
                        fontSize: fontSizes[taskDetailViewTitleFontSize].fontSize,
                        lineHeight: spacing[taskDetailViewTitleLineHeight],
                    }}
                    width="64"
                />
                <Box style={{height: taskDetailViewHeaderMarginBottom}} />
                <Box display="flex" alignItems="center" gap={taskDetailViewDenseFieldGap}>
                    <TextShimmer fontSize={taskDetailViewFieldLabelFontSize} width="16" />
                    <TextShimmer fontSize="75" width="24" />
                </Box>
                <Box height={taskDetailViewDenseFieldGap} />
                <Box display="flex" alignItems="center" gap={taskDetailViewDenseFieldGap}>
                    <TextShimmer fontSize={taskDetailViewFieldLabelFontSize} width="16" />
                    <TextShimmer fontSize="75" width="48" />
                </Box>
                <Box height={taskDetailViewSectionGap} />
                <TextShimmer fontSize={taskDetailViewFieldLabelFontSize} width="12" />
                <Box height={taskDetailNotesFieldLabelPaddingBottom} />
                <Box
                    style={{
                        height: tasksStyles.detailNotesContentEditorMinHeightPx[spacingScale],
                    }}
                />
                <Box height={taskDetailViewSectionGap} />
                <TextShimmer fontSize={taskDetailViewFieldLabelFontSize} width="16" />
                <Box
                    className={pulseAnimationClassName}
                    height={taskDetailViewSubtasksFieldLabelPaddingBottom}
                />
                <Box
                    className={pulseAnimationClassName}
                    height={taskRowViewMinHeight}
                    borderTop="grey-5"
                />
                <Box
                    className={pulseAnimationClassName}
                    height={taskRowViewMinHeight}
                    borderTop="grey-5"
                />
                <Box
                    className={pulseAnimationClassName}
                    height={taskRowViewMinHeight}
                    borderTop="grey-5"
                />
                <Box className={pulseAnimationClassName} height="border" borderTop="grey-5" />
            </Box>
        </Box>
    );
}

function TaskGridRouteShimmer({
    titleWidth,
    titlePaddingLeft,
    customizationBar,
}: {
    titleWidth: Spacing;
    titlePaddingLeft?: Spacing;
    customizationBar?: ReactNode;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box height="safe-area-inset-top" />
            {platform === "mobile" ? (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    paddingX={navigationBarMobileGap}
                >
                    <MobileBackButton />
                    <TextShimmer fontSize="100" width="24" />
                    <MobileBackButtonSpacer />
                </Box>
            ) : (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    paddingLeft={titlePaddingLeft ?? screenPaddingX}
                    paddingRight={screenPaddingX}
                >
                    <TextShimmer fontSize="200" width={titleWidth} />
                </Box>
            )}
            <Box position="relative" paddingX={screenPaddingX}>
                {customizationBar}
                <Box position="absolute" bottom="0" left={screenPaddingX} right={screenPaddingX} />
            </Box>
            {routeLayout !== "narrow" && (
                <Box height={taskGridViewColumnHeaderHeight} paddingRight={screenPaddingX}>
                    <Box height={taskGridViewColumnHeaderHeight} display="flex" alignItems="center">
                        <Box
                            flexGrow="1"
                            style={{
                                paddingLeft: `${
                                    taskRowViewDragHandleWidthRem + taskRowViewExpandButtonWidthRem
                                }rem`,
                            }}
                        >
                            <TextShimmer fontSize="50" width="12" />
                        </Box>
                        <Box
                            flexShrink="0"
                            paddingX={taskRowViewColumnPaddingX}
                            style={{
                                width: taskRowViewFirstColumnWidth,
                                paddingLeft: taskRowViewFirstColumnPaddingLeft,
                            }}
                        >
                            <TextShimmer fontSize="50" width="12" />
                        </Box>
                        <Box
                            flexShrink="0"
                            paddingX={taskRowViewColumnPaddingX}
                            style={{width: taskRowViewColumnWidth}}
                        >
                            <TextShimmer fontSize="50" width="12" />
                        </Box>
                        <Box
                            flexShrink="0"
                            paddingX={taskRowViewColumnPaddingX}
                            style={{width: taskRowViewColumnWidth}}
                        >
                            <TextShimmer fontSize="50" width="12" />
                        </Box>
                        <Box
                            flexShrink="0"
                            paddingLeft={taskRowViewColumnPaddingX}
                            paddingRight={taskRowViewLastColumnPaddingRight}
                            style={{width: taskRowViewCollectionsColumnWidth}}
                        >
                            <TextShimmer fontSize="50" width="12" />
                        </Box>
                    </Box>
                </Box>
            )}
            <TaskRowShimmer width="128" ragRight="2" />
            <TaskRowShimmer width="64" ragRight="6" />
            <TaskRowShimmer width="96" ragRight="4" />
            <TaskRowShimmer width="128" ragRight="12" />
            <TaskRowShimmer width="64" ragRight="10" />
            <TaskRowShimmer width="160" />
            <TaskRowShimmer width="96" ragRight="8" />
            {routeLayout !== "narrow" && (
                <>
                    <TaskRowShimmer width="128" ragRight="2" />
                    <TaskRowShimmer width="64" ragRight="6" />
                    <TaskRowShimmer width="96" ragRight="4" />
                    <TaskRowShimmer width="128" ragRight="12" />
                    <TaskRowShimmer width="64" ragRight="10" />
                    <TaskRowShimmer width="160" />
                    <TaskRowShimmer width="96" ragRight="8" />
                </>
            )}
            <TaskGridRouteTrailingRowLinesShimmer />
        </Box>
    );
}

const taskGridRouteTrailingRowLinesBackgroundImage = `repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(${spacing[taskRowViewMinHeight]} - 1px),
    ${colorSchemeVars["grey-5"]} calc(${spacing[taskRowViewMinHeight]} - 1px),
    ${colorSchemeVars["grey-5"]} ${spacing[taskRowViewMinHeight]}
)`;

function TaskGridRouteTrailingRowLinesShimmer() {
    const platform = usePlatform();

    return (
        <Box
            position="relative"
            width="full"
            marginX="center"
            height={taskGridViewPaddingBottomWithoutNext}
            style={{
                height:
                    platform === "mobile"
                        ? `calc(var(--safe-area-inset-bottom, 0px) + ${spacing[taskGridViewPaddingBottomWithoutNext]})`
                        : undefined,
                contain: "layout",
            }}
        >
            <Box
                position="absolute"
                left={screenPaddingX}
                right={screenPaddingX}
                style={{
                    top: 1,
                    height: "100vh",
                    backgroundImage: taskGridRouteTrailingRowLinesBackgroundImage,
                }}
            />
        </Box>
    );
}

function TaskPersonalRouteShimmer() {
    const routeLayout = useRouteLayout();

    return (
        <TaskGridRouteShimmer
            titleWidth="20"
            titlePaddingLeft={routeLayout !== "narrow" ? "10" : undefined}
        />
    );
}

function TaskCollectionRouteShimmer() {
    return <TaskGridRouteShimmer titleWidth="48" />;
}

function TaskQueryRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <TaskGridRouteShimmer
            titleWidth="48"
            titlePaddingLeft={routeLayout !== "narrow" ? "10" : undefined}
            customizationBar={
                routeLayout === "narrow" &&
                (platform === "mobile" ? (
                    <Box paddingBottom={taskQueryViewCustomizationMobileSectionMarginBottom}>
                        <Box
                            width="full"
                            height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                            marginBottom={taskQueryViewCustomizationMobileSectionHeaderMarginBottom}
                            display="flex"
                            alignItems="center"
                        >
                            <TextShimmer
                                fontSize={taskQueryViewCustomizationMobileSectionHeaderFontSize}
                                width="14"
                            />
                        </Box>
                        <Box
                            width="full"
                            height={taskQueryViewCustomizationMobileSectionOptionHeight}
                            border="grey-5"
                            borderRadius="1"
                        />
                        <Box height={taskQueryViewCustomizationMobileSectionGap} />
                        <Box
                            width="full"
                            height={taskQueryViewCustomizationMobileSectionHeaderHeight}
                            marginBottom={taskQueryViewCustomizationMobileSectionHeaderMarginBottom}
                            display="flex"
                            alignItems="center"
                        >
                            <TextShimmer
                                fontSize={taskQueryViewCustomizationMobileSectionHeaderFontSize}
                                width="14"
                            />
                        </Box>
                        <Box
                            width="full"
                            height={taskQueryViewCustomizationMobileSectionOptionHeight}
                            border="grey-5"
                            borderRadius="1"
                        />
                    </Box>
                ) : (
                    <Box
                        paddingTop={taskQueryViewCustomizationMobileLayoutMarginTop}
                        paddingBottom={taskQueryViewCustomizationMobileSectionMarginBottom}
                    >
                        <Box
                            height="6"
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                        >
                            <TextShimmer fontSize="100" width="64" />
                            <TextShimmer fontSize="100" width="16" />
                        </Box>
                    </Box>
                ))
            }
        />
    );
}
