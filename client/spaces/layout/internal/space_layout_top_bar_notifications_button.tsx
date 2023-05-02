import {ArrowRight, Bell, SpinnerGap} from "phosphor-react";
import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {IconButton} from "~/client/design/icon_button";
import {Overlay} from "~/client/design/overlay";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useShowToast} from "~/client/design/toast";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item";
import {usePromise} from "~/client/helpers/use_promise";
import {
    InboxEntryView,
    inboxEntryViewMinHeight,
    inboxEntryWidth,
} from "~/client/inbox/inbox_entry_view";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge";
import {useInboxState} from "~/client/inbox/use_inbox_state";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view";
import {getVirtualizationWindowHeight} from "~/client/virtualized/virtualized_scroll_view_state";
import {Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {InboxEntryModel, InboxModel} from "~/shared/models/inbox_model";
import {getInboxWithStrongReadConsistency} from "~/shared/rpc/accounts_rpc_definitions";
import {getInboxEntries} from "~/shared/rpc/notifications_rpc_definitions";
import {
    colorSchemeVars,
    greyElevatedClassName,
    spinAnimationClassName,
} from "~/shared/styles/styles";

const notificationOverlayHeight: Spacing = "128";

export function SpaceLayoutTopBarNotificationsButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const buttonRef = useRef<HTMLButtonElement>(null);

    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();

    // NOCOMMIT: Test that we can go offline then back online and the inbox count
    // updates.
    const inbox = useDynamoGeneralRealtimeItem(initialInbox, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {inbox} = await getInboxWithStrongReadConsistency(context, {spaceId: space.id});
            return inbox;
        }, [context, space.id]),
    });

    const [overlayState, setOverlayState] = useState<
        | {
              isVisible: false;
              isDelayingLoadingIndicator?: undefined;
          }
        | {
              isVisible: true;
              isDelayingLoadingIndicator: boolean;
              initialEntriesResultPromise: PromiseImmediate<
                  DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>
              >;
          }
    >({isVisible: false});

    // Close the menu if there’s a click somewhere else in the document outside
    // the menu or menu button.
    const outsideOverlayPressRef = useOutsidePress(event => {
        if (!overlayState.isVisible) return;

        const buttonElement = assertExists(buttonRef.current);
        const targetElement = event.target as Element;

        if (buttonElement.contains(targetElement)) return;

        setOverlayState({isVisible: false});
    });

    useEffect(() => {
        if (!overlayState.isVisible || !overlayState.isDelayingLoadingIndicator) return;

        const timeout = createTimeout(() => {
            setOverlayState(overlayState => {
                if (!overlayState.isVisible || !overlayState.isDelayingLoadingIndicator)
                    return overlayState;

                return {...overlayState, isDelayingLoadingIndicator: false};
            });
        }, delayLoadingIndicatorLimitMs);

        return () => {
            timeout.clear();
        };
    }, [overlayState.isDelayingLoadingIndicator, overlayState.isVisible]);

    const handleClose = useCallback(() => {
        setOverlayState({isVisible: false});
    }, []);

    return (
        <Box position="relative" zIndex="0">
            <Overlay
                // NOTE(calebmer): This overlay is large enough and has a lot of content so
                // animating it closed looks a little weird.
                isVisible={overlayState.isVisible && !overlayState.isDelayingLoadingIndicator}
                placement="bottom-end"
                offset={defaultTooltipOffset}
                offsetAlong="8"
                overlay={
                    <Box
                        ref={outsideOverlayPressRef}
                        width={inboxEntryWidth}
                        height={notificationOverlayHeight}
                        borderRadius="md"
                        backgroundColor="grey-0"
                        boxShadow="elevation-20"
                        display="flex"
                        flexDirection="column"
                        overflow="hidden"
                        className={greyElevatedClassName}
                    >
                        {overlayState.isVisible && (
                            <SpaceLayoutTopBarNotificationOverlay
                                initialEntriesResultPromise={
                                    overlayState.initialEntriesResultPromise
                                }
                                onClose={handleClose}
                            />
                        )}
                    </Box>
                }
            >
                <IconButton
                    ref={buttonRef}
                    size="md"
                    description="Notifications"
                    tooltipPlacement="bottom"
                    // The notification count renders outside the bounds of the icon button. Don't
                    // clip it!
                    disableOverflowHidden={true}
                    onPress={() => {
                        if (overlayState.isVisible) {
                            // Clicking is a direct interaction so don't animate the overlay closed.
                            setOverlayState({isVisible: false});
                        } else {
                            // Fetch enough items to fill the virtualization window with entries. This
                            // gives the user a bit of space to scroll.
                            const remPx = getRemPxWithoutListening();
                            const limit = Math.ceil(
                                getVirtualizationWindowHeight(
                                    convertRemLengthToPx(spacing[notificationOverlayHeight], remPx),
                                ) / convertRemLengthToPx(inboxEntryViewMinHeight, remPx),
                            );

                            setOverlayState({
                                isVisible: true,
                                isDelayingLoadingIndicator: true,
                                initialEntriesResultPromise: PromiseImmediate.resolve(
                                    getInboxEntries(context, {
                                        spaceId: space.id,
                                        limit,
                                        afterCursor: null,
                                    }).then(({entriesResult}) => entriesResult),
                                ),
                            });
                        }
                    }}
                >
                    <Bell />
                    {inbox.model.loudNotificationCount > 0 && (
                        <LoudNotificationBadge
                            top="-0.0625rem"
                            right="0.5rem"
                            loudNotificationCount={inbox.model.loudNotificationCount}
                        />
                    )}
                </IconButton>
            </Overlay>
        </Box>
    );
}

