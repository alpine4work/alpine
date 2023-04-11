import {compareAsc as compareDatesAsc} from "date-fns";
import {Easing, timeline} from "motion";
import {useEffect, useMemo, useRef} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {
    defaultMessageViewMarginX,
    getMessageBubbleMarginLeft,
    messageViewBubbleBorderRadius,
    messageViewMarginY,
} from "~/client/messaging/message_view";
import {easeInOutSin} from "~/shared/design/easing";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {AccountId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_schema";
import {AccountModel} from "~/shared/models/account_model";

export const messagingTypingIndicatorsMinHeight = "3.875rem";

export function MessagingTypingIndicators({
    typingStateByConnectionId,
    marginX = defaultMessageViewMarginX,
}: {
    typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    marginX?: Spacing;
}) {
    // Only select one typing state per account and sort typing states by their
    // start time so they appear in the order users started typing.
    const typingStates = useMemo(() => {
        const typingStateByAccountId = new Map<AccountId, MessagingTypingState>();

        for (const typingState of typingStateByConnectionId.values()) {
            const existingTypingState = typingStateByAccountId.get(typingState.account.id);

            if (!existingTypingState || existingTypingState.startTime < typingState.startTime) {
                typingStateByAccountId.set(typingState.account.id, typingState);
            }
        }

        return Array.from(typingStateByAccountId.values()).sort((typingState1, typingState2) =>
            compareDatesAsc(typingState1.startTime, typingState2.startTime),
        );
    }, [typingStateByConnectionId]);

    return (
        <Box style={{minHeight: messagingTypingIndicatorsMinHeight}}>
            {typingStates.map(typingState => (
                <MessagingTypingIndicator
                    key={typingState.account.id}
                    account={typingState.account}
                    marginX={marginX}
                />
            ))}
        </Box>
    );
}

function MessagingTypingIndicator({account, marginX}: {account: AccountModel; marginX: Spacing}) {
    const dot1Ref = useRef<HTMLDivElement>(null);
    const dot2Ref = useRef<HTMLDivElement>(null);
    const dot3Ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const dot1Element = assertExists(dot1Ref.current);
        const dot2Element = assertExists(dot2Ref.current);
        const dot3Element = assertExists(dot3Ref.current);

        const duration = 0.8;
        const staggerDuration = duration / 6;
        const offset = `${parseRemLengthNumber(spacing["0.5"]) / 2}rem`;
        const easing = easeInOutSin.cubicBezier as Easing;

        const createSequence = (element: HTMLElement): Parameters<typeof timeline>[0] => [
            [element, {y: [`-${offset}`, offset]}, {duration: duration / 2, easing}],
            [element, {y: [offset, `-${offset}`]}, {duration: duration / 2, easing}],
        ];

        const animation1 = timeline(createSequence(dot1Element), {repeat: Infinity});
        const animation2 = timeline(createSequence(dot2Element), {repeat: Infinity});
        const animation3 = timeline(createSequence(dot3Element), {repeat: Infinity});

        // We want the second dot's animation to start in the center. That will be 25%
        // through the animation. We start the whole animation one cycle through so we
        // can stagger our other animation start times.
        animation2.currentTime = duration * 1.25;

        animation1.currentTime = animation2.currentTime - staggerDuration;
        animation3.currentTime = animation2.currentTime + staggerDuration;
    }, []);

    return (
        <Box>
            <Box
                fontSize="50"
                fontStyle="truncate"
                paddingTop="0.5"
                paddingBottom="0.5"
                paddingRight={marginX}
                color="grey-50"
                display="flex"
                alignItems="center"
                gap="0.5"
                style={{
                    paddingLeft: addRemLengths(getMessageBubbleMarginLeft(marginX), spacing["0.5"]),
                }}
            >
                <AccountShortName account={account} />
            </Box>
            <Box display="flex" paddingX={marginX} paddingBottom={messageViewMarginY}>
                <Box flexShrink="0" paddingRight="2">
                    <Box width="7" height="full" display="flex" alignItems="flex-end">
                        <Box paddingY="0.5">
                            <AccountAvatar account={account} size="7" />
                        </Box>
                    </Box>
                </Box>
                <Box display="flex" position="relative">
                    <Box
                        height="8"
                        backgroundColor="grey-5"
                        borderRadius={messageViewBubbleBorderRadius}
                        paddingX="3"
                        display="flex"
                        alignItems="center"
                        gap="1"
                    >
                        <Box
                            ref={dot1Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-60"
                        />
                        <Box
                            ref={dot2Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-60"
                        />
                        <Box
                            ref={dot3Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-60"
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
