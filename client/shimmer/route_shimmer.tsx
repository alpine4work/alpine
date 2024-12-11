import {ArrowLeft, Check, SpinnerGap} from "phosphor-react";
import {ComponentType, ReactNode, memo} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {
    ContentParagraphShimmer1,
    ContentParagraphShimmer2,
    ContentParagraphShimmer3,
} from "~/client/shimmer/content_shimmer.js";
import {InboxEntryShimmer} from "~/client/shimmer/inbox_entry_shimmer.js";
import {MessageShimmer} from "~/client/shimmer/message_shimmer.js";
import {PostShimmer, PostShimmerHeader} from "~/client/shimmer/post_shimmer.js";
import {SearchResultShimmer} from "~/client/shimmer/search_result_shimmer.js";
import {TaskRowShimmer} from "~/client/shimmer/task_row_shimmer.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/shimmer/use_coordinated_shimmer_animations.js";
import {chatViewTopBarWithInboxBannerAdjustmentY} from "~/client/styles/chat_shared_styles.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadListViewMaxWidth,
    documentCommentThreadPreviewHeight,
} from "~/client/styles/document_shared_styles.js";
import {
    channelFilesViewFileMaxSize,
    channelFilesViewFileMinSize,
    channelFilesViewFileRowFileCount,
    channelFilesViewMaxWidth,
    channelViewAsideFileGap,
    channelViewAsideFileHeight,
    channelViewAsidePostFileColumnCount,
    channelViewAsidePostFileCount,
    channelViewAsidePostFileRowCount,
    channelViewAsideSectionGap,
    channelViewHeaderNarrowRouteLayoutMarginTop,
    channelViewHeaderSectionGap,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
    postContentViewOuterMarginY,
    postFauxInputCreateButtonHeight,
    postFauxInputCreateButtonMarginTop,
    postListViewAsideFlex,
    postListViewAsideMaxWidth,
    postViewFlex,
    postViewNavigationBarSpace,
} from "~/client/styles/forum_shared_styles.js";
import {inboxBannerHeight} from "~/client/styles/inbox_shared_styles.js";
import {
    messageInput2MinHeightPx,
    messageInputEditor2BorderRadiusPx,
    messageInputEditor2MinHeightPx,
    messageInputEditor3IconButtonNegativeMargin,
    messageInputPaddingY,
    messageView2AccountAvatarSize,
    messageView2RailGap,
    messageViewMarginY,
    messageViewMaxWidth,
} from "~/client/styles/messaging_shared_styles.js";
import {
    minSearchMobileInputHeight,
    searchMobileInputBorderRadius,
    searchMobileInputMarginBottom,
    searchMobileInputMarginTop,
} from "~/client/styles/search_shared_styles.js";
import {
    Sprinkles,
    colorSchemeVars,
    contentStyles,
    fontSizes,
    pulseAnimationClassName,
    spinAnimationClassName,
    tasksStyles,
} from "~/client/styles/styles.js";
import {
    taskCardViewMaxWidth,
    taskCommentsHeaderNavigationBarSpacing,
    taskDetailNotesFieldLabelPaddingBottom,
    taskDetailViewCommentSidebarWidth,
    taskDetailViewDenseFieldGap,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewSectionGap,
    taskDetailViewStatusButtonMobilePaddingBottom,
    taskDetailViewStatusButtonMobilePaddingTop,
    taskDetailViewStatusButtonSize,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
    taskDetailViewTitleFontSize,
    taskGridViewColumnHeaderExtraPaddingBottomPx,
    taskGridViewColumnHeaderHeight,
    taskNotepadViewActiveSectionActualMarginBottom,
    taskNotepadViewActiveSectionCardGap,
    taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
    taskNotepadViewActiveSectionMarginTop,
    taskNotepadViewActiveSectionPaddingY,
    taskNotepadViewActiveSectionTitleFontSize,
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
} from "~/client/styles/tasks_shared_styles.js";
import {
    Spacing,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * Shimmer component for each space route. The test
 * `app/tests/space_routes.test.ts` makes sure we have a shimmer definition for
 * each space route.
 *
 * If a shimmer definition is `false` that means we show a generic fullscreen
 * loading spinner instead of a custom shimmer.
 */
const shimmerOptionsByRouteId: {
    readonly [key: string]:
        | {
              inboxBannerMaxWidth?: Spacing | "full";
              component: ComponentType<{
                  withInboxBanner: boolean;
                  // Avoid TypeScript error "object has no properties in common" error.
                  withBackButton?: undefined;
                  titleWidth?: undefined;
              }>;
          }
        | false;
} = {
    "routes/s.$spaceId.channels.$channelId._index": {component: ChannelRouteShimmer},
    "routes/s.$spaceId.channels.$channelId.files": {component: ChannelFilesRouteShimmer},
    "routes/s.$spaceId.chat.$chatId": {
        inboxBannerMaxWidth: messageViewMaxWidth,
        component: ChatRouteShimmer,
    },
    "routes/s.$spaceId.chat.new": {component: NewChatRouteShimmer},
    "routes/s.$spaceId.chat.with.$accountId": {component: ChatRouteShimmer},
    "routes/s.$spaceId.create._index": {component: CreateRouteShimmer},
    "routes/s.$spaceId.create.more": {component: CreateMoreRouteShimmer},
    "routes/s.$spaceId.documents.$documentId._index": {component: DocumentRouteShimmer},
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId": {
        inboxBannerMaxWidth: documentCommentThreadListViewMaxWidth,
        component: DocumentCommentThreadRouteShimmer,
    },
    "routes/s.$spaceId.documents.$documentId.view": {component: DocumentRouteShimmer},
    "routes/s.$spaceId.inbox": {component: InboxRouteShimmer},
    "routes/s.$spaceId.more._index": {component: MoreRouteShimmer},
    "routes/s.$spaceId.more.switch-space": {component: MoreSwitchSpaceRouteShimmer},
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: ChannelPostsNotificationRouteShimmer,
    },
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration": {
        inboxBannerMaxWidth: documentCommentThreadListViewMaxWidth,
        component: DocumentCommentThreadRouteShimmer,
    },
    "routes/s.$spaceId.posts.$postId": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: PostRouteShimmer,
    },
    "routes/s.$spaceId.posts.new.$draftId": {component: NewPostRouteShimmer},
    "routes/s.$spaceId.search": {component: SearchRouteShimmer},
    // TODO: `inboxBannerMaxWidth` for this route.
    "routes/s.$spaceId.tasks.$taskId._index": {component: TaskDetailRouteShimmer},
    "routes/s.$spaceId.tasks.$taskId.comments": {
        inboxBannerMaxWidth: contentStyles.contentMaxWidth,
        component: TaskCommentsRouteShimmer,
    },
    "routes/s.$spaceId.tasks._index": {component: TaskNotepadRouteShimmer},
    "routes/s.$spaceId.tasks.collections.$collectionId": {component: TaskGridRouteShimmer},
    "routes/s.$spaceId.tasks.view": {component: TaskQueryRouteShimmer},

    // TODO(calebmer): We don't currently have a design for these routes. Once we
    // implement these routes we should add appropriate shimmers.
    "routes/s.$spaceId._index": false,
};

