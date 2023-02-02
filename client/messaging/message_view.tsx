import {differenceInMinutes} from "date-fns";
import {ArrowArcLeft, DotsThree} from "phosphor-react";
import {useState} from "react";
import {useFocusVisible, useFocusWithin, useHover} from "react-aria";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useSpaceContext} from "~/client/spaces/space_context";
import {RemLength} from "~/shared/design/spacing";
import {MessageInterface} from "~/shared/models/message_interface";
import {truncateClassName} from "~/shared/styles/styles";

export const messageViewMinHeight: RemLength = "2.625rem";

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

const mergeMessageMinuteLimit = 5;

export function MessageView({
    message,
    previousMessage,
    nextMessage,
}: {
    message: MessageInterface;
    previousMessage: MessageInterface | null;
    nextMessage: MessageInterface | null;
}) {
    const {currentAccount} = useSpaceContext();

    const shouldMergeWithPreviousMessage =
        previousMessage &&
        previousMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(message.createdTime, previousMessage.createdTime)) <
            mergeMessageMinuteLimit;
    const shouldMergeWithNextMessage =
        nextMessage &&
        nextMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(nextMessage.createdTime, message.createdTime)) <
            mergeMessageMinuteLimit;

    const {isHovered, hoverProps} = useHover({});
    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

    const isShowingActions =
        isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen;

    return (
        <Box>
            {!shouldMergeWithPreviousMessage && (
                <Box
                    fontSize="xs"
                    paddingY="0.5"
                    paddingLeft="16"
                    paddingRight="2"
                    color="grey-50"
                    className={truncateClassName}
                >
                    {message.author.name}
                </Box>
            )}
            <Box
                display="flex"
                paddingX="3"
                paddingBottom={!shouldMergeWithNextMessage ? "3" : "0.5"}
                {...hoverProps}
            >
                <Box flexShrink="0" width="10" display="flex" alignItems="flex-end">
                    {!shouldMergeWithNextMessage && <AccountAvatar account={message.author} />}
                </Box>
                <Box
                    backgroundColor="grey-5"
                    maxWidth="160"
                    display="inline-block"
                    paddingX="1"
                    paddingY="2"
                    borderTopLeftRadius={!shouldMergeWithPreviousMessage ? "2xl" : undefined}
                    borderTopRightRadius="2xl"
                    borderBottomLeftRadius={!shouldMergeWithNextMessage ? "2xl" : undefined}
                    borderBottomRightRadius="2xl"
                >
                    <ContentView content={message.content} onNavigate={useNavigate()} />
                </Box>
                <Box
                    alignSelf="center"
                    paddingLeft="3"
                    display="flex"
                    style={{opacity: isShowingActions ? "1" : "0"}}
                    {...focusWithinActionsProps}
                >
                    <IconButton
                        description="Reply"
                        size="sm"
                        withoutTooltip={isHovered && !isShowingActions}
                    >
                        <ArrowArcLeft />
                    </IconButton>
                    {currentAccount.id === message.author.id && (
                        <MenuButton
                            actions={[
                                {
                                    label: "Edit",
                                    onPress: () => {
                                        // TODO(calebmer): Implement!
                                    },
                                },
                                {
                                    label: "Delete",
                                    onPress: () => {
                                        // TODO(calebmer): Implement!
                                    },
                                },
                            ]}
                            onStateChange={state => setIsMoreMenuOpen(state.isExpanded)}
                        >
                            <IconButton
                                description="More"
                                size="sm"
                                withoutTooltip={isHovered && !isShowingActions}
                            >
                                <DotsThree />
                            </IconButton>
                        </MenuButton>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
