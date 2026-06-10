import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    spaceListSettingsHeadingFontSize,
    spaceListSettingsHeadingMarginBottom,
    spaceListSettingsHeadingSettingsRowAvatarSize,
    spaceListSettingsHeadingSettingsRowGap,
    spaceListSettingsHeadingSettingsRowPaddingY,
    spaceListSettingsHeadingSettingsRowTaglineFontSize,
    spaceListSettingsHeadingSettingsRowTitleFontSize,
    spaceListSettingsHeadingSettingsRowTitleMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {colorSchemeVars, pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SpaceIntegrationsSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <Box position="relative" zIndex="0" display="flex" flexDirection="column" gap="10">
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <TextShimmer
                            fontSize={spaceListSettingsHeadingFontSize}
                            width="16"
                            ragRight="4"
                        />
                        <TextShimmer fontSize="75" width="48" ragRight="4" />
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    <SpaceIntegrationListSettingsRouteShimmerSettingsRow
                        titleRagRight="0"
                        taglineRagRight="6"
                    />
                </Box>
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <TextShimmer
                            fontSize={spaceListSettingsHeadingFontSize}
                            width="12"
                            ragRight="4"
                        />
                        <TextShimmer fontSize="75" width="64" ragRight="4" />
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    <SpaceIntegrationListSettingsRouteShimmerSettingsRow
                        titleRagRight="2"
                        taglineRagRight="0"
                    />
                </Box>
                <Box>
                    <Box display="flex" flexDirection="column" gap="1">
                        <TextShimmer
                            fontSize={spaceListSettingsHeadingFontSize}
                            width="10"
                            ragRight="4"
                        />
                        <TextShimmer fontSize="75" width="48" ragRight="4" />
                    </Box>
                    <Spacer space={spaceListSettingsHeadingMarginBottom} />
                    <SpaceIntegrationListSettingsRouteShimmerSettingsRow
                        titleRagRight="4"
                        taglineRagRight="2"
                    />
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}

function SpaceIntegrationListSettingsRouteShimmerSettingsRow({
    titleRagRight,
    taglineRagRight,
}: {
    titleRagRight: Spacing;
    taglineRagRight: Spacing;
}) {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap={spaceListSettingsHeadingSettingsRowGap}
            paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
            style={{
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box
                className={pulseAnimationClassName}
                backgroundColor="grey-10"
                borderRadius="1"
                width={spaceListSettingsHeadingSettingsRowAvatarSize}
                height={spaceListSettingsHeadingSettingsRowAvatarSize}
            />
            <Box flexGrow="1">
                <TextShimmer
                    fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize}
                    width="16"
                    ragRight={titleRagRight}
                />
                <Spacer space={spaceListSettingsHeadingSettingsRowTitleMarginBottom} />
                <TextShimmer
                    fontSize={spaceListSettingsHeadingSettingsRowTaglineFontSize}
                    width="64"
                    ragRight={taglineRagRight}
                />
            </Box>
            <Box
                className={pulseAnimationClassName}
                backgroundColor="grey-10"
                width="4"
                height="4"
            />
        </Box>
    );
}
