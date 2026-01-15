import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {textInputClassName} from "~/client/web/design/text_input.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {spaceAvatarBorderRadius} from "~/client/web/styles/space_settings_shared_styles.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";

// TODO(#profile-settings) Implement with profile designs

export function SpaceProfileSettingsRouteShimmer() {
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

                {/* Character shimmer */}
                <Box display="flex" justifyContent="space-between">
                    <Box width="full">
                        <TextShimmer fontSize="100" width="16" />
                        <Spacer space="1" />
                        <TextShimmer fontSize="75" width="64" />
                    </Box>
                    <Box display="flex" flexDirection="column" alignItems="flex-end" gap="2">
                        <Box
                            display="flex"
                            alignItems="center"
                            gap="2"
                            marginRight="4"
                            marginTop="-1"
                        >
                            <Box
                                className={pulseAnimationClassName}
                                width="4"
                                height="4"
                                backgroundColor="grey-10"
                                borderRadius={spaceAvatarBorderRadius}
                            />
                            <Box
                                className={pulseAnimationClassName}
                                width="12"
                                height="12"
                                backgroundColor="grey-10"
                                borderRadius={spaceAvatarBorderRadius}
                            />
                            <Box
                                className={pulseAnimationClassName}
                                width="4"
                                height="4"
                                backgroundColor="grey-10"
                                borderRadius={spaceAvatarBorderRadius}
                            />
                        </Box>
                        <Box>
                            <Box
                                marginLeft="-12"
                                className={pulseAnimationClassName}
                                width="32"
                                height="4"
                                backgroundColor="grey-10"
                                borderRadius={spaceAvatarBorderRadius}
                            />
                        </Box>
                    </Box>
                </Box>

                {/* Theme shimmer */}
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box width="full">
                        <TextShimmer fontSize="100" width="16" />
                        <Spacer space="1" />
                        <TextShimmer fontSize="75" width="48" />
                    </Box>
                    <Box
                        marginLeft="-12"
                        className={pulseAnimationClassName}
                        width="24"
                        height="8"
                        backgroundColor="grey-10"
                        borderRadius={spaceAvatarBorderRadius}
                    />
                </Box>

                {/* Lifetime Access shimmer */}
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box width="full">
                        <TextShimmer fontSize="100" width="24" />
                        <Spacer space="1" />
                        <TextShimmer fontSize="75" width="64" />
                        <TextShimmer fontSize="75" width="64" />
                        <TextShimmer fontSize="75" width="48" />
                    </Box>
                    <Box
                        marginLeft="-12"
                        className={pulseAnimationClassName}
                        width="24"
                        height="8"
                        backgroundColor="grey-10"
                        borderRadius={spaceAvatarBorderRadius}
                    />
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}
