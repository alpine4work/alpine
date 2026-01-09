import {X} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {Modal} from "~/client/web/design/modal.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {invertLightSelectionColorsClassName} from "~/client/web/styles/styles.js";

function PurchasedLifetimeAccessModalContent() {
    // TODO: design this
    //   https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/fthr65f7s8zs1yexst1r9t7c6w
    return <Box>TODO More Content</Box>;
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
                        paddingTop={navigationBarHeight}
                        padding="4"
                    >
                        <Box fontSize="200" paddingY="2">
                            Thank you for purchasing lifetime access
                        </Box>
                        <PurchasedLifetimeAccessModalContent />
                    </Box>
                </Box>
            )}
        </MobileFullScreenModal>
    );
}

function PurchasedLifetimeAccessModalDesktop({onClose}: {onClose: () => void}) {
    return (
        <Modal aria-label="Thank you for purchasing lifetime access!" margin="7" onClose={onClose}>
            <Box
                width="full"
                height="full"
                display="flex"
                flexDirection="column"
                overflow="hidden"
                // By default use white for text. Make sure to invert our selection color in
                // light mode since the default light mode selection color doesn't look good
                // with white text.
                color="grey-0-const"
                className={invertLightSelectionColorsClassName}
                padding="4"
            >
                <Box fontSize="100">Thank you for purchasing lifetime access</Box>
                <Box flexGrow="1" overflow="hidden" position="relative">
                    <PurchasedLifetimeAccessModalContent />
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
