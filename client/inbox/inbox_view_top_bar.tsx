import {Bell, CaretDown, CaretUp, Check} from "phosphor-react";
import {useRef, useState} from "react";
import {useButton} from "react-aria";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {useShowToast} from "~/client/design/toast";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {InboxEntryModel} from "~/shared/models/inbox_model";
import {archiveInboxEntry} from "~/shared/rpc/notifications_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function InboxViewTopBar({
    activeEntry,
    nextEntry,
    previousEntry,
    selectEntry,
    archiveActiveEntryOptimistically,
}: {
    activeEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    nextEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    previousEntry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    selectEntry: (entry: DynamoGeneralRealtimeItem<InboxEntryModel>) => Promise<void>;
    archiveActiveEntryOptimistically: (promise: Promise<unknown>) => void;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const {space} = useSpaceContext();

    const [isArchivePending, setIsArchivePending] = useState(false);

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
                <Box paddingLeft="2" flexShrink="0">
                    <InboxViewTopBarModeToggleButton />
                </Box>
                <Box flexGrow="1" height="full" display="flex" justifyContent="flex-end">
                    <Box height="full" paddingY="2">
                        <Box height="full" borderRight="grey-5" />
                    </Box>
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
                    <Button
                        variant="neutral"
                        height="6"
                        paddingX="2"
                        icon={<Check />}
                        // Don't flash the button into a disabled state because `activeEntry` is
                        // cleared when we optimistically archive the entry.
                        isDisabled={!activeEntry && !isArchivePending}
                        pressErrorTitle="Can’t go to next notification"
                        onPress={async () => {
                            if (!activeEntry) return;

                            setIsArchivePending(true);
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
                                archiveActiveEntryOptimistically(archivePromise);

                                if (nextEntry) {
                                    await selectEntry(nextEntry);
                                } else if (previousEntry) {
                                    await selectEntry(previousEntry);
                                }
                            } finally {
                                setIsArchivePending(false);
                            }
                        }}
                    >
                        Done
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}

function InboxViewTopBarModeToggleButton() {
    const leftButtonRef = useRef<HTMLButtonElement>(null);
    const rightButtonRef = useRef<HTMLButtonElement>(null);

    const isLeftSelected = true;

    const {isPressed: isLeftPressed, buttonProps: leftButtonProps} = useButton(
        {
            onPress: () => {
                // NOCOMMIT
            },
        },
        leftButtonRef,
    );

    const {isPressed: isRightPressed, buttonProps: rightButtonProps} = useButton(
        {
            onPress: () => {
                // NOCOMMIT
            },
        },
        rightButtonRef,
    );

    // NOCOMMIT: This design is confusing...

    return (
        <Box display="flex">
            <FocusRing offset="border">
                <button
                    {...leftButtonProps}
                    ref={leftButtonRef}
                    className={sprinkles({
                        height: "6",
                        paddingX: "2",
                        display: "flex",
                        alignItems: "center",
                        gap: "1",
                        border: "grey-10",
                        borderRight: "none",
                        borderLeftRadius: "base",
                        color: isLeftSelected || isLeftPressed ? "grey-text" : "grey-50",
                        backgroundColor: isLeftPressed
                            ? "grey-10"
                            : isLeftSelected
                            ? "grey-5"
                            : undefined,
                    })}
                >
                    <Bell size={spacing["3"]} />
                    <Box>Inbox</Box>
                </button>
            </FocusRing>
            <FocusRing offset="border">
                <button
                    {...rightButtonProps}
                    ref={rightButtonRef}
                    className={sprinkles({
                        height: "6",
                        paddingX: "2",
                        display: "flex",
                        alignItems: "center",
                        gap: "1",
                        border: "grey-10",
                        borderRightRadius: "base",
                        color: !isLeftSelected || isRightPressed ? "grey-text" : "grey-50",
                        backgroundColor: isRightPressed
                            ? "grey-10"
                            : !isLeftSelected
                            ? "grey-5"
                            : undefined,
                    })}
                >
                    <Check size={spacing["3"]} />
                    <Box>Done</Box>
                </button>
            </FocusRing>
        </Box>
    );
}
