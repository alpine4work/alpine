import {ArrowArcLeft, Check, DotsThree, KeyReturn, SpinnerGap, X} from "phosphor-react";
import {useEffect, useState} from "react";
import {useFocusVisible, useFocusWithin} from "react-aria";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuAction, MenuButton} from "~/client/design/menu_button";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog";
import {MessageEditing} from "~/client/messaging/message_editing";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {MessageContentPayloadModel, MessageModel} from "~/shared/models/message_model";
import {spinAnimationClassName} from "~/shared/styles/styles";

interface MessageViewActionsProps<RoomKey extends string> {
    messageNoun: string;
    message: MessageModel<RoomKey>;
    messagePayload: MessageContentPayloadModel;
    messageEditing: MessageEditing<RoomKey>;
    isHovered: boolean;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    isEditing: boolean;
    getCopyLinkUrl: (messageIndex: number) => URL;
}

export function MessageViewActions<RoomKey extends string>(
    props: MessageViewActionsProps<RoomKey>,
) {
    if (props.isEditing) {
        return <EditingMessageViewActions {...props} />;
    }
    return <StandardMessageViewActions {...props} />;
}

export function EditingMessageViewActions<RoomKey extends string>({
    messageEditing,
    messageNoun,
}: MessageViewActionsProps<RoomKey>) {
    assert(messageEditing.state.isEditing);
    const isSaving = messageEditing.state.isSaving;

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [_shouldShowSavingSpinner, setShouldShowSavingSpinner] = useState(false);
    useEffect(() => {
        if (!isSaving) {
            setShouldShowSavingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowSavingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isSaving]);

    // Only show the saving spinner if we are actually saving.
    const shouldShowSavingSpinner = _shouldShowSavingSpinner && isSaving;

    return (
        <Box display="flex">
            {shouldShowSavingSpinner ? (
                <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
            ) : (
                <>
                    <IconButton
                        description="Save"
                        keyboardShortcutHint={<KeyReturn />}
                        size="sm"
                        onPress={() => {
                            messageEditing.dispatch({
                                type: "SaveEditedContent",
                                messageNoun,
                            });
                        }}
                        isDisabled={isSaving}
                    >
                        <Check />
                    </IconButton>
                    <IconButton
                        description="Cancel"
                        keyboardShortcutHint="esc"
                        size="sm"
                        onPress={() => messageEditing.dispatch({type: "CancelEditing"})}
                        isDisabled={isSaving}
                    >
                        <X />
                    </IconButton>
                </>
            )}
        </Box>
    );
}

export function StandardMessageViewActions<RoomKey extends string>({
    messageNoun,
    message,
    messagePayload,
    messageEditing,
    isHovered,
    onReplyToMessage,
    onDeleteMessage,
    getCopyLinkUrl,
}: MessageViewActionsProps<RoomKey>) {
    const {currentAccount} = useSpaceContext();

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const isShowingActions =
        isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen;

    const actions: Array<MenuAction> = [];

    actions.push({
        label: "Copy link",
        pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
        onPress: async () => {
            await writeTextToClipboard(getCopyLinkUrl(message.index).toString());
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
                    onStateChange={state => setIsMoreMenuOpen(state.isExpanded)}
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
