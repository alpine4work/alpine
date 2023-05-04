import {CaretDown, CaretUp, Check} from "phosphor-react";
import {useRef, useState} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {useShowToast} from "~/client/design/toast";
import {isMac} from "~/client/helpers/browser/is_mac";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {assertExists} from "~/shared/helpers/control/assert_exists";
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
                    <InboxViewTopBarModeToggleButton />
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
                    <InboxViewTopBarDoneButton
                        activeEntry={activeEntry}
                        nextEntry={nextEntry}
                        previousEntry={previousEntry}
                        selectEntry={selectEntry}
                        archiveActiveEntryOptimistically={archiveActiveEntryOptimistically}
                    />
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

    const {isHovered: isLeftHovered, hoverProps: leftHoverProps} = useHover({});
    const {isHovered: isRightHovered, hoverProps: rightHoverProps} = useHover({});

    return (
        <Box display="flex" gap="1.5">
            <FocusRing offset="0">
                <button
                    {...mergeProps(leftButtonProps, leftHoverProps)}
                    ref={leftButtonRef}
                    className={sprinkles({
                        height: "6",
                        paddingX: "2",
                        display: "flex",
                        alignItems: "center",
                        borderRadius: "base",
                        color: isLeftSelected || isRightPressed ? "grey-text" : "grey-50",
                        backgroundColor: isLeftPressed
                            ? "grey-10"
                            : isLeftSelected || isLeftHovered
                            ? "grey-5"
                            : undefined,
                    })}
                >
                    <Box>New</Box>
                </button>
            </FocusRing>
            <FocusRing offset="0">
                <button
                    {...mergeProps(rightButtonProps, rightHoverProps)}
                    ref={rightButtonRef}
                    className={sprinkles({
                        height: "6",
                        paddingX: "2",
                        display: "flex",
                        alignItems: "center",
                        borderRadius: "base",
                        color: !isLeftSelected || isRightPressed ? "grey-text" : "grey-50",
                        backgroundColor: isRightPressed
                            ? "grey-10"
                            : !isLeftSelected || isRightHovered
                            ? "grey-5"
                            : undefined,
                    })}
                >
                    <Box>Old</Box>
                </button>
            </FocusRing>
        </Box>
    );
}

function InboxViewTopBarDoneButton({
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
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isPending, setIsPending] = useState(false);

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
                // Don't flash the button into a disabled state because `activeEntry` is
                // cleared when we optimistically archive the entry.
                isDisabled={!activeEntry && !isPending}
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
                        archiveActiveEntryOptimistically(archivePromise);

                        if (nextEntry) {
                            await selectEntry(nextEntry);
                        } else if (previousEntry) {
                            await selectEntry(previousEntry);
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