// If we're not running in Jest then export null. This way we export a constant
// in development that won't break hot module reloading.
//
// eslint-disable-next-line react-refresh/only-export-components
export const getRouteIdsWithDefinedShimmerForTest = import.meta.jest
    ? () => Object.keys(shimmerOptionsByRouteId)
    : null;

const RouteShimmerMemo = memo(RouteShimmer);
export {RouteShimmerMemo as RouteShimmer};

function RouteShimmer({
    routeId,
    withInboxBanner,
}: {
    routeId: string | null;
    withInboxBanner: boolean;
}) {
    const routeLayout = useRouteLayout();

    const shimmerOptions = routeId
        ? shimmerOptionsByRouteId[routeId.replace(".peek.", ".")]
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
                <shimmerOptions.component withInboxBanner={withInboxBanner} />
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
                                    // Render a non-interactive button to get the exact right size for the
                                    // button shimmer.
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
                    <shimmerOptions.component withInboxBanner={withInboxBanner} />
                </Box>
            </Box>
        );
    }
}

function MobileBackButton() {
    const navigate = useNavigate();

    return (
        <IconButton
            size="base"
            description="Go back"
            withoutTooltip={true}
            pressErrorTitle="Couldn’t go back"
            onPress={() => navigate(-1)}
        >
            <ArrowLeft />
        </IconButton>
    );
}

