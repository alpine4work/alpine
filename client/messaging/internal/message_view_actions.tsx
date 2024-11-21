import {ArrowArcLeft, DotsThree} from "phosphor-react";
import {useRef, useState} from "react";
import {useFocusVisible, useFocusWithin} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageViewMenuCreatedTime} from "~/client/messaging/internal/message_view_menu_created_time.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {overlayFadeOutAnimationDurationMs} from "~/client/styles/styles.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {MessageContentPayloadModel, MessageModel} from "~/shared/messaging/message_model.js";

export function MessageViewActions<RoomKey extends string>({
    messageNoun,
    message,
    messagePayload,
    messageEditing,
    isHovered,
    onReplyToMessage,
    onShowDeleteConfirmationDialog,
    getMessageUrl,
}: {
    messageNoun: string;
    message: MessageModel<RoomKey>;
    messagePayload: MessageContentPayloadModel;
    messageEditing: MessageEditing<RoomKey>;
    isHovered: boolean;
    onReplyToMessage: () => void;
    onShowDeleteConfirmationDialog: () => void;
    getMessageUrl: (messageIndex: number) => URL;
}) {
    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const setIsMoreMenuOpenTimeoutRef = useRef<Timeout | null>(null);

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
                    platform,
                    returnFocusAfterEditing: null,
                });
            },
        });

        actions.push({
            label: "Delete",
            pressErrorTitle: `Couldn’t delete ${messageNoun}`,
            onPress: onShowDeleteConfirmationDialog,
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

                        const nextIsMoreMenuOpen = state.isExpanded;
                        if (isMoreMenuOpen && !nextIsMoreMenuOpen) {
                            // Wait a bit before setting `isMoreMenuOpen` to false so `isHovered` state can
                            // become true and actions don't temporarily blink out of existence.
                            setIsMoreMenuOpenTimeoutRef.current = createTimeout(() => {
                                setIsMoreMenuOpenTimeoutRef.current = null;
                                setIsMoreMenuOpen(nextIsMoreMenuOpen);
                            }, (!state.disableAnimationOut ? overlayFadeOutAnimationDurationMs : 0) + perceivedAsInstantLimitMs);
                        } else {
                            setIsMoreMenuOpen(nextIsMoreMenuOpen);
                        }
                    }}
                    extraOverlayBottom={
                        <MessageViewMenuCreatedTime
                            createdTime={message.createdTime}
                            // Never show the updated time in actions since the user can see it by hovering
                            // over the "(edited)" text. We only show the updated time on platforms where the
                            // user can't hover.
                            contentUpdatedTime={null}
                        />
                    }
                >
                    <IconButton description="More" size="sm">
                        <DotsThree />
                    </IconButton>
                </MenuButton>
            )}
        </Box>
    );
}
