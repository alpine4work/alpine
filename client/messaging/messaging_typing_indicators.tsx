import {compareAsc as compareDatesAsc} from "date-fns/compareAsc";
import {Easing, animate} from "motion";
import {useEffect, useMemo, useRef} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewMarginY,
    messageViewMinHeightPx,
    messageViewRailGap,
    messagingTypingIndicatorsMinHeightPx,
    messagingViewMarginBottom,
} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {easeInOutSin, parseCubicBezier} from "~/shared/design/core/easing.js";
import {parseRemLength, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {AccountId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function MessagingTypingIndicators({
    typingStateByConnectionId,
    shouldAddMarginTop = false,
    shouldAddMarginBottom = false,
}: {
    typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    shouldAddMarginTop?: boolean;
    shouldAddMarginBottom?: boolean | string;
}) {
    const spacingScale = useSpacingScale();

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
                minHeight: messagingTypingIndicatorsMinHeightPx[spacingScale],
                paddingTop: shouldAddMarginTop ? spacing[messageViewMarginY] : undefined,
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
                />
            ))}
        </Box>
    );
}

function MessagingTypingIndicator({account}: {account: AccountModel}) {
    const spacingScale = useSpacingScale();

    const dot1Ref = useRef<HTMLDivElement>(null);
    const dot2Ref = useRef<HTMLDivElement>(null);
    const dot3Ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const dot1Element = assertExists(dot1Ref.current);
        const dot2Element = assertExists(dot2Ref.current);
        const dot3Element = assertExists(dot3Ref.current);

        const duration = 0.8;
        const staggerDuration = duration / 6;
        const offset = `${parseRemLength("0.5") / 2}rem`;
        const ease: Easing = parseCubicBezier(easeInOutSin.cubicBezier);

        const createSequence = (element: HTMLElement): Array<{}> => [
            [element, {y: [`-${offset}`, offset]}, {duration: duration / 2, ease}],
            [element, {y: [offset, `-${offset}`]}, {duration: duration / 2, ease}],
        ];

        const animation1 = animate(createSequence(dot1Element), {repeat: Infinity});
        const animation2 = animate(createSequence(dot2Element), {repeat: Infinity});
        const animation3 = animate(createSequence(dot3Element), {repeat: Infinity});

        // We want the second dot's animation to start in the center. That will be 25%
        // through the animation. We start the whole animation one cycle through so we
        // can stagger our other animation start times.
        animation2.time = duration * 1.25;

        animation1.time = animation2.time - staggerDuration;
        animation3.time = animation2.time + staggerDuration;
    }, []);

    return (
        <Box
            flexShrink="0"
            width="full"
            maxWidth={contentStyles.contentMaxWidth}
            marginX="center"
            paddingX={screenPaddingX}
            paddingBottom={messageViewMarginY}
            style={{
                minHeight: messageViewMinHeightPx[spacingScale],
            }}
        >
            <Box position="relative" zIndex="0" display="flex" gap={messageViewRailGap}>
                <Box flexShrink="0" width={messageViewAccountAvatarSize}>
                    <Box
                        position="relative"
                        style={{top: messageViewAvatarOffsetYPx[spacingScale]}}
                    >
                        <AccountAvatar account={account} size={messageViewAccountAvatarSize} />
                    </Box>
                </Box>
                <Box flexGrow="1">
                    <Box
                        fontSize={messageViewAccountNameFontSize}
                        fontStyle="truncate"
                        color="grey-60"
                        style={{
                            lineHeight: spacing[messageViewAccountNameHeight],
                        }}
                    >
                        {useAccountModel(account).name}
                    </Box>
                    <Box
                        paddingLeft="0.5"
                        display="flex"
                        alignItems="center"
                        gap="1"
                        style={{height: contentStyles.paragraphLineHeightPx[spacingScale]}}
                    >
                        <Box
                            ref={dot1Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-100"
                        />
                        <Box
                            ref={dot2Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-100"
                        />
                        <Box
                            ref={dot3Ref}
                            width="1"
                            height="1"
                            borderRadius="full"
                            backgroundColor="grey-100"
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
