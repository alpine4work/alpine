import {ArrowLeft, Check, SpinnerGap} from "phosphor-react";
import {ComponentType, ReactNode, memo} from "react";
import {useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {mobileNavigationBarGap, navigationBarHeight} from "~/client/design/navigation_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
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
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/shimmer/use_coordinated_shimmer_animations.js";
import {
    RemLength,
    Spacing,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadListViewMaxWidth,
    documentCommentThreadPreviewHeight,
} from "~/shared/styles/document_shared_styles.js";
import {
    channelViewAsidePaddingY,
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput,
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar,
    postContentViewOuterMarginY,
    postFauxInputCreateButtonHeight,
    postViewMaxWidth,
} from "~/shared/styles/forum_shared_styles.js";
import {inboxBannerHeight} from "~/shared/styles/inbox_shared_styles.js";
import {
    messageInputAccountAvatarSize,
    messageInputMinHeight,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewTimestampDividerMarginBottom,
    messageViewTimestampDividerMarginTop,
} from "~/shared/styles/messaging_shared_styles.js";
import {
    minSearchMobileInputHeight,
    searchMobileInputBorderRadius,
    searchMobileInputMarginBottom,
    searchMobileInputMarginTop,
} from "~/shared/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    fontSizes,
    pulseAnimationClassName,
    spinAnimationClassName,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {
    desktopTaskDetailViewNavigationBarSpacerMarginBottom,
    desktopTaskDetailViewStatusButtonSize,
    desktopTaskNotepadViewActiveSectionMarginBottom,
    mobileTaskDetailViewStatusButtonPaddingBottom,
    mobileTaskDetailViewStatusButtonPaddingTop,
    mobileTaskDetailViewStatusButtonSize,
    mobileTaskNotepadViewActiveSectionMarginBottom,
    taskCardViewMaxWidth,
    taskDetailNotesFieldLabelPaddingBottom,
    taskDetailViewDenseFieldGap,
    taskDetailViewFieldLabelFontSize,
    taskDetailViewMaxWidth,
    taskDetailViewSectionGap,
    taskDetailViewSubtasksFieldLabelPaddingBottom,
    taskDetailViewTitleFontSize,
    taskGridViewColumnHeaderExtraPaddingBottomPx,
    taskGridViewColumnHeaderHeight,
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
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewLastColumnPaddingRight,
    taskRowViewMinHeight,
} from "~/shared/styles/tasks_shared_styles.js";

/**
 * Shimmer component for each space route. The test
 * `app/tests/space_routes_have_shimmers.test.ts` makes sure we have a shimmer
 * definition for each space route.
 *
 * If a shimmer definition is `false` that means we show a generic fullscreen
 * loading spinner instead of a custom shimmer.
 */
const shimmerComponentByRouteId: {
    readonly [key: string]: ComponentType<{withMobileLayout: boolean}> | false;
} = {
    "routes/s.$spaceId.channels.$channelId": ChannelRouteShimmer,
    "routes/s.$spaceId.chat.$chatId": ChatRouteShimmer,
    "routes/s.$spaceId.chat.new": NewChatRouteShimmer,
    "routes/s.$spaceId.chat.with.$accountId": ChatRouteShimmer,
    "routes/s.$spaceId.documents.$documentId._index": DocumentRouteShimmer,
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId":
        DocumentCommentThreadRouteShimmer,
    "routes/s.$spaceId.documents.$documentId.view": DocumentRouteShimmer,
    "routes/s.$spaceId.inbox": InboxRouteShimmer,
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration":
        ChannelPostsNotificationRouteShimmer,
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration":
        DocumentCommentThreadRouteShimmer,
    "routes/s.$spaceId.posts.$postId": PostRouteShimmer,
    "routes/s.$spaceId.posts.new.$draftId": NewPostRouteShimmer,
    "routes/s.$spaceId.search": SearchRouteShimmer,
    "routes/s.$spaceId.tasks.$taskId": TaskDetailRouteShimmer,
    "routes/s.$spaceId.tasks._index": TaskNotepadRouteShimmer,
    "routes/s.$spaceId.tasks.collections.$collectionId": TaskGridRouteShimmer,
    "routes/s.$spaceId.tasks.view": TaskQueryRouteShimmer,

    // The create routes are simple lists that should be almost instant to load
    // since they don't have server loaders.
    "routes/s.$spaceId.create._index": false,
    "routes/s.$spaceId.create.more": false,

    // TODO(calebmer): We don't currently have a design for these routes. Once we
    // implement these routes we should add appropriate shimmers.
    "routes/s.$spaceId._index": false,
    "routes/s.$spaceId.more._index": false,
};

export function getRouteIdsWithDefinedShimmerForTest() {
    assert(import.meta.jest);
    return Object.keys(shimmerComponentByRouteId);
}

const RouteShimmerMemo = memo(RouteShimmer);
export {RouteShimmerMemo as RouteShimmer};

function RouteShimmer({
    routeId,
    withMobileLayout,
}: {
    routeId: string | null;
    withMobileLayout: boolean;
}) {
    const [searchParams] = useSearchParams();

    const ShimmerComponent = routeId
        ? shimmerComponentByRouteId[routeId.replace(".peek.", ".")]
        : undefined;

    const containerRef = useCoordinatedShimmerAnimations({isDisabled: !ShimmerComponent});

    if (!ShimmerComponent) {
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
                    size={spacing[withMobileLayout ? "6" : "8"]}
                />
            </Box>
        );
    }

    const shouldShowInboxBanner = searchParams.get("inbox") === "show";

    if (!shouldShowInboxBanner) {
        return (
            <Box ref={containerRef} width="full" height="full" overflow="hidden">
                <ShimmerComponent withMobileLayout={withMobileLayout} />
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
                        // We use a box shadow to draw the border so it occupies the same space as a
                        // `useNavigationBar()` border when scrolled all the way up. That way we don't
                        // render double borders.
                        boxShadow: `0 1px 0 0 ${
                            colorSchemeVars[
                                ShimmerComponent === ChatRouteShimmer ? "grey-5" : "grey-10"
                            ]
                        }`,
                    }}
                >
                    <Box
                        display="flex"
                        alignItems="center"
                        height={inboxBannerHeight}
                        paddingLeft="3"
                        paddingRight="1.5"
                    >
                        <TextShimmer fontSize="50" width="16" />
                        <Box flexGrow="1" />
                        <Box
                            flexShrink="0"
                            className={pulseAnimationClassName}
                            height="6"
                            borderRadius="base"
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
                    <ShimmerComponent withMobileLayout={withMobileLayout} />
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
    const isMobile = useIsMobile();

    return (
        <Box width="full" maxWidth={postViewMaxWidth} marginX="center">
            <Box paddingX={screenPaddingX}>
                <Box height="safe-area-inset-top" />
                <Box
                    display="flex"
                    justifyContent={isMobile ? "space-between" : undefined}
                    alignItems="center"
                    height={navigationBarHeight}
                >
                    {isMobile && <MobileBackButton />}
                    <TextShimmer
                        width={isMobile ? "24" : "32"}
                        fontSize={isMobile ? "100" : "400"}
                    />
                    {isMobile && <MobileBackButtonSpacer />}
                </Box>
                <Box height={channelViewAsidePaddingY} />
                <Box
                    className={pulseAnimationClassName}
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                    width="full"
                    height={postFauxInputCreateButtonHeight}
                    padding="2.5"
                    boxShadow="elevation-5-with-grey-10-border"
                    borderRadius="md"
                >
                    <Box
                        paddingX="2"
                        height="7"
                        minWidth="16"
                        backgroundColor="grey-10"
                        borderRadius="base"
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
    );
}

