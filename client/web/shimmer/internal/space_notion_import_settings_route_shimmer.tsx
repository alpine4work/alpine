import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";

export function SpaceNotionImportSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <Box display="flex" flexDirection="column" gap="6" width="full">
                {/* "Import from Notion" heading and description */}
                <Box>
                    <TextShimmer fontSize="100" width="28" />
                    <Spacer space="2" />
                    <TextShimmer fontSize="75" width="64" />
                </Box>

                {/* File upload drop zone */}
                <Box
                    className={pulseAnimationClassName}
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="center"
                    padding="6"
                    borderRadius="1.5"
                    backgroundColor="grey-5"
                    style={{
                        minHeight: spacing["24"],
                    }}
                >
                    <TextShimmer fontSize="100" width="32" />
                    <Spacer space="1" />
                    <TextShimmer fontSize="75" width="20" />
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}
