import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    spaceBotListSettingsHeadingFontSize,
    spaceBotListSettingsHeadingMarginBottom,
    spaceBotListSettingsHeadingSettingsRowAvatarSize,
    spaceBotListSettingsHeadingSettingsRowGap,
    spaceBotListSettingsHeadingSettingsRowPaddingY,
    spaceBotListSettingsHeadingSettingsRowTaglineFontSize,
    spaceBotListSettingsHeadingSettingsRowTitleFontSize,
    spaceBotListSettingsHeadingSettingsRowTitleMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {colorSchemeVars, pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function SpaceBotListSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <TextShimmer fontSize={spaceBotListSettingsHeadingFontSize} width="16" />
            <Spacer space={spaceBotListSettingsHeadingMarginBottom} />
            <SpaceBotListSettingsRouteShimmerSettingsRow titleRagRight="0" taglineRagRight="6" />
            <SpaceBotListSettingsRouteShimmerSettingsRow titleRagRight="2" taglineRagRight="0" />
        </SpaceSettingsRouteLayoutShimmer>
    );
}

function SpaceBotListSettingsRouteShimmerSettingsRow({
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
            gap={spaceBotListSettingsHeadingSettingsRowGap}
            paddingY={spaceBotListSettingsHeadingSettingsRowPaddingY}
            style={{
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box
                className={pulseAnimationClassName}
                backgroundColor="grey-10"
                borderRadius="full"
                width={spaceBotListSettingsHeadingSettingsRowAvatarSize}
                height={spaceBotListSettingsHeadingSettingsRowAvatarSize}
            />
            <Box flexGrow="1">
                <TextShimmer
                    fontSize={spaceBotListSettingsHeadingSettingsRowTitleFontSize}
                    width="16"
                    ragRight={titleRagRight}
                />
                <Spacer space={spaceBotListSettingsHeadingSettingsRowTitleMarginBottom} />
                <TextShimmer
                    fontSize={spaceBotListSettingsHeadingSettingsRowTaglineFontSize}
                    width="64"
                    ragRight={taglineRagRight}
                />
            </Box>
        </Box>
    );
}
