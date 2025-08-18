import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {textInputClassName} from "~/client/design/text_input.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/shimmer/internal/mobile_back_button.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {
    spaceAvatarBorderRadius,
    spaceSettingsDesktopSidebarWidth,
    spaceSettingsMaxDesktopContentWidth,
} from "~/client/styles/space_settings_shared_styles.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

// TODO(#email-notifications) Implement with notification designs

export function SpaceNotificationsSettingsRouteShimmer() {
    const isMobile = usePlatform() === "mobile";

    if (isMobile) {
        return (
            <Box
                width="full"
                height="full"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                paddingX={screenPaddingX}
            >
                {/* Header area */}
                <Box
                    width="full"
                    height={navigationBarHeight}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                >
                    <MobileBackButton />
                    <TextShimmer fontSize="100" width="28" />
                    <MobileBackButtonSpacer />
                </Box>
                <NotificationsSpaceSettingsRouteShimmerContent />
            </Box>
        );
    }

    // Desktop layout
    const renderRowLayout = (sidebarChildren: ReactNode, contentChildren: ReactNode) => (
        <Box display="flex" justifyContent="center" paddingX={screenPaddingX}>
            <Box width={spaceSettingsDesktopSidebarWidth} flexShrink="0">
                {sidebarChildren}
            </Box>
            <Box
                width="full"
                maxWidth={spaceSettingsMaxDesktopContentWidth}
                style={{flexShrink: 1}}
            >
                {contentChildren}
            </Box>
            <Box width={spaceSettingsDesktopSidebarWidth} style={{flexShrink: 1_000_000}} />
        </Box>
    );

    return (
        <Box
            position="relative"
            zIndex="0"
            flexGrow="1"
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
        >
            {/* Header area */}
            <Box position="relative" zIndex="20" flexShrink="0" paddingTop="safe-area-inset">
                <Box height={navigationBarHeight}>
                    {renderRowLayout(
                        null,
                        <Box position="relative" height="14" display="flex" alignItems="center">
                            <TextShimmer fontSize="400" width="48" ragRight="10" />
                            <Box
                                pointerEvents="none"
                                position="absolute"
                                height="border"
                                backgroundColor="grey-5-translucent"
                                style={{
                                    bottom: -1,
                                    left: `max(-${spacing["3"]}, (100% - ${spacing[spaceSettingsMaxDesktopContentWidth]}) / 2 - ${spacing["3"]})`,
                                    right: `max(-${spacing["3"]}, (100% - ${spacing[spaceSettingsMaxDesktopContentWidth]}) / 2 - ${spacing["3"]})`,
                                    maskImage: `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`,
                                }}
                            />
                        </Box>,
                    )}
                </Box>
            </Box>

            {/* Sidebar navigation */}
            <Box
                position="absolute"
                zIndex="10"
                left="0"
                right="0"
                style={{
                    top: `calc(${spacing[navigationBarHeight]} + var(--safe-area-inset-top, 0px))`,
                }}
            >
                {renderRowLayout(
                    <Box paddingRight="8">
                        <Box
                            paddingX="2.5"
                            paddingY="1"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                        >
                            <TextShimmer fontSize="200" width="20" ragRight="2" />
                        </Box>
                        <Box
                            paddingX="2.5"
                            paddingY="1"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                        >
                            <TextShimmer fontSize="200" width="16" />
                        </Box>
                    </Box>,
                    null,
                )}
            </Box>

            {/* Main content area */}
            <Box flexGrow="1" position="relative" zIndex="0" overflow="hidden">
                {renderRowLayout(
                    null,
                    <>
                        <Box paddingY="8">
                            <NotificationsSpaceSettingsRouteShimmerContent />
                        </Box>
                        <Box height="safe-area-inset-bottom" />
                    </>,
                )}
            </Box>
        </Box>
    );
}

function NotificationsSpaceSettingsRouteShimmerContent() {
    return (
        <>
            <Box display="flex" flexDirection="column" gap="6" width="full">
                {/* Name field shimmer */}
                <Box gap="6" display="flex" alignItems="center" justifyContent="space-between">
                    <TextShimmer fontSize="100" width="12" />
                    <Box
                        position="relative"
                        width="full"
                        maxWidth="48"
                        height="9"
                        className={textInputClassName}
                    />
                </Box>

                {/* Logo field shimmer */}
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box width="full">
                        <TextShimmer fontSize="100" width="12" />
                        <Spacer space="1" />
                        <TextShimmer fontSize="75" width="48" />
                    </Box>
                    <Box
                        marginLeft="-12"
                        className={pulseAnimationClassName}
                        width="12"
                        height="12"
                        backgroundColor="grey-10"
                        borderRadius={spaceAvatarBorderRadius}
                    />
                </Box>
            </Box>
        </>
    );
}