function ChatRouteShimmer() {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" paddingTop="safe-area-inset">
                <Box position="relative" height={navigationBarHeight} borderBottom="grey-10">
                    {isMobile && (
                        <Box
                            position="absolute"
                            top="0"
                            bottom="0"
                            left={mobileNavigationBarGap}
                            display="flex"
                            alignItems="center"
                        >
                            <MobileBackButton />
                        </Box>
                    )}
                    <Box
                        display="flex"
                        flexDirection={!isMobile ? "row" : "column"}
                        justifyContent={!isMobile ? "flex-start" : "center"}
                        alignItems="center"
                        gap={!isMobile ? "2" : "1"}
                        width="full"
                        maxWidth="160"
                        height="full"
                        marginX="center"
                        paddingX={screenPaddingX}
                    >
                        <Box
                            className={pulseAnimationClassName}
                            flexShrink="0"
                            width="7"
                            height="7"
                            backgroundColor="grey-10"
                            borderRadius="full"
                        />
                        <TextShimmer
                            fontSize={!isMobile ? "200" : "50"}
                            width={isMobile ? "12" : "32"}
                        />
                    </Box>
                </Box>
            </Box>
            <ChatMessagingViewShimmer messages="fill" />
        </Box>
    );
}

function NewChatRouteShimmer() {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" paddingTop="safe-area-inset" borderBottom="grey-10">
                {isMobile && (
                    <Box
                        height={navigationBarHeight}
                        paddingX={mobileNavigationBarGap}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        <MobileBackButton />
                        <TextShimmer fontSize="100" width="24" />
                        <MobileBackButtonSpacer />
                    </Box>
                )}
                <Box height={!isMobile ? "12" : "10"}>
                    <Box
                        display="flex"
                        alignItems="center"
                        width="full"
                        maxWidth="160"
                        height="full"
                        marginX="center"
                        paddingX={screenPaddingX}
                    >
                        <TextShimmer fontSize={!isMobile ? "100" : "50"} width="32" />
                    </Box>
                </Box>
            </Box>
            <ChatMessagingViewShimmer messages="few" />
        </Box>
    );
}

