import {isToday} from "date-fns";
import {ReactNode, useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PrettyNumber} from "~/client/design/pretty_number";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {LoudNotificationBadge} from "~/client/spaces/loud_notification_badge";
import {useSpaceContext} from "~/client/spaces/space_context";
import {parseRemLengthNumber} from "~/shared/design/spacing";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {AccountModel} from "~/shared/models/account_model";
import {
    InboxChatEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_model";
import {MessageContentWithReferences} from "~/shared/models/message_model";
import {backgroundColorVar, contentSchemaStyles, fontSizesByPlatform} from "~/shared/styles/styles";

export function InboxEntryView({entry}: {entry: InboxEntryModel}) {
    switch (entry.type) {
        case "Chat":
            return <InboxChatEntryView entry={entry} />;
        case "PostComments":
            return <InboxPostCommentsEntryView entry={entry} />;
        default:
            throw exhaustive(entry);
    }
}

function InboxChatEntryView({entry}: {entry: InboxChatEntryModel}) {
    return (
        <InboxEntryViewBase
            firstAccount={entry.latestMessage.author}
            // NOCOMMIT: Add second account here
            // NOCOMMIT: If we have a second account, use it instead of saying "1 other"
            secondAccount={null}
            loudNotificationCount={entry.loudNotificationCount}
        >
            <Box>
                <Box display="inline" fontStyle="semi-bold">
                    <AccountShortName account={entry.latestMessage.author} />
                </Box>{" "}
                sent you
                {entry.chatAccountCount > 2 ? (
                    <>
                        {" "}
                        and <PrettyNumber number={entry.chatAccountCount - 2} label="other" />
                    </>
                ) : null}{" "}
                a chat message
            </Box>
            <InboxEntryLatestMessagePreview latestMessage={entry.latestMessage} />
        </InboxEntryViewBase>
    );
}

function InboxPostCommentsEntryView({entry}: {entry: InboxPostCommentsEntryModel}) {
    const {currentAccount} = useSpaceContext();

    const firstAccount: AccountModel =
        entry.postAuthor.id !== currentAccount.id
            ? entry.postAuthor
            : entry.otherCommentAuthor ?? entry.latestComment.author;

    const secondAccount: AccountModel | null = false
        ? null
        : entry.latestComment.author.id !== firstAccount.id
        ? entry.latestComment.author
        : null;

    return (
        <InboxEntryViewBase
            firstAccount={firstAccount}
            secondAccount={secondAccount}
            loudNotificationCount={entry.loudNotificationCount}
        >
            <Box>
                {currentAccount.id === entry.postAuthor.id ? (
                    "Your"
                ) : (
                    <>
                        <Box display="inline" fontStyle="semi-bold">
                            <AccountShortName account={entry.postAuthor} />
                        </Box>
                        ’s
                    </>
                )}{" "}
                post in{" "}
                <Box display="inline" fontStyle="semi-bold">
                    {entry.channel.name}
                </Box>{" "}
                has new comments
            </Box>
            <InboxEntryLatestMessagePreview latestMessage={entry.latestComment} />
        </InboxEntryViewBase>
    );
}

function InboxEntryViewBase({
    firstAccount,
    secondAccount,
    loudNotificationCount,
    children,
}: {
    firstAccount: AccountModel;
    secondAccount: AccountModel | null;
    loudNotificationCount: number;
    children?: ReactNode;
}) {
    return (
        <Box paddingX="3">
            <Box display="flex" alignItems="center" borderBottom="grey-5" gap="3">
                <Box flexShrink="0" paddingY="3">
                    <Box
                        position="relative"
                        width="10"
                        height="10"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                    >
                        {!secondAccount ? (
                            <AccountAvatar account={firstAccount} size="8" />
                        ) : (
                            <>
                                <Box position="absolute" top="0" left="0">
                                    <AccountAvatar account={firstAccount} size="7" />
                                </Box>
                                <Box
                                    position="absolute"
                                    bottom="0"
                                    right="0"
                                    borderRadius="full"
                                    style={{boxShadow: `0 0 0 2px ${backgroundColorVar}`}}
                                >
                                    <AccountAvatar account={secondAccount} size="7" />
                                </Box>
                            </>
                        )}
                        {loudNotificationCount > 0 && (
                            <LoudNotificationBadge
                                top="1"
                                right="1"
                                loudNotificationCount={loudNotificationCount}
                            />
                        )}
                    </Box>
                </Box>
                <Box paddingY="3" flexGrow="1" fontSize="75" overflow="hidden">
                    {children}
                </Box>
            </Box>
        </Box>
    );
}

function InboxEntryLatestMessagePreview({
    latestMessage,
}: {
    latestMessage: {
        author: AccountModel;
        createdTime: Date;
        contentSnippet: MessageContentWithReferences;
    };
}) {
    const {timeZone} = useClientInfo();

    const isMobile = useIsMobile();
    const contentViewScale =
        fontSizesByPlatform["50"][isMobile ? "mobile" : "desktop"].fontSize /
        fontSizesByPlatform["100"][isMobile ? "mobile" : "desktop"].fontSize;

    return (
        <Box
            style={{
                height: `${
                    parseRemLengthNumber(contentSchemaStyles.paragraphFontSize.lineHeight) *
                    contentViewScale
                }rem`,
            }}
        >
            <Box
                display="flex"
                pointerEvents="none"
                style={{
                    width: `${100 * (1 / contentViewScale)}%`,
                    transformOrigin: "center left",
                    transform: `scale(${contentViewScale})`,
                    // This color is selected to be close to `grey-50`. Ideally we'd use that color
                    // instead of opacity so when the background color changes the colors of the
                    // message stay the same. But we want the arbitrary content in our message
                    // content to also mix with the white background.
                    opacity: 0.575,
                }}
            >
                <Box flexShrink="0" style={contentSchemaStyles.paragraphFontSize} marginRight="-1">
                    <AccountShortName account={latestMessage.author} />:
                </Box>
                <Box flexGrow="1" overflow="hidden">
                    <ContentView
                        content={latestMessage.contentSnippet}
                        isInert={true}
                        isTruncated={true}
                    />
                </Box>
                <Box flexShrink="0" style={contentSchemaStyles.paragraphFontSize} marginLeft="0.5">
                    {useMemo(() => {
                        if (isToday(latestMessage.createdTime)) {
                            const formatter = new Intl.DateTimeFormat("en-US", {
                                timeZone,
                                calendar: "iso8601",
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                            });

                            return formatter.format(latestMessage.createdTime);
                        } else {
                            const formatter = new Intl.DateTimeFormat("en-US", {
                                timeZone,
                                calendar: "iso8601",
                                month: "short",
                                day: "numeric",
                            });

                            return formatter.format(latestMessage.createdTime);
                        }
                    }, [latestMessage.createdTime, timeZone])}
                </Box>
            </Box>
        </Box>
    );
}
