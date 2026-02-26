import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";

const slackHeaderLogoSize = "12";
const slackIntegrationSettingsAvatarGap = "6";
const slackIntegrationSettingsAvatarSize = "10";
const slackIntegrationSettingsSectionMarginLeft = "1";

export function SpaceSlackIntegrationSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <Box>
                <Box display="flex" flexDirection="row" alignItems="flex-end" gap="5" height="14">
                    <Box
                        className={pulseAnimationClassName}
                        backgroundColor="grey-10"
                        width={slackHeaderLogoSize}
                        height={slackHeaderLogoSize}
                        borderRadius="full"
                    />
                    <Box height="14" display="flex" flexDirection="column" gap="1">
                        <TextShimmer fontSize="600" width="8" />
                        <TextShimmer fontSize="100" width="48" />
                    </Box>
                </Box>
                <Spacer space="14" />
                <Box display="flex" flexDirection="column" gap="12">
                    <Box marginLeft={slackIntegrationSettingsSectionMarginLeft}>
                        <Box
                            display="flex"
                            flexDirection="row"
                            alignItems="flex-start"
                            gap={slackIntegrationSettingsAvatarGap}
                        >
                            <Box
                                className={pulseAnimationClassName}
                                backgroundColor="grey-10"
                                width={slackIntegrationSettingsAvatarSize}
                                height={slackIntegrationSettingsAvatarSize}
                                borderRadius="1.5"
                            />
                            <Box display="flex" flexDirection="column" gap="0.5" marginY="-1">
                                <TextShimmer fontSize="200" width="24" />
                                <TextShimmer fontSize="75" width="32" />
                            </Box>
                        </Box>
                    </Box>
                    <Box
                        display="flex"
                        flexDirection="column"
                        gap="8"
                        paddingLeft={slackIntegrationSettingsSectionMarginLeft}
                    >
                        <Box
                            display="flex"
                            flexDirection="row"
                            alignItems="flex-start"
                            gap={slackIntegrationSettingsAvatarGap}
                        >
                            <Box
                                className={pulseAnimationClassName}
                                backgroundColor="grey-10"
                                width={slackIntegrationSettingsAvatarSize}
                                height={slackIntegrationSettingsAvatarSize}
                                borderRadius="1.5"
                            />
                            <Box display="flex" flexDirection="column" gap="0.5" marginY="-1">
                                <TextShimmer fontSize="200" width="20" />
                                <TextShimmer fontSize="75" width="48" />
                            </Box>
                        </Box>
                        <Box
                            display="flex"
                            flexDirection="row"
                            alignItems="center"
                            justifyContent="space-between"
                            gap="3"
                        >
                            <TextShimmer fontSize="100" width="48" />
                            <Box
                                className={pulseAnimationClassName}
                                backgroundColor="grey-10"
                                width="10"
                                height="6"
                                borderRadius="full"
                            />
                        </Box>
                    </Box>
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}
