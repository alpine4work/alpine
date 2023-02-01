import {differenceInMinutes} from "date-fns";
import {ArrowArcLeft, DotsThree} from "phosphor-react";
import {useEffect, useState} from "react";
import {useFocusVisible, useFocusWithin, useHover} from "react-aria";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {RemLength} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
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

    // Putting a delay on showing actions after a hover makes it feel more
    // deliberate. You don't get flashing actions whenever you move your mouse.
    const [isShowingActionsFromHover, setIsShowingActionsFromHover] = useState(false);

    useEffect(() => {
        if (!isHovered) {
            setIsShowingActionsFromHover(false);
            return;
        }

        const timeout = createTimeout(() => {
            setIsShowingActionsFromHover(true);
        }, perceivedAsInstantLimitMs);

        return () => {
            timeout.clear();
        };
    }, [isHovered]);

    const isShowingActions =
        isShowingActionsFromHover || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen;

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
                    style={{
                        opacity: isShowingActions ? "1" : "0",
                        transition:
                            isFocusWithinActions && isFocusVisible
                                ? undefined
                                : "opacity 100ms ease-in",
                    }}
                    {...focusWithinActionsProps}
                >
                    <IconButton
                        description="Reply"
                        size="sm"
                        withoutTooltip={isHovered && !isShowingActions}
                    >
                        <ArrowArcLeft />
                    </IconButton>
                    <MenuButton
                        actions={[
                            {
                                label: "Edit",
                                onPress: () => {},
                            },
                            {
                                label: "Delete",
                                onPress: () => {},
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
                </Box>
            </Box>
        </Box>
    );
}
