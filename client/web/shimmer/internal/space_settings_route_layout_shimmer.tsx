import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/web/shimmer/internal/mobile_back_button.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    spaceSettingsDesktopSidebarWidth,
    spaceSettingsMaxDesktopContentWidth,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

export function SpaceSettingsRouteLayoutShimmer({children}: {children: ReactNode}) {
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
                {children}
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
                            height="5"
                            marginX="1"
                            marginBottom="1"
                            borderBottom="grey-5"
                            style={{marginTop: `calc(-${spacing["5"]} + 1px)`}}
                        >
                            <Box paddingX="1.5">
                                <TextShimmer fontSize="50" width="16" ragRight="1" />
                            </Box>
                        </Box>
                        <Box
                            paddingX="2.5"
                            paddingY="1"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                        >
                            <TextShimmer fontSize="200" width="20" ragRight="4" />
                        </Box>
                        <Box
                            paddingX="2.5"
                            paddingY="1"
                            display="flex"
                            alignItems="center"
                            gap="0.5"
                        >
                            <TextShimmer fontSize="200" width="24" />
                        </Box>
                        <Spacer space="8" />
                        <Box height="5" marginX="1" marginBottom="1" borderBottom="grey-5">
                            <Box paddingX="1.5" fontSize="50" color="grey-50">
                                <TextShimmer fontSize="50" width="20" ragRight="1" />
                            </Box>
                        </Box>
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
                        <Box paddingY="8">{children}</Box>
                        <Box height="safe-area-inset-bottom" />
                    </>,
                )}
            </Box>
        </Box>
    );
}
