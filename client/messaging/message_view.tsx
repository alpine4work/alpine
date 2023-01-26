import {differenceInMinutes} from "date-fns";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {RemLength} from "~/shared/design/spacing";
import {MessageInterface} from "~/shared/models/message_interface";
import {truncateClassName} from "~/shared/styles/styles";

export const messageViewMinHeight: RemLength = "2.625rem";

/**
 * The estimated height we use for virtualized message views.
 */
export const estimatedMessageViewHeight: RemLength = "4rem";

const mergeMessageMinuteLimit = 5;

export function MessageView({
    message,
    lastMessage,
    nextMessage,
}: {
    message: MessageInterface;
    lastMessage: MessageInterface | null;
    nextMessage: MessageInterface | null;
}) {
    const shouldMergeWithLastMessage =
        lastMessage &&
        lastMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(message.createdTime, lastMessage.createdTime)) <
            mergeMessageMinuteLimit;
    const shouldMergeWithNextMessage =
        nextMessage &&
        nextMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(nextMessage.createdTime, message.createdTime)) <
            mergeMessageMinuteLimit;

    return (
        <Box display="flex" paddingX="3" paddingBottom={!shouldMergeWithNextMessage ? "3" : "0.5"}>
            <Box flexShrink="0" width="10" display="flex" alignItems="flex-end">
                {!shouldMergeWithNextMessage && <AccountAvatar account={message.author} />}
            </Box>
            <Box>
                {!shouldMergeWithLastMessage && (
                    <Box
                        fontSize="xs"
                        paddingY="0.5"
                        paddingLeft="2"
                        color="grey-50"
                        className={truncateClassName}
                    >
                        {message.author.name}
                    </Box>
                )}
                <Box
                    backgroundColor="grey-5"
                    maxWidth="160"
                    display="inline-block"
                    paddingX="1"
                    paddingY="2"
                    borderTopLeftRadius={!shouldMergeWithLastMessage ? "xl" : undefined}
                    borderTopRightRadius="xl"
                    borderBottomLeftRadius={!shouldMergeWithNextMessage ? "xl" : undefined}
                    borderBottomRightRadius="xl"
                >
                    <ContentView content={message.content} onNavigate={useNavigate()} />
                </Box>
            </Box>
        </Box>
    );
}
