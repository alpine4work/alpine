import {ArrowUpRight, Check} from "phosphor-react";
import {ReactNode, useCallback, useEffect, useMemo, useRef} from "react";
import {createPath, useLocation} from "react-router";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useDynamoGeneralRealtimeItemBase} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {InboxContextProvider} from "~/client/inbox/inbox_context.js";
import {
    getInboxEntryDisplay,
    printInboxEntryDisplaySummaryWithoutInteractivityStore,
} from "~/client/inbox/inbox_entry_display.js";
import {
    subscribeToArchiveInboxEntryOptimistically,
    subscribeToUnarchiveInboxEntryOptimistically,
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/inbox/use_archive_inbox_entry.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/spaces/space_context.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {getInboxEntryWithStrongReadConsistency} from "~/shared/rpc/notifications_rpc_definitions.js";
import {inboxBannerHeight} from "~/shared/styles/inbox_shared_styles.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";
import {taskDetailViewMaxWidth} from "~/shared/styles/tasks_shared_styles.js";

export function InboxBannerOutletContainer({
    initialEntry,
    withMobileLayout,
    maxWidth,
    borderBottom,
    sidebarRightWidth,
    children,
}: {
    initialEntry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    withMobileLayout: boolean;
    maxWidth: Spacing | "full";
    borderBottom: "grey-5" | "grey-10";
    sidebarRightWidth?: Spacing;
    children?: ReactNode;
}) {
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const {locale, isAppleDevice} = useClientInfo();
    const location = useLocation();
    const accountStore = useAccountClientStore();
    const {space, currentAccount} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();

    const doneButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const entryKey = useMemo(() => initialEntry.model.getKey(), [initialEntry.model]);

    const [entry, updateEntry, updateEntryOptimistically] =
        useStateWithOptimisticUpdates(initialEntry);

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
            isConnected,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
                [subscribeToEvents],
            ),
            reloadItemWithStrongReadConsistency: useCallback(async () => {
                const {entry} = await getInboxEntryWithStrongReadConsistency(context, {
                    spaceId: space.id,
                    key: entryKey,
                });
                return entry;
            }, [context, entryKey, space.id]),
        },
    );

    const entryDisplay = useMemo(
        () => getInboxEntryDisplay({entry: entry.model, locale, currentAccount}),
        [currentAccount, entry.model, locale],
    );

    const entryDisplaySummaryText = useStore(
        useMemo(
            () =>
                printInboxEntryDisplaySummaryWithoutInteractivityStore(
                    accountStore,
                    entryDisplay.summary,
                ),
            [accountStore, entryDisplay.summary],
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
                    zIndex="10"
                    backgroundColor="grey-0"
                    style={{
                        paddingTop: "var(--safe-area-inset-top-base, 0px)",
                        // We use a box shadow to draw the border so it occupies the same space as a
                        // `useNavigationBar()` border when scrolled all the way up. That way we don't
                        // render double borders.
                        boxShadow: `0 1px 0 0 ${colorSchemeVars[borderBottom]}`,
                    }}
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
                            paddingLeft="3"
                            paddingRight="1.5"
                            alignItems="center"
                            width={isInboxEntryTask ? taskDetailViewMaxWidth : "full"}
                        >
                            <Box
                                color="grey-50"
                                fontSize="75"
                                fontStyle="truncate"
                                paddingRight="0.5"
                            >
                                {isMobile
                                    ? "Notification"
                                    : `Notification: ${entryDisplaySummaryText}`}
                            </Box>
                            {!isMobile && (
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

                                        const newLocation = {
                                            ...location,
                                            search: newSearchParams.toString(),
                                        };

                                        const selectedSearchParam = encodeBase64(
                                            textEncoder.encode(
                                                createPath(newLocation).replace(
                                                    /^(\/s\/[^/]+\/(peek\/)?)/,
                                                    "",
                                                ),
                                            ),
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
                            <Button
                                ref={doneButtonRef}
                                variant={entry.model.isArchived ? "neutral-disabled" : "neutral"}
                                height="6"
                                paddingX="2"
                                icon={<Check />}
                                keyboardShortcutHint={isAppleDevice ? "⌘+D" : "Ctrl+D"}
                                pressErrorTitle="Can’t mark as done"
                                onPress={async () => {
                                    if (!entry.model.isArchived) {
                                        archiveInboxEntry({
                                            entry,
                                            withAnimation: true,
                                        });

                                        // Navigate back, if this is in a peek we'll close the peek. If this is on
                                        // mobile we'll go back to inbox.
                                        await navigate(-1);
                                    }
                                    // This button works as a toggle button. If you click it when the notification
                                    // has already been archived then we'll unarchive.
                                    else {
                                        unarchiveInboxEntry({
                                            entry,
                                            withAnimation: true,
                                        });
                                    }
                                }}
                            >
                                Done
                            </Button>
                        </Box>
                        {sidebarRightWidth && !withMobileLayout ? (
                            <Box height="full" flexShrink="0" width={sidebarRightWidth}></Box>
                        ) : null}
                    </Box>
                </Box>
                <InboxContextProvider entry={entry}>{children}</InboxContextProvider>
            </Box>
        </GlobalKeyDownEvent>
    );
}