function MobileBackButtonSpacer() {
    return <Spacer space="7" />;
}

function ChannelRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <Box width="full" display="flex" justifyContent="center">
            <Box width="full" maxWidth={contentStyles.contentMaxWidth} style={{flex: postViewFlex}}>
                <Box paddingX={screenPaddingX}>
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
                            <Box>
                                <Box marginBottom={channelViewMetadataSectionTitleMarginBottom}>
                                    <TextShimmer
                                        width="16"
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
                                    <ChannelRouteContributorsAccountAvatarShimmer
                                        zIndex="40"
                                        isFirst
                                    />
                                    <ChannelRouteContributorsAccountAvatarShimmer zIndex="30" />
                                    <ChannelRouteContributorsAccountAvatarShimmer zIndex="20" />
                                    <ChannelRouteContributorsAccountAvatarShimmer zIndex="10" />
                                </Box>
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
                            height="7"
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
                    <Box height={postContentViewOuterMarginY} borderBottom="grey-5" />
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
                        paddingX={screenPaddingX}
                        paddingBottom={screenPaddingX}
                        display="flex"
                        flexDirection="column"
                        gap={channelViewAsideSectionGap}
                    >
                        <Box>
                            <Box marginBottom={channelViewMetadataSectionTitleMarginBottom}>
                                <TextShimmer
                                    width="16"
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
                            <Box marginBottom={channelViewMetadataSectionTitleMarginBottom}>
                                <TextShimmer
                                    width="8"
                                    fontSize={channelViewMetadataSectionTitleFontSize}
                                    color="grey-5"
                                />
                            </Box>
                            <Box
                                gap={channelViewAsideFileGap}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${channelViewAsidePostFileColumnCount}, 1fr)`,
                                    gridTemplateRows: `repeat(${channelViewAsidePostFileRowCount}, ${channelViewAsideFileHeight})`,
                                }}
                            >
                                {createArrayWithLength(channelViewAsidePostFileCount, index => {
                                    return <Box key={index} border="grey-5" borderRadius="1" />;
                                })}
                            </Box>
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
                        maxWidth={messageViewMaxWidth}
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
                        borderRadius="1"
                        style={{width: fileSizePx, height: fileSizePx}}
                    />
                ))}
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
                        gap={platform !== "mobile" ? messageView2RailGap : "1"}
                        width="full"
                        maxWidth={messageViewMaxWidth}
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
                            width={messageView2AccountAvatarSize}
                            height={messageView2AccountAvatarSize}
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
            <Box flexShrink="0" paddingTop="safe-area-inset">
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
                        maxWidth={messageViewMaxWidth}
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
                    <Box display="flex" justifyContent="center" paddingBottom={messageViewMarginY}>
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
            style={{height: messageInput2MinHeightPx[platform][spacingScale]}}
        >
            <Box
                width="full"
                maxWidth={messageViewMaxWidth}
                height="full"
                marginX="center"
                paddingX={screenPaddingX}
                paddingY={messageInputPaddingY}
            >
                <Box
                    position="relative"
                    width="full"
                    height="full"
                    marginX={messageInputEditor3IconButtonNegativeMargin}
                >
                    <Box
                        width="full"
                        height="full"
                        border="grey-10"
                        style={{
                            height: messageInputEditor2MinHeightPx[platform][spacingScale],
                            borderRadius: messageInputEditor2BorderRadiusPx[platform][spacingScale],
                        }}
                    />
                    <Box
                        position="absolute"
                        top="0"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            width: messageInputEditor2MinHeightPx[platform][spacingScale],
                            height: messageInputEditor2MinHeightPx[platform][spacingScale],
                        }}
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width={messageView2AccountAvatarSize}
                            height={messageView2AccountAvatarSize}
                            backgroundColor="grey-10"
                            borderRadius="full"
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

// Not much going on for the create route shimmer. We expect create routes to
// load very fast given they don't have any data they need to load from the
// server. Create route shimmers mostly exist for completeness and to make sure
// a route like `/create/more` has a back button in its shimmer.
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

function CreateMoreRouteShimmer() {
    return <CreateRouteShimmer withBackButton />;
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
                <Box width="full" maxWidth={documentCommentThreadListViewMaxWidth} marginX="center">
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
                    <Box height={messageViewMarginY} />
                    <Box style={{height: fontSizes["50"].lineHeight}} />
                    <Box height={messageViewMarginY} />
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

function InboxRouteShimmer() {
    const platform = usePlatform();

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
                    <Box flexShrink="0" width="96" borderRight="grey-10" paddingY="1">
                        <Box flexShrink="0" height="12" />
                        <InboxEntryShimmer titleRagRight="0" subtitleRagRight="8" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                        <InboxEntryShimmer titleRagRight="4" subtitleRagRight="6" />
                        <InboxEntryShimmer titleRagRight="0" subtitleRagRight="2" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                    </Box>
                    <Box flexGrow="1" overflow="hidden">
                        <RouteShimmer
                            routeId="routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration"
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
                    <TextShimmer fontSize="100" width="24" />
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
            gap="2.5"
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
            <TextShimmer fontSize="100" width="32" ragRight={ragRight} />
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
                {platform === "mobile" && (
                    <Box
                        position="absolute"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        borderBottom="grey-5"
                        style={{top: -1}}
                    />
                )}
                <PostShimmer />
                <PostShimmer />
                <PostShimmer />
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
                    <Box style={{height: postViewNavigationBarSpace[platform]}}>
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
                    </Box>
                ) : (
                    <Box
                        width="full"
                        maxWidth={contentStyles.contentMaxWidth}
                        marginX="center"
                        style={{height: postViewNavigationBarSpace[platform]}}
                    >
                        <Box height={navigationBarHeight} display="flex" alignItems="center">
                            <Box flexGrow="1">
                                <PostShimmerHeader avatarSize="8" />
                            </Box>
                        </Box>
                    </Box>
                )}
                <Box
                    flexShrink="0"
                    width="full"
                    maxWidth={contentStyles.contentMaxWidth}
                    marginX="center"
                >
                    <PostShimmer withoutHeader={true}>
                        <ContentParagraphShimmer3 />
                    </PostShimmer>
                </Box>
                <Box style={{height: spacing[messageViewMarginY]}} />
                <MessageShimmer width="32" heightLines={1} />
                <MessageShimmer width="64" heightLines={1} shouldMergeWithNextMessage={true} />
                <MessageShimmer width="96" heightLines={1} shouldMergeWithPreviousMessage={true} />
            </Box>
            <MessageInputShimmer />
            <Box flexShrink="0" height="safe-area-inset-bottom" />
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
                        height: minSearchMobileInputHeight,
                        borderRadius: searchMobileInputBorderRadius,
                    }}
                />
                <Box height={searchMobileInputMarginBottom} />
                <Box height="1" />
            </Box>
            <SearchResultShimmer
                withBorderTop
                paddingX={screenPaddingX}
                marginX="0"
                titleWidth="64"
            />
            <SearchResultShimmer
                paddingX={screenPaddingX}
                marginX="0"
                titleWidth="32"
                bodySnippetRagRight="6"
            />
            <SearchResultShimmer
                paddingX={screenPaddingX}
                marginX="0"
                titleWidth="48"
                bodySnippetRagRight="4"
            />
            <SearchResultShimmer paddingX={screenPaddingX} marginX="0" titleWidth="96" />
            <SearchResultShimmer
                paddingX={screenPaddingX}
                marginX="0"
                titleWidth="64"
                bodySnippetRagRight="5"
            />
        </Box>
    );
}

function TaskDetailRouteShimmer() {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const platformRouteLayout = getPlatformRouteLayout(platform, routeLayout);

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box
                width="full"
                height="full"
                marginX="center"
                display="flex"
                justifyContent="center"
                flexDirection="row"
            >
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
                    <TextShimmer fontSize={taskDetailViewTitleFontSize} width="64" />
                    <Box height={taskDetailViewSectionGap} />
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
                            height: tasksStyles.detailNotesContentEditorMinHeight[spacingScale],
                        }}
                    />
                    <Box height={taskDetailViewSectionGap} />
                    <TextShimmer fontSize={taskDetailViewFieldLabelFontSize} width="16" />
                    <Box
                        className={pulseAnimationClassName}
                        height={taskDetailViewSubtasksFieldLabelPaddingBottom}
                        borderBottom="grey-5"
                    />
                    <Box
                        className={pulseAnimationClassName}
                        height={taskRowViewMinHeight}
                        borderBottom="grey-5"
                    />
                    <Box
                        className={pulseAnimationClassName}
                        height={taskRowViewMinHeight}
                        borderBottom="grey-5"
                    />
                    <Box
                        className={pulseAnimationClassName}
                        height={taskRowViewMinHeight}
                        borderBottom="grey-5"
                    />
                </Box>
                {routeLayout !== "narrow" && (
                    <Box
                        flexShrink="0"
                        width={taskDetailViewCommentSidebarWidth}
                        borderLeft="grey-10"
                        overflow="hidden"
                    >
                        <TaskCommentsViewShimmer />
                    </Box>
                )}
            </Box>
        </Box>
    );
}

function TaskCommentsRouteShimmer() {
    return <TaskCommentsViewShimmer withNavigationBar={true} />;
}

export function TaskCommentsViewShimmer({withNavigationBar}: {withNavigationBar?: boolean}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            {withNavigationBar && (
                <Box flexShrink="0" paddingTop="safe-area-inset">
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
                            maxWidth={messageViewMaxWidth}
                            height="full"
                            paddingX={screenPaddingX}
                        >
                            <TextShimmer fontSize="200" width="32" />
                            <TextShimmer fontSize="75" width="12" />
                        </Box>
                    </Box>
                </Box>
            )}
            <Spacer space={taskCommentsHeaderNavigationBarSpacing} />
            <MessagingViewShimmer withTopAlignedMessages={true} messages="few" />
        </Box>
    );
}

function TaskGridRouteShimmer({
    titleWidth,
    notepadActiveSection,
    customizationBar,
}: {
    titleWidth?: Spacing;
    notepadActiveSection?: ReactNode;
    customizationBar?: ReactNode;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box height="safe-area-inset-top" />
            {notepadActiveSection && platform === "mobile" && (
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
            )}
            {notepadActiveSection}
            {!notepadActiveSection || platform !== "mobile" ? (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent={
                        !notepadActiveSection && platform === "mobile" ? "space-between" : undefined
                    }
                    alignItems="center"
                    paddingX={
                        !notepadActiveSection && platform === "mobile"
                            ? navigationBarMobileGap
                            : screenPaddingX
                    }
                >
                    {!notepadActiveSection && platform === "mobile" && <MobileBackButton />}
                    <TextShimmer
                        fontSize="200"
                        width={titleWidth ?? (platform === "mobile" ? "24" : "48")}
                    />
                    {!notepadActiveSection && platform === "mobile" && <MobileBackButtonSpacer />}
                </Box>
            ) : (
                <Box paddingY="2">
                    <Box height="7" />
                </Box>
            )}
            <Box position="relative" paddingX={screenPaddingX}>
                {customizationBar}
                {routeLayout === "narrow" && notepadActiveSection && platform !== "mobile" && (
                    <Box style={{height: taskGridViewColumnHeaderExtraPaddingBottomPx}} />
                )}
                <Box
                    position="absolute"
                    bottom="0"
                    left={screenPaddingX}
                    right={screenPaddingX}
                    borderBottom={routeLayout === "narrow" ? "grey-5" : undefined}
                />
            </Box>
            {routeLayout !== "narrow" && (
                <Box
                    paddingRight={screenPaddingX}
                    borderBottom="grey-5"
                    style={{
                        height: `calc(${spacing[taskGridViewColumnHeaderHeight]} + ${taskGridViewColumnHeaderExtraPaddingBottomPx}px)`,
                    }}
                >
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
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="128" ragRight="2" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="64" ragRight="6" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="96" ragRight="4" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="128" ragRight="12" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="64" ragRight="10" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="160" />
            <TaskRowShimmer hasColumns={routeLayout !== "narrow"} width="96" ragRight="8" />
            {routeLayout !== "narrow" && (
                <>
                    <TaskRowShimmer hasColumns={true} width="128" ragRight="2" />
                    <TaskRowShimmer hasColumns={true} width="64" ragRight="6" />
                    <TaskRowShimmer hasColumns={true} width="96" ragRight="4" />
                    <TaskRowShimmer hasColumns={true} width="128" ragRight="12" />
                    <TaskRowShimmer hasColumns={true} width="64" ragRight="10" />
                    <TaskRowShimmer hasColumns={true} width="160" />
                    <TaskRowShimmer hasColumns={true} width="96" ragRight="8" />
                </>
            )}
        </Box>
    );
}

function TaskQueryRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    return (
        <TaskGridRouteShimmer
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

function TaskNotepadRouteShimmer() {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();

    // Fake the spacing for 3 cards.
    const cardCount = 3;

    // There's less horizontal space on mobile for cards than in peeks on desktop.
    const cardCountAboveTheFold = platform === "mobile" ? 1 : routeLayout === "narrow" ? 2 : 3;

    const cardWidthStyle = `calc(${(1 / cardCountAboveTheFold) * 100}% - ${
        parseRemLength(taskNotepadViewActiveSectionCardGap) *
            ((cardCountAboveTheFold - 1) / cardCountAboveTheFold) +
        (Math.max(cardCount, cardCountAboveTheFold) > cardCountAboveTheFold
            ? parseRemLength(cardCountAboveTheFold <= 1 ? "16" : "4")
            : 0)
    }rem)`;

    return (
        <TaskGridRouteShimmer
            titleWidth="20"
            notepadActiveSection={
                <>
                    <Box height={taskNotepadViewActiveSectionMarginTop} />
                    <Box paddingX={screenPaddingX}>
                        <TextShimmer
                            fontSize={taskNotepadViewActiveSectionTitleFontSize[platform]}
                            width="20"
                        />
                    </Box>
                    <Box
                        overflow="hidden"
                        display="flex"
                        gap={taskNotepadViewActiveSectionCardGap}
                        paddingX={screenPaddingX}
                        paddingY={taskNotepadViewActiveSectionPaddingY}
                    >
                        <Box
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            border="grey-5"
                            borderRadius="2"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                        <Box
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            border="grey-5"
                            borderRadius="2"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                        <Box
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            border="grey-5"
                            borderRadius="2"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                    </Box>
                    <Box
                        style={{height: taskNotepadViewActiveSectionActualMarginBottom[platform]}}
                    />
                    <Box height="safe-area-inset-top" />
                </>
            }
        />
    );
}