function SpaceLayoutTopBarNotificationOverlay({
    initialEntriesResultPromise,
    onClose,
}: {
    initialEntriesResultPromise: PromiseImmediate<
        DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>
    >;
    onClose: Memo<() => void>;
}) {
    const initialEntriesResult = usePromise(initialEntriesResultPromise);

    return (
        <>
            <Box
                flexShrink="0"
                height="7"
                borderBottom="grey-10"
                paddingX="2"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
            >
                <Box fontSize="50" color="grey-70">
                    Notifications
                </Box>
            </Box>
            {initialEntriesResult.isPending ? (
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <SpinnerGap
                        className={spinAnimationClassName}
                        color={colorSchemeVars["grey-70"]}
                        size={spacing["6"]}
                    />
                </Box>
            ) : (
                <SpaceLayoutTopBarNotificationOverlayInbox
                    initialEntriesResult={initialEntriesResult.value}
                    onClose={onClose}
                />
            )}
        </>
    );
}

function SpaceLayoutTopBarNotificationOverlayInbox({
    initialEntriesResult,
    onClose,
}: {
    initialEntriesResult: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>;
    onClose: Memo<() => void>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const {query, tryLoadingMore} = useInboxState({
        initialEntriesResult,
        getViewHeight: () => {
            const view = assertExists(viewRef.current);
            return view.getHeight();
        },
    });

    // Whenever our query data changes, try loading more entries. In case our
    // rendered range stayed the same but we now see the loading indicator.
    //
    // This effect should also fire when `tryLoadingMore()` completes in case it
    // didn't fully load the query.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        query;

        const view = assertExists(viewRef.current);
        tryLoadingMore(view.getRenderedRange());
    }, [query, tryLoadingMore]);

    const itemCount = query.getItemCount();

    return (
        <VirtualizedScrollView
            ref={viewRef}
            bufferedItemHeight={inboxEntryViewMinHeight}
            initialViewHeight={spacing[notificationOverlayHeight]}
            onRenderedRangeChange={tryLoadingMore}
            itemCount={itemCount}
            renderItem={useCallback(
                index => {
                    const item = query.getItem(index);
                    switch (item.type) {
                        case "LoadedItem": {
                            return {
                                key: `LoadedItem:${item.item.key}`,
                                minHeight: inboxEntryViewMinHeight,
                                node: (
                                    <SpaceLayoutTopBarNotificationOverlayInboxEntry
                                        entry={item.item.model}
                                        isFirstEntry={index === 0}
                                        isLastEntry={index === itemCount - 1}
                                        onClose={onClose}
                                    />
                                ),
                            };
                        }
                        case "LoadingIndicator": {
                            return {
                                key: "LoadingIndicator",
                                minHeight: inboxEntryViewMinHeight,
                                node: (
                                    <Box
                                        display="flex"
                                        justifyContent="center"
                                        alignItems="center"
                                        style={{height: inboxEntryViewMinHeight}}
                                    >
                                        <SpinnerGap
                                            className={spinAnimationClassName}
                                            color={colorSchemeVars["grey-60"]}
                                            size={spacing["4"]}
                                        />
                                    </Box>
                                ),
                            };
                        }
                        default:
                            throw exhaustive(item);
                    }
                },
                [itemCount, onClose, query],
            )}
        />
    );
}

function SpaceLayoutTopBarNotificationOverlayInboxEntry({
    entry,
    isFirstEntry,
    isLastEntry,
    onClose,
}: {
    entry: InboxEntryModel;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onClose: () => void;
}) {
    const showToast = useShowToast();
    const peekStackContext = usePeekStackContext();

    const [isPending, setIsPending] = useState(false);

    return (
        <InboxEntryView
            entry={entry}
            withinOverlay={true}
            isFirstEntry={isFirstEntry}
            isLastEntry={isLastEntry}
            onPress={() => {
                if (isPending) return;

                // TODO(calebmer): Some kind of global loading indicator?
                peekStackContext.push(entry.getPath()).then(
                    () => {
                        setIsPending(false);
                        onClose();
                    },
                    error => {
                        setIsPending(false);
                        showToast({
                            type: "Error",
                            title: "Couldn’t open notification",
                            error,
                        });
                    },
                );
            }}
        />
    );
}