function ChatMessagingViewShimmer({messages}: {messages: "fill" | "few"}) {
    return (
        <>
            <Box
                overflow="hidden"
                flexGrow="1"
                display="flex"
                flexDirection="column"
                justifyContent="flex-end"
            >
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
    const isMobile = useIsMobile();

    return (
        <Box flexShrink="0" backgroundColor="grey-0" style={{height: messageInputMinHeight}}>
            <Box
                display="flex"
                alignItems="center"
                width="full"
                maxWidth="160"
                height="full"
                marginX="center"
                paddingX={screenPaddingX}
                gap="2"
            >
                {!isMobile && (
                    <Box
                        className={pulseAnimationClassName}
                        flexShrink="0"
                        width={messageInputAccountAvatarSize}
                        height={messageInputAccountAvatarSize}
                        backgroundColor="grey-10"
                        borderRadius="full"
                    />
                )}
                <Box
                    className={pulseAnimationClassName}
                    flexGrow="1"
                    border="grey-10"
                    borderRadius={messageViewBubbleBorderRadius}
                    style={{height: messageViewBubbleMinHeight}}
                />
                <Box
                    className={pulseAnimationClassName}
                    flexShrink="0"
                    width={messageInputAccountAvatarSize}
                    height={messageInputAccountAvatarSize}
                    backgroundColor="grey-10"
                    borderRadius="full"
                />
            </Box>
        </Box>
    );
}

function DocumentRouteShimmer({withMobileLayout}: {withMobileLayout: boolean}) {
    const isMobile = useIsMobile();

    const titleFontSize = withMobileLayout
        ? contentSchemaStyles.mobileTitleFontSize
        : contentSchemaStyles.desktopTitleFontSize;

    return (
        <Box position="relative" paddingX={screenPaddingX}>
            {isMobile && (
                <Box position="absolute" top="0" left="0" right="0">
                    <Box height="safe-area-inset-top" />
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        alignItems="center"
                        paddingX={mobileNavigationBarGap}
                    >
                        <MobileBackButton />
                    </Box>
                </Box>
            )}
            <Box
                marginX="center"
                width="full"
                maxWidth={contentSchemaStyles.defaultBlockMaxWidthWithoutPadding}
                paddingRight={withMobileLayout ? "8" : "12"}
            >
                <Box height="safe-area-inset-top" />
                <Box
                    style={{
                        height: isMobile
                            ? contentSchemaStyles.mobilePlatformTitlePaddingTop
                            : withMobileLayout
                            ? contentSchemaStyles.mobileLayoutTitlePaddingTop
                            : contentSchemaStyles.desktopTitlePaddingTop,
                    }}
                />
                <TextShimmer width="96" ragRight="8" fontSize={titleFontSize} />
                <Box height={contentSchemaStyles.defaultParagraphMargin} />
                <ContentParagraphShimmer1 />
                <Box
                    height={
                        isMobile
                            ? contentSchemaStyles.mobileHeading1TopMargin
                            : contentSchemaStyles.desktopHeading1TopMargin
                    }
                />
                <TextShimmer
                    width="48"
                    fontSize={
                        isMobile
                            ? contentSchemaStyles.mobileHeadingLevel1FontSize
                            : contentSchemaStyles.desktopHeadingLevel1FontSize
                    }
                />
                <Box height={contentSchemaStyles.defaultParagraphMargin} />
                <ContentParagraphShimmer2 />
                <Box height={contentSchemaStyles.defaultParagraphMargin} />
                <ContentParagraphShimmer3 />
                {!withMobileLayout && (
                    <>
                        <Box
                            height={
                                isMobile
                                    ? contentSchemaStyles.mobileHeading1TopMargin
                                    : contentSchemaStyles.desktopHeading1TopMargin
                            }
                        />
                        <TextShimmer
                            width="64"
                            fontSize={
                                isMobile
                                    ? contentSchemaStyles.mobileHeadingLevel1FontSize
                                    : contentSchemaStyles.desktopHeadingLevel1FontSize
                            }
                        />
                        <Box height={contentSchemaStyles.defaultParagraphMargin} />
                        <ContentParagraphShimmer1 />
                        <Box
                            height={
                                isMobile
                                    ? contentSchemaStyles.mobileHeading2TopMargin
                                    : contentSchemaStyles.desktopHeading2TopMargin
                            }
                        />
                        <TextShimmer
                            width="96"
                            fontSize={
                                isMobile
                                    ? contentSchemaStyles.mobileHeadingLevel2FontSize
                                    : contentSchemaStyles.desktopHeadingLevel2FontSize
                            }
                        />
                        <Box height={contentSchemaStyles.defaultParagraphMargin} />
                        <ContentParagraphShimmer3 />
                        <Box height={contentSchemaStyles.defaultParagraphMargin} />
                        <ContentParagraphShimmer2 />
                    </>
                )}
            </Box>
        </Box>
    );
}

function DocumentCommentThreadRouteShimmer() {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            <Box flexGrow="1" overflow="hidden">
                <Box height="safe-area-inset-top" />
                {isMobile && (
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        paddingX={mobileNavigationBarGap}
                    >
                        <MobileBackButton />
                        <TextShimmer fontSize="100" width="32" />
                        <MobileBackButtonSpacer />
                    </Box>
                )}
                <Box width="full" maxWidth={documentCommentThreadListViewMaxWidth} marginX="center">
                    <Box height={isMobile ? "3" : documentCommentThreadHeaderPaddingY} />
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
                            borderRadius="md"
                            border="grey-10"
                        />
                    </Box>
                    <Box height={messageViewTimestampDividerMarginTop} />
                    <Box style={{height: fontSizes["50"].lineHeight}} />
                    <Box height={messageViewTimestampDividerMarginBottom} />
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
    const isMobile = useIsMobile();

    if (isMobile) {
        return (
            <Box width="full">
                <Box height="safe-area-inset-top" />
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    paddingX={mobileNavigationBarGap}
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
                <Box flexShrink="0" height="12" borderBottom="grey-10" />
                <Box flexGrow="1" display="flex" flexDirection="row">
                    <Box flexShrink="0" width="96" borderRight="grey-10" paddingY="1">
                        <InboxEntryShimmer titleRagRight="0" subtitleRagRight="8" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                        <InboxEntryShimmer titleRagRight="4" subtitleRagRight="6" />
                        <InboxEntryShimmer titleRagRight="0" subtitleRagRight="2" />
                        <InboxEntryShimmer titleRagRight="6" subtitleRagRight="4" />
                    </Box>
                    <Box flexGrow="1" overflow="hidden">
                        <ChannelPostsNotificationRouteShimmer />
                    </Box>
                </Box>
            </Box>
        );
    }
}

function ChannelPostsNotificationRouteShimmer() {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box height="safe-area-inset-top" />
            {isMobile && (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    paddingX={mobileNavigationBarGap}
                >
                    <MobileBackButton />
                    <Box flexGrow="1" display="flex" justifyContent="center">
                        <TextShimmer fontSize="100" width="32" />
                    </Box>
                    <MobileBackButtonSpacer />
                </Box>
            )}
            <Box position="relative" width="full" maxWidth={postViewMaxWidth} marginX="center">
                {isMobile && (
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

function PostRouteShimmer({withMobileLayout}: {withMobileLayout: boolean}) {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden" display="flex" flexDirection="column">
            <Box flexGrow="1" overflow="hidden">
                <Box height="safe-area-inset-top" />
                {isMobile && (
                    <Box
                        style={{
                            height: `${mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`,
                        }}
                    >
                        <Box
                            height={navigationBarHeight}
                            display="flex"
                            alignItems="center"
                            paddingX={mobileNavigationBarGap}
                        >
                            <MobileBackButton />
                            <Box flexGrow="1">
                                <PostShimmerHeader avatarSize="7" />
                            </Box>
                        </Box>
                    </Box>
                )}
                <Box
                    flexShrink="0"
                    width="full"
                    maxWidth={postViewMaxWidth}
                    marginX="center"
                    style={{
                        marginTop:
                            !isMobile && withMobileLayout
                                ? `${
                                      mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar -
                                      desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar
                                  }rem`
                                : undefined,
                    }}
                >
                    <PostShimmer withoutHeader={isMobile}>
                        <ContentParagraphShimmer3 />
                    </PostShimmer>
                </Box>
                <Box style={{height: spacing[messageViewTimestampDividerMarginTop]}} />
                <MessageShimmer width="32" heightLines={1} />
                <MessageShimmer width="64" heightLines={1} shouldMergeWithNextMessage={true} />
                <MessageShimmer width="96" heightLines={1} shouldMergeWithPreviousMessage={true} />
            </Box>
            <MessageInputShimmer />
            <Box flexShrink="0" height="safe-area-inset-bottom" />
        </Box>
    );
}

function NewPostRouteShimmer({withMobileLayout}: {withMobileLayout: boolean}) {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box flexShrink="0" width="full" maxWidth={postViewMaxWidth} marginX="center">
                <Box height="safe-area-inset-top" />
                {isMobile && (
                    <Box
                        height={navigationBarHeight}
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        paddingX={mobileNavigationBarGap}
                    >
                        <MobileBackButton />
                        <TextShimmer fontSize="100" width="16" />
                        <MobileBackButtonSpacer />
                    </Box>
                )}
                <Box
                    style={{
                        height: withMobileLayout
                            ? isMobile
                                ? `${mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`
                                : `${mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`
                            : `${desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`,
                    }}
                />
                <PostShimmerHeader />
            </Box>
        </Box>
    );
}

function SearchRouteShimmer() {
    const isMobile = useIsMobile();

    const maxWidth = !isMobile ? "96" : undefined;

    return (
        <Box width="full" maxWidth={maxWidth} marginX="center">
            <Box paddingX={screenPaddingX}>
                <Box height="safe-area-inset-top" />
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    paddingX={mobileNavigationBarGap}
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
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box
                width="full"
                maxWidth={taskDetailViewMaxWidth}
                marginX="center"
                paddingX={screenPaddingX}
            >
                <Box height="safe-area-inset-top" />
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    marginBottom={
                        !isMobile ? desktopTaskDetailViewNavigationBarSpacerMarginBottom : undefined
                    }
                >
                    {isMobile && <MobileBackButton />}
                    {!isMobile && (
                        <Box
                            className={pulseAnimationClassName}
                            backgroundColor="grey-10"
                            width={desktopTaskDetailViewStatusButtonSize}
                            height={desktopTaskDetailViewStatusButtonSize}
                            borderRadius="full"
                        />
                    )}
                </Box>
                {isMobile && (
                    <Box
                        paddingTop={mobileTaskDetailViewStatusButtonPaddingTop}
                        paddingBottom={mobileTaskDetailViewStatusButtonPaddingBottom}
                    >
                        <Box
                            className={pulseAnimationClassName}
                            backgroundColor="grey-10"
                            width={mobileTaskDetailViewStatusButtonSize}
                            height={mobileTaskDetailViewStatusButtonSize}
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
                <Box style={{height: tasksStyles.detailNotesContentEditorMinHeight}} />
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
        </Box>
    );
}

function TaskGridRouteShimmer({
    withMobileLayout,
    titleWidth,
    notepadActiveSection,
    customizationBar,
}: {
    withMobileLayout: boolean;
    titleWidth?: Spacing;
    notepadActiveSection?: ReactNode;
    customizationBar?: ReactNode;
}) {
    const isMobile = useIsMobile();

    return (
        <Box width="full" height="full" overflow="hidden">
            <Box height="safe-area-inset-top" />
            {notepadActiveSection && isMobile && (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    paddingX={mobileNavigationBarGap}
                >
                    <MobileBackButton />
                    <TextShimmer fontSize="100" width="24" />
                    <MobileBackButtonSpacer />
                </Box>
            )}
            {notepadActiveSection}
            {!notepadActiveSection || !isMobile ? (
                <Box
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent={!notepadActiveSection && isMobile ? "space-between" : undefined}
                    alignItems="center"
                    paddingX={
                        !notepadActiveSection && isMobile ? mobileNavigationBarGap : screenPaddingX
                    }
                >
                    {!notepadActiveSection && isMobile && <MobileBackButton />}
                    <TextShimmer fontSize="200" width={titleWidth ?? (isMobile ? "24" : "48")} />
                    {!notepadActiveSection && isMobile && <MobileBackButtonSpacer />}
                </Box>
            ) : (
                <Box paddingY="2">
                    <Box height="7" />
                </Box>
            )}
            <Box position="relative" paddingX={screenPaddingX}>
                {customizationBar}
                {withMobileLayout && notepadActiveSection && !isMobile && (
                    <Box style={{height: taskGridViewColumnHeaderExtraPaddingBottomPx}} />
                )}
                <Box
                    position="absolute"
                    bottom="0"
                    left={screenPaddingX}
                    right={screenPaddingX}
                    borderBottom={withMobileLayout ? "grey-5" : undefined}
                />
            </Box>
            <Box paddingX={screenPaddingX}>
                {!withMobileLayout && (
                    <Box
                        borderBottom="grey-5"
                        style={{
                            height: `calc(${spacing[taskGridViewColumnHeaderHeight]} + ${taskGridViewColumnHeaderExtraPaddingBottomPx}px)`,
                        }}
                    >
                        <Box
                            height={taskGridViewColumnHeaderHeight}
                            display="flex"
                            alignItems="center"
                        >
                            <Box flexGrow="1">
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
                {!withMobileLayout && (
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
            </Box>
        </Box>
    );
}

function TaskRowShimmer({width, ragRight}: {width: Spacing; ragRight?: Spacing}) {
    const isMobile = useIsMobile();

    const marginLeft: RemLength = `${
        parseRemLengthNumber(spacing[isMobile ? "2" : "5"]) +
        parseRemLengthNumber(spacing[isMobile ? "7" : "6"])
    }rem`;

    return (
        <Box height={taskRowViewMinHeight} display="flex" borderBottom="grey-5">
            <Box
                flexShrink="0"
                style={{width: marginLeft}}
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                height={taskRowViewMinHeight}
            >
                <Box width={isMobile ? "7" : "6"} paddingRight="2">
                    <Box
                        width={isMobile ? "5" : "4"}
                        height={isMobile ? "5" : "4"}
                        borderRadius="full"
                        border="grey-10"
                    />
                </Box>
            </Box>
            <Box height={taskRowViewMinHeight} flexGrow="1" display="flex" alignItems="center">
                <Box
                    className={pulseAnimationClassName}
                    width="full"
                    maxWidth={width}
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                    marginRight={ragRight}
                />
            </Box>
        </Box>
    );
}

function TaskQueryRouteShimmer({withMobileLayout}: {withMobileLayout: boolean}) {
    const isMobile = useIsMobile();

    return (
        <TaskGridRouteShimmer
            withMobileLayout={withMobileLayout}
            customizationBar={
                withMobileLayout &&
                (isMobile ? (
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
                            borderRadius="base"
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
                            borderRadius="base"
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

function TaskNotepadRouteShimmer({withMobileLayout}: {withMobileLayout: boolean}) {
    const isMobile = useIsMobile();

    // Fake the spacing for 3 cards.
    const cardCount = 3;

    // There's less horizontal space on mobile for cards than in peeks on desktop.
    const cardCountAboveTheFold = isMobile ? 1 : withMobileLayout ? 2 : 3;

    const cardWidthStyle = `calc(${(1 / cardCountAboveTheFold) * 100}% - ${
        parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) *
            ((cardCountAboveTheFold - 1) / cardCountAboveTheFold) +
        (Math.max(cardCount, cardCountAboveTheFold) > cardCountAboveTheFold
            ? parseRemLengthNumber(spacing[cardCountAboveTheFold <= 1 ? "16" : "4"])
            : 0)
    }rem)`;

    return (
        <TaskGridRouteShimmer
            withMobileLayout={withMobileLayout}
            titleWidth="20"
            notepadActiveSection={
                <>
                    <Box height={taskNotepadViewActiveSectionMarginTop} />
                    <Box paddingX={screenPaddingX}>
                        <TextShimmer
                            fontSize={
                                taskNotepadViewActiveSectionTitleFontSize[
                                    isMobile ? "mobile" : "desktop"
                                ]
                            }
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
                            borderRadius="lg"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                        <Box
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            border="grey-5"
                            borderRadius="lg"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                        <Box
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            border="grey-5"
                            borderRadius="lg"
                            style={{
                                width: cardWidthStyle,
                                height: taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight,
                            }}
                        />
                    </Box>
                    <Box
                        style={{
                            height: isMobile
                                ? mobileTaskNotepadViewActiveSectionMarginBottom
                                : desktopTaskNotepadViewActiveSectionMarginBottom,
                        }}
                    />
                    <Box height="safe-area-inset-top" />
                </>
            }
        />
    );
}
