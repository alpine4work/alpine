import {ArrowUpRight, CaretDown, CaretUp, Check} from "phosphor-react";
import {ReactNode, useCallback, useEffect, useMemo, useRef} from "react";
import {createPath, useLocation} from "react-router";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {Spacer} from "~/client/design/spacer.js";
import {useDynamoGeneralRealtimeItemBase} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/helpers/use_store.js";
import {InboxContextProvider} from "~/client/inbox/inbox_context_provider.js";
import {InboxContextNavigation} from "~/client/inbox/inbox_context_types.js";
import {printInboxEntryDisplayContentSummaryWithoutInteractivityStore} from "~/client/inbox/internal/print_inbox_entry_display_content_summary_without_interactivity_store.js";
import {
    subscribeToArchiveInboxEntryOptimistically,
    subscribeToUnarchiveInboxEntryOptimistically,
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/inbox/use_archive_inbox_entry.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {inboxBannerHeight} from "~/client/styles/inbox_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {Spacing, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {convertPeekPathToSpacePathParts} from "~/shared/remix/peek_path_helpers.js";
import {getInboxEntryWithStrongReadConsistency} from "~/shared/rpc/notifications_rpc_definitions.js";

export function InboxBannerOutletContainer({
    initialEntry,
    withoutRealtime,
    navigation,
    maxWidth,
    sidebarRightWidth,
    children,
}: {
    initialEntry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    withoutRealtime: boolean;
    navigation: InboxContextNavigation | null;
    maxWidth: Spacing | "full";
    sidebarRightWidth?: Spacing;
    children?: ReactNode;
}) {
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {locale, isAppleDevice} = useClientInfo();
    const location = useLocation();
    const accountRegistry = useAccountRegistry();
    const {space, currentAccount} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();

    const doneButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const entryKey = useMemo(() => initialEntry.model.getKey(), [initialEntry.model]);

    const [entryFromState, updateEntry, updateEntryOptimistically] =
        useStateWithOptimisticUpdates(initialEntry);

    let entry = entryFromState;

    // If realtime is disabled then `entry` should always be the same as
    // `initialEntry`. If realtime is enabled then we'll resume from the last
    // `initialEntry` we saw.
    if (withoutRealtime && entry !== initialEntry) {
        entry = initialEntry;
        updateEntry(() => initialEntry);
    }

    const isInboxEntryTask = entry.model.type === "Task";

    useEffect(() => {
        return subscribeToArchiveInboxEntryOptimistically(event => {
            updateEntryOptimistically(event.promise, entry => {
                if (entry.key !== event.entry.key) return entry;
                if (entry.version > event.entry.version) return entry;
                if (entry.model.isArchived) return entry;

                return {
                    ...entry,
                    model: entry.model.clone({isArchived: true}),
                };
            });
        });
    }, [updateEntryOptimistically]);

    useEffect(() => {
        return subscribeToUnarchiveInboxEntryOptimistically(event => {
            updateEntryOptimistically(event.promise, entry => {
                if (entry.key !== event.entry.key) return entry;
                if (entry.version > event.entry.version) return entry;
                if (!entry.model.isArchived) return entry;

                return {
                    ...entry,
                    model: entry.model.clone({isArchived: false}),
                };
            });
        });
    }, [updateEntryOptimistically]);

    useDynamoGeneralRealtimeItemBase(
        {item: entry, onUpdateItem: updateEntry},
        {
            isConnected: isConnected,
            subscribeToEvents: useCallback(
                subscriber => {
                    // The parent component is responsible for keeping `entry` up-to-date in
                    // realtime. If `withoutRealtime` is true then noop.
                    if (withoutRealtime) return;

                    return subscribeToEvents(event => subscriber(event.eventTransaction));
                },
                [subscribeToEvents, withoutRealtime],
            ),
            reloadItemWithStrongReadConsistency: useCallback(async () => {
                // The parent component is responsible for keeping `entry` up-to-date in
                // realtime. If `withoutRealtime` is true then noop.
                if (withoutRealtime) return;

                const {entry} = await getInboxEntryWithStrongReadConsistency(context, {
                    spaceId: space.id,
                    key: entryKey,
                });
                return entry;
            }, [context, entryKey, space.id, withoutRealtime]),
        },
    );

    const entryDisplay = useMemo(
        () => getInboxEntryDisplayContent({entry: entry.model, locale, currentAccount}),
        [currentAccount, entry.model, locale],
    );

    const entryDisplaySummaryText = useStore(
        useMemo(
            () =>
                printInboxEntryDisplayContentSummaryWithoutInteractivityStore(
                    accountRegistry,
                    entryDisplay.summary,
                ),
            [accountRegistry, entryDisplay.summary],
        ),
    );

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (event.key === "d" && (isAppleDevice ? event.metaKey : event.ctrlKey)) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (!entry.model.isArchived) {
                        // Programmatically click the button to correctly handle loading and
                        // error states.
                        assertExists(doneButtonRef.current).press();
                    } else if (navigation) {
                        // If the entry is already archived then move to the next entry.
                        if (navigation.nextEntry) {
                            void navigation.selectEntry(navigation.nextEntry);
                        } else if (navigation.previousEntry) {
                            void navigation.selectEntry(navigation.previousEntry);
                        }
                    } else {
                        // If the entry is already archived (e.g. because of a comment) we still want
                        // Cmd-D to close the peek so users can maintain that workflow.
                        navigate(-1);
                    }
                }
            }}
        >
            <Box
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                position="relative"
                zIndex="0"
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
                    zIndex="50"
                    style={{paddingTop: "var(--safe-area-inset-top-base, 0px)"}}
                >
                    <Box
                        width="full"
                        maxWidth={maxWidth}
                        height={inboxBannerHeight}
                        marginX="center"
                        display="flex"
                        justifyContent="center"
                        flexDirection="row"
                    >
                        <Box
                            display="flex"
                            paddingX={screenPaddingX}
                            alignItems="center"
                            width={isInboxEntryTask ? contentStyles.contentMaxWidth : "full"}
                        >
                            <Box
                                color="grey-50"
                                fontSize="75"
                                fontStyle="truncate"
                                paddingRight={
                                    !navigation && platform !== "mobile" ? "0.5" : undefined
                                }
                                userSelect={platform !== "mobile" ? "text" : undefined}
                            >
                                {platform === "mobile"
                                    ? "Notification"
                                    : `Notification: ${entryDisplaySummaryText}`}
                            </Box>
                            {!navigation && platform !== "mobile" && (
                                <IconButton
                                    size="xs"
                                    description="Open in inbox"
                                    tooltipPlacement="bottom"
                                    // The inbox will show a loading shimmer when it opens. We don't need to
                                    // also show a loading indicator here.
                                    withoutLoadingIndicator
                                    pressErrorTitle="Couldn’t open in inbox"
                                    onPress={async () => {
                                        // base64 encode the initial path to hide the fact that it's a URL.
                                        const textEncoder = new TextEncoder();

                                        const newSearchParams = new URLSearchParams(
                                            location.search,
                                        );
                                        newSearchParams.delete("inbox");

                                        const result = convertPeekPathToSpacePathParts(
                                            location.pathname,
                                            newSearchParams,
                                            {routeLayout: "wide"},
                                        );

                                        const newLocation = {
                                            ...location,
                                            pathname:
                                                result?.pathnameParts[1].slice(1) ??
                                                location.pathname.replace(/^\/s\/[^/]+\//, ""),
                                            search: result?.search ?? newSearchParams.toString(),
                                        };

                                        const selectedSearchParam = encodeBase64(
                                            textEncoder.encode(createPath(newLocation)),
                                            "Rfc4648Url",
                                        );

                                        await rootNavigate(
                                            `/s/${space.id}/inbox?${
                                                entry.model.isArchived ? `tab=old&` : ""
                                            }selected=${selectedSearchParam}`,
                                        );
                                    }}
                                >
                                    <ArrowUpRight />
                                </IconButton>
                            )}
                            <Box minWidth="10" flexGrow="1" />
                            {navigation && platform !== "mobile" && (
                                <>
                                    <IconButton
                                        size="xs"
                                        description="Previous notification"
                                        keyboardShortcutHint="↑"
                                        isDisabled={!navigation.previousEntry}
                                        pressErrorTitle="Can’t go to previous notification"
                                        onPress={async () => {
                                            if (!navigation.previousEntry) return;
                                            await navigation.selectEntry(navigation.previousEntry);
                                        }}
                                    >
                                        <CaretUp />
                                    </IconButton>
                                    <IconButton
                                        size="xs"
                                        description="Next notification"
                                        keyboardShortcutHint="↓"
                                        isDisabled={!navigation.nextEntry}
                                        pressErrorTitle="Can’t go to next notification"
                                        onPress={async () => {
                                            if (!navigation.nextEntry) return;
                                            await navigation.selectEntry(navigation.nextEntry);
                                        }}
                                    >
                                        <CaretDown />
                                    </IconButton>
                                    <Spacer space="2.5" />
                                </>
                            )}
                            <Button
                                ref={doneButtonRef}
                                variant={entry.model.isArchived ? "neutral-disabled" : "neutral"}
                                height="6"
                                paddingX="2"
                                icon={<Check />}
                                keyboardShortcutHint={
                                    !entry.model.isArchived
                                        ? isAppleDevice
                                            ? "⌘+D"
                                            : "Ctrl+D"
                                        : undefined
                                }
                                pressErrorTitle="Can’t mark as done"
                                onPress={async () => {
                                    if (!entry.model.isArchived) {
                                        archiveInboxEntry({
                                            entry,
                                            withAnimation: true,
                                        });

                                        if (!navigation && routeLayout === "narrow") {
                                            // Navigate back, if this is in a peek we'll close the peek. If this is on
                                            // mobile we'll go back to inbox.
                                            //
                                            // If this is a wide layout (desktop) then that's because the user expanded
                                            // the notification. Don't navigate if the user took an intentional action to
                                            // expand the peek.
                                            await navigate(-1);
                                        }
                                    }
                                    // This button works as a toggle button. If you click it when the notification
                                    // has already been archived then we'll unarchive.
                                    else {
                                        unarchiveInboxEntry({
                                            entry,
                                            withAnimation: true,
                                        });
                                    }

                                    if (navigation) {
                                        if (navigation.nextEntry) {
                                            await navigation.selectEntry(navigation.nextEntry);
                                        } else if (navigation.previousEntry) {
                                            await navigation.selectEntry(navigation.previousEntry);
                                        } else {
                                            await navigation.selectEntry(null);
                                        }
                                    }
                                }}
                            >
                                Done
                            </Button>
                        </Box>
                        {sidebarRightWidth && routeLayout !== "narrow" ? (
                            <Box height="full" flexShrink="0" width={sidebarRightWidth}></Box>
                        ) : null}
                    </Box>
                </Box>
                <InboxContextProvider entry={entry}>{children}</InboxContextProvider>
            </Box>
        </GlobalKeyDownEvent>
    );
}
