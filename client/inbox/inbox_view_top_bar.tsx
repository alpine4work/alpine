import {Bell, CaretDown, CaretUp, Check} from "phosphor-react";
import {useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {inboxEntryWidth} from "~/client/inbox/inbox_entry_view";
import {spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

export function InboxViewTopBar() {
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
                            // NOCOMMIT
                            // keyboardShortcutHint={isMac ? "⌘+Shift+," : "Ctrl+Shift+,"}
                            // isDisabled={!previousCommentThreadId}
                            pressErrorTitle="Can’t go to previous notification"
                            onPress={async () => {
                                // NOCOMMIT
                                // if (!previousCommentThreadId) return;
                                // await openCommentThread(previousCommentThreadId);
                            }}
                        >
                            <CaretUp />
                        </IconButton>
                        <IconButton
                            size="xs"
                            description="Next notification"
                            // NOCOMMIT
                            // keyboardShortcutHint={isMac ? "⌘+Shift+." : "Ctrl+Shift+."}
                            // isDisabled={!nextCommentThreadId}
                            pressErrorTitle="Can’t go to next notification"
                            onPress={async () => {
                                // NOCOMMIT
                                // if (!nextCommentThreadId) return;
                                // await openCommentThread(nextCommentThreadId);
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
                        onPress={() => {
                            // NOCOMMIT
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

    return (
        <Box display="flex">
            <FocusRing offset="border">
                <button
                    {...leftButtonProps}
                    ref={leftButtonRef}
                    className={sprinkles({
                        height: "6",
                        paddingX: "3",
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
                        paddingX: "3",
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
