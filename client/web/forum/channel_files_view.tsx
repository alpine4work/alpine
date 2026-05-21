import {SpinnerGap} from "phosphor-react";
import {useCallback, useEffect, useMemo, useRef} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {useRynamoQuery} from "~/client/web/dynamo/use_rynamo_query.js";
import {getInitialChannelFilesViewFileLoadCount} from "~/client/web/forum/get_initial_channel_files_view_load_count.js";
import {ChannelViewContentFilePreview} from "~/client/web/forum/internal/channel_view_content_file_preview.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {NavigationBarContent} from "~/client/web/navigation/navigation_bar_content.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    channelFilesViewFileMaxSize,
    channelFilesViewFileMinSize,
    channelFilesViewFileRowFileCount,
    channelFilesViewMaxWidth,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    contentStyles,
    pulseAnimationClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {
    ChannelModel,
    ChannelOrMetadataModel,
    ChannelPostFilesModel,
} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    backfillChannelAndMetadata,
    getChannelAndMetadata,
} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelFilesView({
    initialChannelResult,
    isFromChannelView,
}: {
    initialChannelResult: RynamoQueryResult<ChannelOrMetadataModel>;
    isFromChannelView: boolean;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const clientInfo = useClientInfo();
    const spacingScale = useSpacingScale();
    const remPx = remPxBySpacingScale[spacingScale];
    const {space, currentAccount} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    assert(initialChannelResult.items[0]?.model instanceof ChannelModel);

    const channelId = initialChannelResult.items[0].model.id;

    const shouldConnectToChannelRealtime = currentAccount !== null;

    const {isConnected, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "ChannelRealtimeService",
        ChannelRealtimeProtocol,
        shouldConnectToChannelRealtime ? `/api/durable-objects/channels/${channelId}` : null,
    );

    const {
        query: channelAndMetadataQuery,
        handleLoadMore: handleLoadMoreIntoChannelAndMetadataQuery,
    } = useRynamoQuery(initialChannelResult, {
        isConnected,
        subscribeToPongs,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.events)),
            [subscribeToEvents],
        ),
        backfillQuery: useCallback(
            async checkpoint => {
                const {backfillChannelResult} = await backfillChannelAndMetadata(context, {
                    channelId,
                    checkpoint,
                });
                return backfillChannelResult;
            },
            [context, channelId],
        ),
        reloadQuery: useCallback(async () => {
            const {channelResult} = await getChannelAndMetadata(context, {
                channelId,
                postFilesLimit: getInitialChannelFilesViewFileLoadCount(clientInfo),
            });
            return channelResult;
        }, [channelId, clientInfo, context]),
    });

    const isLoadingRef = useRef(false);
    const setErrorState = useErrorState();

    const tryLoadingMoreData = useEvent(
        (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingRef.current = true;
            result.promise.then(
                () => {
                    isLoadingRef.current = false;
                },
                error => {
                    isLoadingRef.current = false;
                    setErrorState(error);
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                if (!renderedRange) return {isLoading: false};

                const nextPageItemKey = channelAndMetadataQuery.getNextPageItemKeyIfExists();

                if (
                    nextPageItemKey !== null &&
                    loadingIndicatorIndex !== null &&
                    renderedRange.startIndex <= loadingIndicatorIndex &&
                    loadingIndicatorIndex <= renderedRange.endIndex
                ) {
                    return {
                        isLoading: true,
                        promise: (async () => {
                            const {channelResult} = await getChannelAndMetadata(context, {
                                channelId,
                                postFilesLimit: getInitialChannelFilesViewFileLoadCount(clientInfo),
                                afterItemKey: nextPageItemKey,
                            });

                            handleLoadMoreIntoChannelAndMetadataQuery(channelResult);
                        })(),
                    };
                }

                return {isLoading: false};
            }
        },
    );

    // Whenever our list data changes, try loading more comments. In case our rendered
    // range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMorePostComments()` completes in
    // case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        channelAndMetadataQuery;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [channelAndMetadataQuery, tryLoadingMoreData]);

    const channelItem = channelAndMetadataQuery.getFirstItemIfExists();
    assert(channelItem?.model instanceof ChannelModel);
    const channel = channelItem.model;

    const files = useMemo(() => {
        const files = [];

        for (let i = 0; i < channelAndMetadataQuery.getItemCountWithoutLoadingIndicator(); i++) {
            const item = channelAndMetadataQuery.getItem(i);
            if (item.type !== "Loaded") continue;
            if (!(item.item.model instanceof ChannelPostFilesModel)) continue;

            for (const file of item.item.model.files) {
                files.push({
                    postId: item.item.model.postId,
                    file: file.file,
                    signedUrlSearch: file.signedUrlSearch,
                });
            }
        }

        return files;
    }, [channelAndMetadataQuery]);

    const [containerSizeRef, containerSize] = useResizeObserver();

    const fileSizePx = clamp(
        convertRemLengthToPx(channelFilesViewFileMinSize, spacingScale),
        ((containerSize?.width ?? clientInfo.screenWidth) -
            screenPaddingXRem[platform] * 2 * remPx -
            contentStyles.fileRowGapWidthRem * (channelFilesViewFileRowFileCount - 1) * remPx) /
            channelFilesViewFileRowFileCount,
        convertRemLengthToPx(channelFilesViewFileMaxSize, spacingScale),
    );

    const fileRowMinHeight = addRemLengths(
        channelFilesViewFileMinSize,
        contentStyles.fileRowGapWidth,
    );

    const fileRowCount = Math.ceil(files.length / channelFilesViewFileRowFileCount);
    const loadingIndicatorIndex = channelAndMetadataQuery.hasLoadingIndicatorAtEnd()
        ? fileRowCount
        : null;

    return (
        <Box
            ref={containerSizeRef}
            display="flex"
            flexDirection="column"
            width="full"
            height="full"
            overflow="hidden"
        >
            <Box height="safe-area-inset-top" />
            <NavigationBarContent
                title={
                    <ChannelFilesViewNavigationBarTitle
                        title={channel.name}
                        spaceId={space.id}
                        channelId={channelId}
                        isFromChannelView={isFromChannelView}
                    />
                }
                subtitle="Files"
                desktopMaxWidth={channelFilesViewMaxWidth.desktop}
            />
            <VirtualizedScrollView
                ref={viewRef}
                itemCount={
                    fileRowCount + (channelAndMetadataQuery.hasLoadingIndicatorAtEnd() ? 1 : 0)
                }
                bufferedItemHeight={fileSizePx}
                onRenderedRangeChange={tryLoadingMoreData}
                renderItem={useCallback(
                    index => {
                        if (index === loadingIndicatorIndex) {
                            return {
                                key: "LoadingIndicator",
                                minHeight: addRemLengths(
                                    channelFilesViewFileMinSize,
                                    contentStyles.fileRowGapWidth,
                                    channelFilesViewFileMinSize,
                                    "24",
                                ),
                                node: (
                                    <>
                                        <Box className={pulseAnimationClassName}>
                                            <Box
                                                width="full"
                                                marginX="center"
                                                marginBottom={contentStyles.fileRowGapWidth}
                                                paddingX={screenPaddingX}
                                                display="flex"
                                                gap={contentStyles.fileRowGapWidth}
                                                style={{
                                                    height: fileSizePx,
                                                    maxWidth: channelFilesViewMaxWidth[platform],
                                                }}
                                            >
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                            </Box>
                                            <Box
                                                width="full"
                                                marginX="center"
                                                paddingX={screenPaddingX}
                                                display="flex"
                                                gap={contentStyles.fileRowGapWidth}
                                                style={{
                                                    height: fileSizePx,
                                                    maxWidth: channelFilesViewMaxWidth[platform],
                                                }}
                                            >
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                                <Box
                                                    width="full"
                                                    height="full"
                                                    backgroundColor="grey-5"
                                                />
                                            </Box>
                                        </Box>
                                        <Box
                                            position="relative"
                                            height="24"
                                            display="flex"
                                            justifyContent="center"
                                            alignItems="center"
                                            color="grey-60"
                                        >
                                            <SpinnerGap
                                                className={spinAnimationClassName}
                                                size={spacing["6"]}
                                                weight="light"
                                            />
                                        </Box>
                                    </>
                                ),
                            };
                        }

                        const file1 = files[index * channelFilesViewFileRowFileCount + 0];
                        const file2 = files[index * channelFilesViewFileRowFileCount + 1];
                        const file3 = files[index * channelFilesViewFileRowFileCount + 2];

                        return {
                            key: `FileRow:${index}`,
                            minHeight: fileRowMinHeight,
                            node: (
                                <Box
                                    width="full"
                                    marginX="center"
                                    marginBottom={contentStyles.fileRowGapWidth}
                                    paddingX={screenPaddingX}
                                    display="flex"
                                    gap={contentStyles.fileRowGapWidth}
                                    style={{
                                        height: fileSizePx,
                                        maxWidth: channelFilesViewMaxWidth[platform],
                                    }}
                                >
                                    {!file1 ? (
                                        <Box width="full" height="full" />
                                    ) : (
                                        <ChannelViewContentFilePreview
                                            postId={file1.postId}
                                            file={file1.file}
                                            signedUrlSearch={file1.signedUrlSearch}
                                            size={fileSizePx}
                                        />
                                    )}
                                    {!file2 ? (
                                        <Box width="full" height="full" />
                                    ) : (
                                        <ChannelViewContentFilePreview
                                            postId={file2.postId}
                                            file={file2.file}
                                            signedUrlSearch={file2.signedUrlSearch}
                                            size={fileSizePx}
                                        />
                                    )}
                                    {!file3 ? (
                                        <Box width="full" height="full" />
                                    ) : (
                                        <ChannelViewContentFilePreview
                                            postId={file3.postId}
                                            file={file3.file}
                                            signedUrlSearch={file3.signedUrlSearch}
                                            size={fileSizePx}
                                        />
                                    )}
                                </Box>
                            ),
                        };
                    },
                    [fileRowMinHeight, fileSizePx, files, loadingIndicatorIndex, platform],
                )}
            />
        </Box>
    );
}

function ChannelFilesViewNavigationBarTitle({
    title,
    spaceId,
    channelId,
    isFromChannelView,
}: {
    title: string;
    spaceId: SpaceId;
    channelId: ChannelId;
    isFromChannelView: boolean;
}) {
    const navigate = useNavigate();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isFromChannelView) {
                navigate(-1);
            } else {
                navigate(`/s/${spaceId}/channels/${channelId}`, {
                    stopPropagation: true,
                });
            }
        },
    });

    return (
        <a
            {...pressProps}
            className={sprinkles({
                cursor: "pointer",
                opacity: isPressed ? "60" : undefined,
            })}
            href={`/s/${spaceId}/channels/${channelId}`}
            onClick={event => {
                event.preventDefault();
                pressProps.onClick?.(event);
            }}
        >
            {title}
        </a>
    );
}
