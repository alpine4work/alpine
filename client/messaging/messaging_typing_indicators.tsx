import compareDatesAsc from "date-fns/compareAsc/index.js";
import {Easing, timeline} from "motion";
import {Memo, useEffect, useMemo, useRef} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {messagingViewMarginBottom} from "~/client/messaging/messaging_view.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    getMessageBubbleMarginLeft,
    messageViewBubbleBorderRadius,
    messageViewMarginY,
    messageViewMaxWidth,
} from "~/client/styles/messaging_shared_styles.js";
import {easeInOutSin} from "~/shared/design/core/easing.js";
import {
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {AccountId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const messagingTypingIndicatorsMinHeight = "3.875rem";

export function MessagingTypingIndicators({
    typingStateByConnectionId,
    paddingX = screenPaddingX,
    shouldAddMarginTop = false,
    shouldAddMarginBottom = false,
}: {
    typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    paddingX?: Spacing | Memo<{mobile: Spacing; desktop: Spacing}>;
    shouldAddMarginTop?: boolean;
    shouldAddMarginBottom?: boolean | string;
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
        <Box
            style={{
                minHeight: messagingTypingIndicatorsMinHeight,
                paddingTop: shouldAddMarginTop ? messageViewMarginY : undefined,
                paddingBottom: shouldAddMarginBottom
                    ? typeof shouldAddMarginBottom === "string"
                        ? shouldAddMarginBottom
                        : messagingViewMarginBottom
                    : undefined,
            }}
        >
            {typingStates.map(typingState => (
                <MessagingTypingIndicator
                    key={typingState.account.id}
                    account={typingState.account}
                    paddingX={paddingX}
                />
            ))}
        </Box>
    );
}

function MessagingTypingIndicator({
    account,
    paddingX,
}: {
    account: AccountModel;
    paddingX: Spacing | Memo<{mobile: Spacing; desktop: Spacing}>;
}) {
    const isMobile = useIsMobile();

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
        <Box
            width="full"
            maxWidth={messageViewMaxWidth}
            marginX="center"
            position="relative"
            zIndex="0"
        >
            <Box
                fontSize="50"
                fontStyle="truncate"
                paddingTop="0.5"
                paddingBottom="0.5"
                paddingRight={paddingX}
                color="grey-50"
                display="flex"
                alignItems="center"
                gap="0.5"
                style={{
                    paddingLeft: addRemLengths(
                        getMessageBubbleMarginLeft(
                            typeof paddingX === "string"
                                ? paddingX
                                : paddingX[isMobile ? "mobile" : "desktop"],
                        ),
                        spacing["0.5"],
                    ),
                }}
            >
                <AccountShortName account={account} />
            </Box>
            <Box display="flex" paddingX={paddingX} paddingBottom={messageViewMarginY}>
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
