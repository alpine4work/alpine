import {isToday} from "date-fns";
import {AnimationControls, animate} from "motion";
import {ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {PrettyNumber} from "~/client/design/pretty_number";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {useSpaceContext} from "~/client/spaces/space_context";
import {Spacing, parseRemLengthNumber} from "~/shared/design/spacing";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {AccountModel} from "~/shared/models/account_model";
import {
    InboxChatEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/models/inbox_model";
import {MessageContentWithReferences} from "~/shared/models/message_model";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentSchemaStyles,
    fontSizesByPlatform,
    sprinkles,
} from "~/shared/styles/styles";

export const inboxEntryViewMinHeight = "4rem";
export const inboxEntryWidth: Spacing = "96";

const inboxEntryDeleteAnimationFadeDurationMs = 150;
const inboxEntryDeleteAnimationSlideDurationMs = 230;
const inboxEntryDeleteAnimationSlideDelayDurationMs = 70;
export const inboxEntryDeleteAnimationDurationMs =
    inboxEntryDeleteAnimationSlideDelayDurationMs + inboxEntryDeleteAnimationSlideDurationMs;

export function InboxEntryView({
    entry,
    isSelected = false,
    onPressStart,
    onPress,
    isFirstEntry,
    isLastEntry,
    withinOverlay = false,
    "aria-setsize": ariaSetsize,
    "aria-posinset": ariaPosinset,
    deletedItemAnimation = null,
}: {
    entry: InboxEntryModel;
    isSelected?: boolean;
    onPressStart?: () => void;
    onPress?: () => void;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    withinOverlay?: boolean;
    // Because entries are virtualized, we need to set these properties so screen
    // readers can correctly announce what position the user is in no matter
    // what's in the DOM.
    // https://w3c.github.io/aria/#aria-setsize
    "aria-setsize"?: number;
    "aria-posinset"?: number;
    deletedItemAnimation?: {
        offset: number;
        deletedItem: {item: DynamoGeneralRealtimeItem<InboxEntryModel>};
    } | null;
}) {
    const entryRef = useRef<HTMLDivElement>(null);
    const [isPressed, setIsPressed] = useState(false);

    const lastDeletedItemAnimationRef = useRef(deletedItemAnimation);
    const lastAnimationRef = useRef<AnimationControls | null>(null);
    useEffect(() => {
        if (lastDeletedItemAnimationRef.current === deletedItemAnimation) return;
        lastDeletedItemAnimationRef.current = deletedItemAnimation;

        const entryElement = assertExists(entryRef.current);
        lastAnimationRef.current?.cancel();
        lastAnimationRef.current = null;

        // Reset any animated values.
        animate(entryElement, {opacity: 1, y: 0}, {duration: 0});

        if (!deletedItemAnimation) return;

        if (deletedItemAnimation.deletedItem.item.model === entry) {
            lastAnimationRef.current = animate(
                entryElement,
                {opacity: 0},
                {
                    easing: "linear",
                    duration: inboxEntryDeleteAnimationFadeDurationMs / 1000,
                },
            );
        } else {
            lastAnimationRef.current = animate(
                entryElement,
                {y: -deletedItemAnimation.offset},
                {
                    easing: "ease",
                    duration: inboxEntryDeleteAnimationSlideDurationMs / 1000,
                    delay: inboxEntryDeleteAnimationSlideDelayDurationMs / 1000,
                },
            );
        }
    }, [deletedItemAnimation, entry]);

    let children;
    switch (entry.type) {
        case "Chat":
            children = <InboxChatEntryView entry={entry} />;
            break;
        case "PostComments":
            children = <InboxPostCommentsEntryView entry={entry} />;
            break;
        default:
            throw exhaustive(entry);
    }

    return (
        <Box
            ref={entryRef}
            // Our inbox implements the ARIA `listbox` role.
            // https://www.w3.org/WAI/ARIA/apg/patterns/listbox
            role="option"
            aria-selected={isSelected}
            aria-setsize={ariaSetsize}
            aria-posinset={ariaPosinset}
            paddingX="1"
            paddingTop={isFirstEntry ? "1" : undefined}
            paddingBottom={isLastEntry ? "1" : undefined}
            style={{minHeight: inboxEntryViewMinHeight}}
            // NOTE(calebmer): Not using `usePress()` here because that hook does something
            // weird with `event.preventDefault()` that causes the listbox in `<InboxView>`
            // to not be focused after a click.
            onPointerDown={() => {
                setIsPressed(true);
                onPressStart?.();
            }}
            onPointerUp={() => {
                const wasPressed = isPressed;
                setIsPressed(false);
                if (wasPressed) onPress?.();
            }}
            onPointerLeave={() => {
                setIsPressed(false);
            }}
        >
            <Box
                paddingX="3"
                borderRadius="md"
                backgroundColor={
                    isPressed && withinOverlay ? "grey-10" : isSelected ? "grey-5" : undefined
                }
                style={{
                    // Add an extra pixel of padding so the background color covers the
                    // border rendered with `boxShadow`.
                    paddingBottom: 1,
                    marginBottom: -1,
                }}
            >
                <Box
                    display="flex"
                    alignItems="center"
                    gap="3"
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow:
                            !(isPressed && withinOverlay) && !isSelected
                                ? `0 1px 0 0 ${colorSchemeVars["grey-5"]}`
                                : undefined,
                    }}
                >
                    {children}
                </Box>
            </Box>
        </Box>
    );
}

const boldClassName = sprinkles({
    fontStyle: "bold",
});

function InboxChatEntryView({entry}: {entry: InboxChatEntryModel}) {
    const firstAccount = entry.otherChatAccount ?? entry.latestMessage.author;

    const secondAccount =
        entry.latestMessage.author.id !== firstAccount.id ? entry.latestMessage.author : null;

    return (
        <InboxEntryViewBase
            firstAccount={firstAccount}
            secondAccount={secondAccount}
            loudNotificationCount={entry.loudNotificationCount}
        >
            <Box>
                <span className={boldClassName}>
                    <AccountShortName account={entry.latestMessage.author} />
                </span>{" "}
                sent you
                {entry.chatAccountCount === 3 && entry.otherChatAccount ? (
                    <>
                        {" "}
                        and{" "}
                        <span className={boldClassName}>
                            <AccountShortName account={entry.otherChatAccount} />
                        </span>
                    </>
                ) : entry.chatAccountCount > 2 ? (
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
                        <span className={boldClassName}>
                            <AccountShortName account={entry.postAuthor} />
                        </span>
                        ’s
                    </>
                )}{" "}
                post in <span className={boldClassName}>{entry.channel.name}</span> has new comments
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
        <>
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
                        <AccountAvatar account={firstAccount} size="9" />
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
                            top="0"
                            right="1"
                            loudNotificationCount={loudNotificationCount}
                        />
                    )}
                </Box>
            </Box>
            <Box paddingY="3" flexGrow="1" fontSize="75" overflow="hidden">
                {children}
            </Box>
        </>
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
            // Do not read the message preview for screen reader users. It will likely be
            // confusing as the text cuts off eventually.
            aria-hidden={true}
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
                    //
                    // Experimentally, `grey-text` at 0.59 opacity looks identical to `grey-50` in
                    // light mode and `grey-text` at 0.61 opacity looks identical to `grey-50` in
                    // dark mode. Splitting the difference with 0.6.
                    opacity: 0.6,
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
