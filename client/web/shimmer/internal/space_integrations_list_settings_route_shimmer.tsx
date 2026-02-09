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

export function SpaceIntegrationListSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <TextShimmer fontSize={spaceListSettingsHeadingFontSize} width="16" />
            <Spacer space={spaceListSettingsHeadingMarginBottom} />
            <SpaceIntegrationListSettingsRouteShimmerSettingsRow
                titleRagRight="0"
                taglineRagRight="6"
            />
            <SpaceIntegrationListSettingsRouteShimmerSettingsRow
                titleRagRight="2"
                taglineRagRight="0"
            />
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
                borderRadius="full"
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
        </Box>
    );
}
