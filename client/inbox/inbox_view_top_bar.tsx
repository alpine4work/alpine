import {ArrowRight, CaretDown, CaretUp, Check} from "phosphor-react";
import {useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {useShowToast} from "~/client/design/toast";
import {isMac} from "~/client/helpers/browser/is_mac";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view";
import {InboxViewTopBarModeToggleButton} from "~/client/inbox/inbox_view_top_bar_mode_toggle_button";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {InboxEntryModel} from "~/shared/notifications/inbox_model";
import {archiveInboxEntry, unarchiveInboxEntry} from "~/shared/rpc/notifications_rpc_definitions";

export function InboxViewTopBar({
    filter,
    activeEntry,
    nextEntry,
    previousEntry,
    selectEntry,
    deleteActiveEntryOptimistically,
}: {
    filter: "New" | "Archive";
    activeEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    nextEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    previousEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    selectEntry: (entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null) => Promise<void>;
    deleteActiveEntryOptimistically: (
        promise: Promise<unknown>,
        options: {withAnimation: boolean},
    ) => void;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    return (
        <Box
            flexShrink="0"
            height="10"
            backgroundColor="grey-0"
            borderBottom="grey-10"
            position="relative"
            zIndex="10"
            display="flex"
        >
            <Box
                flexShrink="0"
                height="full"
                width={inboxEntryWidth}
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" paddingLeft="2" fontSize="200" fontStyle="semi-bold">
                    Inbox
                </Box>
                <Box flexShrink="0" paddingRight="2">
                    <InboxViewTopBarModeToggleButton
                        filter={filter}
                        onNewPress={async () => {
                            if (filter === "New") return;
                            await navigate(`/s/${space.id}/inbox`);
                        }}
                        onArchivePress={async () => {
                            if (filter === "Archive") return;
                            await navigate(`/s/${space.id}/inbox?tab=old`);
                        }}
                    />
                </Box>
                <Box flexShrink="0" height="full" paddingY="2">
                    <Box height="full" borderRight="grey-5" />
                </Box>
            </Box>
            <Box
                flexGrow="1"
                height="full"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
            >
                <Box>
                    <Box flexShrink="0" paddingX="3" display="flex" gap="1">
                        <IconButton
                            size="xs"
                            description="Previous notification"
                            keyboardShortcutHint="↑"
                            isDisabled={!previousEntry}
                            pressErrorTitle="Can’t go to previous notification"
                            onPress={async () => {
                                if (!previousEntry) return;
                                await selectEntry(previousEntry);
                            }}
                        >
                            <CaretUp />
                        </IconButton>
                        <IconButton
                            size="xs"
                            description="Next notification"
                            keyboardShortcutHint="↓"
                            isDisabled={!nextEntry}
                            pressErrorTitle="Can’t go to next notification"
                            onPress={async () => {
                                if (!nextEntry) return;
                                await selectEntry(nextEntry);
                            }}
                        >
                            <CaretDown />
                        </IconButton>
                    </Box>
                </Box>
                <Box paddingX="2">
                    {filter === "New" ? (
                        <InboxViewTopBarArchiveButton
                            activeEntry={activeEntry}
                            nextEntry={nextEntry}
                            previousEntry={previousEntry}
                            selectEntry={selectEntry}
                            deleteActiveEntryOptimistically={deleteActiveEntryOptimistically}
                        />
                    ) : (
                        <InboxViewTopBarUnarchiveButton
                            activeEntry={activeEntry}
                            nextEntry={nextEntry}
                            previousEntry={previousEntry}
                            selectEntry={selectEntry}
                            deleteActiveEntryOptimistically={deleteActiveEntryOptimistically}
                        />
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function InboxViewTopBarArchiveButton({
    activeEntry,
    nextEntry,
    previousEntry,
    selectEntry,
    deleteActiveEntryOptimistically,
}: {
    activeEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    nextEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    previousEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    selectEntry: (entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null) => Promise<void>;
    deleteActiveEntryOptimistically: (
        promise: Promise<unknown>,
        options: {withAnimation: boolean},
    ) => void;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const {space} = useSpaceContext();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isPending, setIsPending] = useState(false);

    // Don't flash the button into a disabled state because `activeEntry` is
    // cleared when we optimistically archive the entry.
    const isDisabled = !activeEntry && !isPending;

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (event.key === "d" && (isMac ? event.metaKey : event.ctrlKey)) {
                    event.preventDefault();
                    event.stopPropagation();

                    // If the button is disabled, navigate when the keyboard shortcut is hit.
                    if (isDisabled) {
                        if (nextEntry) {
                            void selectEntry(nextEntry);
                        } else if (previousEntry) {
                            void selectEntry(previousEntry);
                        }
                    } else {
                        // Programmatically click the button to correctly handle loading and
                        // error states.
                        assertExists(buttonRef.current).click();
                    }
                }
            }}
        >
            <Button
                ref={buttonRef}
                variant="neutral"
                height="6"
                paddingX="2"
                icon={<Check />}
                keyboardShortcutHint={isMac ? "⌘+D" : "Ctrl+D"}
                isDisabled={isDisabled}
                pressErrorTitle="Can’t go to next notification"
                onPress={async () => {
                    if (!activeEntry) return;

                    setIsPending(true);
                    try {
                        const archivePromise = archiveInboxEntry(context, {
                            spaceId: space.id,
                            key: activeEntry.model.getKey(),
                        });

                        archivePromise.catch(error => {
                            showToast({
                                type: "Error",
                                title: "Can’t dismiss notification",
                                error,
                            });
                        });

                        // Immediately delete the item from the query so we don't have to wait for
                        // realtime to respond to this.
                        deleteActiveEntryOptimistically(archivePromise, {
                            // No animation since we are directly dismissing the item.
                            withAnimation: false,
                        });

                        if (nextEntry) {
                            await selectEntry(nextEntry);
                        } else if (previousEntry) {
                            await selectEntry(previousEntry);
                        } else {
                            await selectEntry(null);
                        }
                    } finally {
                        setIsPending(false);
                    }
                }}
            >
                Done
            </Button>
        </GlobalKeyDownEvent>
    );
}

function InboxViewTopBarUnarchiveButton({
    activeEntry,
    nextEntry,
    previousEntry,
    selectEntry,
    deleteActiveEntryOptimistically,
}: {
    activeEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    nextEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    previousEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    selectEntry: (entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null) => Promise<void>;
    deleteActiveEntryOptimistically: (
        promise: Promise<unknown>,
        options: {withAnimation: boolean},
    ) => void;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const {space} = useSpaceContext();
    const [isPending, setIsPending] = useState(false);

    // Don't flash the button into a disabled state because `activeEntry` is
    // cleared when we optimistically archive the entry.
    const isDisabled = !activeEntry && !isPending;

    return (
        <Button
            variant="quiet"
            height="6"
            paddingX="2"
            icon={<ArrowRight />}
            iconPlacement="end"
            isDisabled={isDisabled}
            pressErrorTitle="Can’t go to next notification"
            onPress={async () => {
                if (!activeEntry) return;

                setIsPending(true);
                try {
                    const archivePromise = unarchiveInboxEntry(context, {
                        spaceId: space.id,
                        key: activeEntry.model.getKey(),
                    });

                    archivePromise.catch(error => {
                        showToast({
                            type: "Error",
                            title: "Can’t move notification to new",
                            error,
                        });
                    });

                    // Immediately delete the item from the query so we don't have to wait for
                    // realtime to respond to this.
                    deleteActiveEntryOptimistically(archivePromise, {
                        // No animation since we are directly dismissing the item.
                        withAnimation: false,
                    });

                    if (nextEntry) {
                        await selectEntry(nextEntry);
                    } else if (previousEntry) {
                        await selectEntry(previousEntry);
                    } else {
                        await selectEntry(null);
                    }
                } finally {
                    setIsPending(false);
                }
            }}
        >
            Move to new
        </Button>
    );
}
