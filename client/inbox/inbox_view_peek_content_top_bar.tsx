import {ArrowRight, CaretDown, CaretUp, Check} from "phosphor-react";
import {useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxEntry,
    unarchiveInboxEntry,
} from "~/shared/rpc/notifications_rpc_definitions.js";

export const inboxViewPeekContentTopBarHeight = "10";

export function InboxViewPeekContentTopBar({
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
    return (
        <Box
            position="absolute"
            // Render over overlays at `zIndex="50"`
            zIndex="60"
            top="0"
            left="0"
            right="0"
            height={inboxViewPeekContentTopBarHeight}
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
    const {isAppleDevice} = useClientInfo();
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
                if (event.key === "d" && (isAppleDevice ? event.metaKey : event.ctrlKey)) {
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
                keyboardShortcutHint={isAppleDevice ? "⌘+D" : "Ctrl+D"}
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
