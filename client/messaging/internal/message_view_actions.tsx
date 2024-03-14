import {ArrowArcLeft, DotsThree} from "phosphor-react";
import {useRef, useState} from "react";
import {useFocusVisible, useFocusWithin} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {MessageContentPayloadModel, MessageModel} from "~/shared/messaging/message_model.js";

export function MessageViewActions<RoomKey extends string>({
    messageNoun,
    message,
    messagePayload,
    messageEditing,
    isHovered,
    onReplyToMessage,
    onDeleteMessage,
    getMessageUrl,
}: {
    messageNoun: string;
    message: MessageModel<RoomKey>;
    messagePayload: MessageContentPayloadModel;
    messageEditing: MessageEditing<RoomKey>;
    isHovered: boolean;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    isEditing: boolean;
    getMessageUrl: (messageIndex: number) => URL;
}) {
    const {currentAccount} = useSpaceContext();

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const setIsMoreMenuOpenTimeoutRef = useRef<Timeout | null>(null);
    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const isShowingActions =
        isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen;

    const actions: Array<MenuAction> = [];

    actions.push({
        label: "Copy link",
        pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
        onPress: async () => {
            await writeTextToClipboard(getMessageUrl(message.index).toString());
        },
    });

    if (currentAccount.id === message.author.id) {
        actions.push({
            label: "Edit",
            onPress: () => {
                messageEditing.dispatch({
                    type: "StartEditing",
                    messageIndex: message.index,
                    messageRoomKey: message.getRoomKey(),
                    messagePayload,
                    returnFocusAfterEditing: null,
                });
            },
        });

        actions.push({
            label: "Delete",
            pressErrorTitle: `Couldn’t delete ${messageNoun}`,
            onPress: () => {
                setShowDeleteConfirmationDialog(true);
            },
        });
    }

    return (
        <Box
            display="flex"
            pointerEvents={!isShowingActions ? "none" : undefined}
            style={{opacity: isShowingActions ? "1" : "0"}}
            {...focusWithinActionsProps}
        >
            <IconButton description="Reply" size="sm" onPress={onReplyToMessage}>
                <ArrowArcLeft />
            </IconButton>
            {actions.length > 0 && (
                <MenuButton
                    actions={actions}
                    onStateChange={state => {
                        setIsMoreMenuOpenTimeoutRef.current?.clear();
                        setIsMoreMenuOpenTimeoutRef.current = null;

                        const nextIsMoreMenuOpen = state.isExpanded || state.isFadingOut;
                        if (isMoreMenuOpen && !nextIsMoreMenuOpen) {
                            // Wait a bit before setting `isMoreMenuOpen` to false so `isHovered` state can
                            // become true and actions don't temporarily blink out of existence.
                            setIsMoreMenuOpenTimeoutRef.current = createTimeout(() => {
                                setIsMoreMenuOpenTimeoutRef.current = null;
                                setIsMoreMenuOpen(nextIsMoreMenuOpen);
                            }, perceivedAsInstantLimitMs);
                        } else {
                            setIsMoreMenuOpen(nextIsMoreMenuOpen);
                        }
                    }}
                >
                    <IconButton description="More" size="sm">
                        <DotsThree />
                    </IconButton>
                </MenuButton>
            )}
            {showDeleteConfirmationDialog && (
                <MessageDeleteConfirmationDialog
                    messageNoun={messageNoun}
                    onClose={() => setShowDeleteConfirmationDialog(false)}
                    onDeleteMessage={onDeleteMessage}
                />
            )}
        </Box>
    );
}
