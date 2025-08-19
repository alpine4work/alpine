import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {textInputClassName} from "~/client/design/text_input.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";

export function SpaceGeneralSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
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
        </SpaceSettingsRouteLayoutShimmer>
    );
}
