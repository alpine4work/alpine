import {EnvelopeSimple, X} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Link} from "~/client/web/design/link.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {Modal} from "~/client/web/design/modal.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {BlueskyLogo} from "~/client/web/icons/socials/bluesky_logo.js";
import {RedditLogo} from "~/client/web/icons/socials/reddit_logo.js";
import {ThreadsLogo} from "~/client/web/icons/socials/threads_logo.js";
import {XLogo} from "~/client/web/icons/socials/x_logo.js";
import {ReactionPartyBase} from "~/client/web/reactions/reaction_party.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, invertLightSelectionColorsClassName} from "~/client/web/styles/styles.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

const reactions: Array<Reaction> = [
    {character: {type: "Tree", variant: "Green"}, emotion: "Celebrate"},
    {character: {type: "Pigeon", variant: "Brown"}, emotion: "Heart"},
    {character: {type: "Cat", variant: "Yellow"}, emotion: "Celebrate"},
    {character: {type: "Tulip", variant: "Pink"}, emotion: "Celebrate"},
    {character: {type: "Yeti", variant: "Blue"}, emotion: "Heart"},
    {character: {type: "Pigeon", variant: "Plain"}, emotion: "Celebrate"},
    {character: {type: "Frog", variant: "Green"}, emotion: "Celebrate"},
];

const reactionSet = new ReactionSet(
    new Map(reactions.map((reaction, index) => [`stubbedAccount${index}` as AccountId, reaction])),
);

function PurchasedLifetimeAccessModalContent({platform}: {platform: "mobile" | "desktop"}) {
    return (
        <Box padding="4" display="flex" flexDirection="column" alignItems="center" gap="3">
            <Box style={{transform: "scale(1.5)"}} padding="5">
                <ReactionPartyBase reactions={reactionSet} randomSeed="unimportantRandom" />
            </Box>
            <Box
                fontSize="400"
                fontStyle="bold"
                textAlign="center"
                maxWidth={platform === "mobile" ? "64" : undefined}
                color="grey-100"
            >
                Thank you for purchasing lifetime access
            </Box>
            <Box width="full" textAlign="center" color="grey-70" fontSize="100">
                Together, we&#x2019;ll build the future of work
            </Box>
            <Spacer space="8" />
            <Box
                display="flex"
                justifyContent="center"
                gap="3"
                color="grey-90"
                fontSize="100"
                flexWrap="wrap"
                maxWidth={platform === "mobile" ? "64" : undefined}
            >
                <Link url="mailto:feedback@alpine.inc">
                    <Box display="flex" alignItems="center" gap="1">
                        <EnvelopeSimple color={colorSchemeVars["grey-100"]} size="1.2rem" /> Email
                    </Box>
                </Link>
                <Link url="https://x.com/alpine4work">
                    <Box display="flex" alignItems="center" gap="1">
                        <XLogo style={{height: "0.9rem", width: "0.9rem"}} /> X
                    </Box>
                </Link>
                <Link url="https://bsky.app/profile/alpine.inc">
                    <Box paddingLeft="1" display="flex" alignItems="center" gap="1">
                        <BlueskyLogo style={{height: "1rem", width: "1rem"}} /> Bluesky
                    </Box>
                </Link>
                <Link url="https://www.threads.com/@alpine4work">
                    <Box paddingLeft="1" display="flex" alignItems="center" gap="1">
                        <ThreadsLogo style={{height: "1rem", width: "1rem"}} /> Threads
                    </Box>
                </Link>
                <Link url="https://www.reddit.com/r/alpine4work/">
                    <Box
                        paddingLeft="1"
                        display="flex"
                        alignItems="center"
                        gap="1"
                        style={{textDecoration: "underline"}}
                    >
                        <RedditLogo style={{height: "1rem", width: "1rem"}} /> Reddit
                    </Box>
                </Link>
            </Box>
        </Box>
    );
}

function PurchasedLifetimeAccessModalMobile({onClose}: {onClose: () => void}) {
    return (
        <MobileFullScreenModal onClose={onClose}>
            {({onCloseWithAnimation}) => (
                <Box position="relative" width="full" height="full" overflow="hidden">
                    <Box
                        zIndex="10"
                        position="absolute"
                        top="0"
                        left="0"
                        right="0"
                        paddingTop="safe-area-inset"
                    >
                        <Box zIndex="-10" position="absolute" inset="0" opacity="80" />
                        <Box
                            height={navigationBarHeight}
                            paddingX={navigationBarMobileGap}
                            gap={navigationBarMobileGap}
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                        >
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Close"
                                withoutTooltip
                                onPress={() => onCloseWithAnimation()}
                            >
                                <X />
                            </IconButton>
                        </Box>
                    </Box>
                    <Box
                        zIndex="0"
                        position="relative"
                        width="full"
                        height="full"
                        overflow="hidden"
                        padding="4"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        <PurchasedLifetimeAccessModalContent platform="mobile" />
                    </Box>
                </Box>
            )}
        </MobileFullScreenModal>
    );
}

function PurchasedLifetimeAccessModalDesktop({onClose}: {onClose: () => void}) {
    return (
        <Modal
            aria-label="Thank you for purchasing lifetime access"
            margin="7"
            onClose={onClose}
            withoutCloseButton
        >
            <Box
                width="full"
                height="full"
                display="flex"
                flexDirection="column"
                overflow="hidden"
                // By default use white for text. Make sure to invert our selection color in light
                // mode since the default light mode selection color doesn't look good with white
                // text.
                color="grey-0-const"
                className={invertLightSelectionColorsClassName}
                padding="4"
            >
                <Box flexGrow="1" overflow="hidden" position="relative">
                    <PurchasedLifetimeAccessModalContent platform="desktop" />
                </Box>
            </Box>
        </Modal>
    );
}

export function PurchasedLifetimeAccessModal({onClose}: {onClose: () => void}) {
    const platform = usePlatform();

    return (
        <>
            {platform === "mobile" ? (
                <PurchasedLifetimeAccessModalMobile onClose={onClose} />
            ) : (
                <PurchasedLifetimeAccessModalDesktop onClose={onClose} />
            )}
        </>
    );
}
