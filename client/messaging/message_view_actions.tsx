import {ArrowArcLeft, DotsThree} from "phosphor-react";
import {MutableRefObject, useState} from "react";
import {useFocusVisible, useFocusWithin} from "react-aria";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {MessageEditing} from "~/client/messaging/message_editing";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    MessageInterface,
    MessageRoomKeyType,
    MessageWithContentPayloadInterface,
} from "~/shared/models/message_interface";

export function MessageViewActions<Message extends MessageInterface>({
    messageNoun,
    message,
    messageEditing,
    isHovered,
    onDeleteMessage,
    isEditing,
    shouldFocusMessageContentEditorRef,
}: {
    messageNoun: string;
    message: MessageWithContentPayloadInterface<MessageRoomKeyType<Message>>;
    messageEditing: MessageEditing<MessageRoomKeyType<Message>>;
    isHovered: boolean;
    onDeleteMessage: () => Promise<void>;
    isEditing: boolean;
    shouldFocusMessageContentEditorRef: MutableRefObject<boolean>;
}) {
    const {currentAccount} = useSpaceContext();

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const isShowingActions =
        !isEditing && (isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen);

    return (
        <Box
            display="flex"
            pointerEvents={!isShowingActions ? "none" : undefined}
            style={{opacity: isShowingActions ? "1" : "0"}}
            {...focusWithinActionsProps}
        >
            <IconButton description="Reply" size="sm" isDisabled={isEditing}>
                <ArrowArcLeft />
            </IconButton>
            {currentAccount.id === message.author.id && (
                <MenuButton
                    actions={[
                        {
                            label: "Edit",
                            onPress: () => {
                                shouldFocusMessageContentEditorRef.current = true;
                                messageEditing.dispatch({
                                    type: "StartEditing",
                                    message,
                                });
                            },
                        },
                        {
                            label: "Delete",
                            pressErrorTitle: `Couldn’t delete ${messageNoun}`,
                            onPress: () => {
                                setShowDeleteConfirmationDialog(true);
                            },
                        },
                    ]}
                    onStateChange={state => setIsMoreMenuOpen(state.isExpanded)}
                >
                    <IconButton description="More" size="sm" isDisabled={isEditing}>
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

function MessageDeleteConfirmationDialog({
    messageNoun,
    onClose,
    onDeleteMessage,
}: {
    messageNoun: string;
    onClose: () => void;
    onDeleteMessage: () => Promise<void>;
}) {
    return (
        <ModalDialog
            title={`Delete ${messageNoun}`}
            description={`Everyone will still be able to see that you sent a ${messageNoun} and the time you sent it, but they will not be able to see what was in the ${messageNoun}.`}
            onClose={onClose}
            isPrimaryButtonDestructive={true}
            primaryButtonLabel="Delete"
            primaryButtonPressErrorTitle={`Couldn’t delete ${messageNoun}`}
            onPrimaryButtonPress={onDeleteMessage}
        />
    );
}
