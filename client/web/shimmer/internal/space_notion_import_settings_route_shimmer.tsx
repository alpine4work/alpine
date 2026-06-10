import {Box} from "~/client/web/design/box.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeightNameFontSize,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";

export function SpaceNotionImportSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <Box display="flex" flexDirection="column" gap="6" width="full">
                {/* Header: icon + title + Import button */}
                <Box display="flex" alignItems="center" gap={spaceBotSettingsHeadingGap}>
                    <Box
                        className={pulseAnimationClassName}
                        width="12"
                        height="12"
                        backgroundColor="grey-5"
                        borderRadius="2"
                    />
                    <Box width="full" paddingTop="1">
                        <TextShimmer
                            fontSize={spaceBotSettingsHeadingHeightNameFontSize}
                            width="24"
                        />
                        <TextShimmer fontSize="200" width="64" />
                    </Box>
                </Box>
                {/* Upload box */}
                <Box
                    className={pulseAnimationClassName}
                    marginTop="3"
                    backgroundColor="grey-10"
                    borderRadius="1"
                    width="full"
                    height="48"
                />

                {/* Import History */}
                <Box marginTop="2">
                    <TextShimmer fontSize="200" width="28" />
                    <Box display="flex" flexDirection="column" gap="4" marginTop="3">
                        <NotionImportItemCardShimmer />
                        <NotionImportItemCardShimmer />
                    </Box>
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}

function NotionImportItemCardShimmer() {
    return (
        <Box
            padding="6"
            paddingBottom="5"
            boxShadow="elevation-5"
            border="grey-10"
            borderRadius="1.5"
            display="flex"
            flexDirection="column"
            gap="3"
        >
            {/* Workspace name and status */}
            <Box display="flex" justifyContent="space-between" gap="2">
                <TextShimmer fontSize="100" width="24" />
                <TextShimmer fontSize="100" width="32" />
            </Box>

            {/* Stats line */}
            <Box display="flex" flexDirection="column" gap="3" marginTop="7">
                <TextShimmer fontSize="75" width="48" />
                <TextShimmer fontSize="75" width="48" />
            </Box>

            {/* "Imported by" line */}
            <Box marginTop="4">
                <TextShimmer fontSize="50" width="32" />
            </Box>
        </Box>
    );
}
