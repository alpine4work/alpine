import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {
    MobileBackButton,
    MobileBackButtonSpacer,
} from "~/client/shimmer/internal/mobile_back_button.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {
    spaceSettingsDesktopSidebarWidth,
    spaceSettingsMaxDesktopContentWidth,
} from "~/client/styles/space_settings_shared_styles.js";
import {grey5SemiTransparentColorVar, pulseAnimationClassName} from "~/client/styles/styles.js";
import {Spacing, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

export function SpacePeopleSettingsRouteShimmer() {
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
                <PeopleSpaceSettingsRouteShimmerContent />
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
                                style={{
                                    bottom: -1,
                                    backgroundColor: grey5SemiTransparentColorVar,
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
                            <PeopleSpaceSettingsRouteShimmerContent />
                        </Box>
                        <Box height="safe-area-inset-bottom" />
                    </>,
                )}
            </Box>
        </Box>
    );
}

function PeopleSpaceSettingsRowShimmer({
    nameWidth,
    isRemoved,
    index,
}: {
    nameWidth: Spacing;
    isRemoved?: boolean;
    index?: number;
}) {
    return (
        <Box
            height="14"
            borderTop={index === 0 ? "grey-5" : undefined}
            borderBottom="grey-5"
            display="flex"
            alignItems="center"
            gap="3"
        >
            <Box
                backgroundColor="grey-5"
                className={pulseAnimationClassName}
                borderRadius="full"
                width="8"
                height="8"
            />
            <TextShimmer fontSize="100" width={nameWidth} />
            <Box flexGrow="1" />

            <TextShimmer fontSize="100" width={isRemoved ? "28" : "16"} />
        </Box>
    );
}

function PeopleSpaceSettingsRouteShimmerContent() {
    const [resizeRef, size] = useResizeObserver();
    const isMobile = usePlatform() === "mobile";

    const renderDescriptionShimmer = (minWidth: number) => {
        const containerWidth = size?.width;

        if (isMobile && containerWidth && containerWidth < minWidth) {
            return (
                <>
                    <TextShimmer fontSize="75" width="64" />
                    <TextShimmer fontSize="75" width="28" />
                </>
            );
        } else {
            // On desktop, use a single longer line
            return <TextShimmer fontSize="75" width="96" />;
        }
    };

    return (
        <Box ref={resizeRef} width="full">
            <TextShimmer fontSize="200" width="20" />
            <Box color="grey-60" userSelect="text" paddingTop="1" paddingBottom="6">
                {renderDescriptionShimmer(470)}
            </Box>

            <PeopleSpaceSettingsRowShimmer index={0} nameWidth="28" />
            <PeopleSpaceSettingsRowShimmer nameWidth="32" />
            <PeopleSpaceSettingsRowShimmer nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer nameWidth="12" />
            <PeopleSpaceSettingsRowShimmer nameWidth="28" />

            <Spacer space="10" />
            <TextShimmer fontSize="200" width="48" ragRight="12" />
            <Box color="grey-60" userSelect="text" paddingTop="1" paddingBottom="6">
                {renderDescriptionShimmer(540)}
            </Box>

            <PeopleSpaceSettingsRowShimmer isRemoved index={0} nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="28" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="24" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="12" />
            <PeopleSpaceSettingsRowShimmer isRemoved nameWidth="28" />
        </Box>
    );
}
