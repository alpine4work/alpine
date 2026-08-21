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

export function SpaceBotListSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            {/* "Installed" */}
            <SpaceBotListSettingsRouteShimmerSectionHeading
                titleWidth="24"
                subtitleWidth="64"
                subtitleRagRight="2"
            />
            <Spacer space={spaceListSettingsHeadingMarginBottom} />
            <SpaceBotListSettingsRouteShimmerSettingsRow titleRagRight="4" taglineRagRight="0" />
            <SpaceBotListSettingsRouteShimmerSettingsRow titleRagRight="0" taglineRagRight="2" />

            <Spacer space="10" />

            {/* "Recommended" */}
            <SpaceBotListSettingsRouteShimmerSectionHeading
                titleWidth="28"
                subtitleWidth="128"
                subtitleRagRight="16"
            />
            <Spacer space={spaceListSettingsHeadingMarginBottom} />
            <SpaceBotListSettingsRouteShimmerSettingsRow titleRagRight="6" taglineRagRight="1" />
            <SpaceBotListSettingsRouteShimmerCreateGhostRow />
        </SpaceSettingsRouteLayoutShimmer>
    );
}

// A section heading pairs a bold title with a lighter one-line subtitle, matching
// the "Installed" / "Recommended" headers in the loaded page.
function SpaceBotListSettingsRouteShimmerSectionHeading({
    titleWidth,
    subtitleWidth,
    subtitleRagRight,
}: {
    titleWidth: Spacing;
    subtitleWidth: Spacing;
    subtitleRagRight: Spacing;
}) {
    return (
        <Box display="flex" flexDirection="column" gap="1">
            <TextShimmer fontSize={spaceListSettingsHeadingFontSize} width={titleWidth} />
            <TextShimmer fontSize="75" width={subtitleWidth} ragRight={subtitleRagRight} />
        </Box>
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

// The "Create a new custom bot" row at the end of the recommended list. It has no
// divider lines and only a single line of text, unlike a bot row.
function SpaceBotListSettingsRouteShimmerCreateGhostRow() {
    return (
        <Box
            display="flex"
            alignItems="center"
            gap={spaceListSettingsHeadingSettingsRowGap}
            paddingY={spaceListSettingsHeadingSettingsRowPaddingY}
        >
            <Box
                className={pulseAnimationClassName}
                backgroundColor="grey-10"
                borderRadius="full"
                width={spaceListSettingsHeadingSettingsRowAvatarSize}
                height={spaceListSettingsHeadingSettingsRowAvatarSize}
            />
            <TextShimmer fontSize={spaceListSettingsHeadingSettingsRowTitleFontSize} width="48" />
        </Box>
    );
}
