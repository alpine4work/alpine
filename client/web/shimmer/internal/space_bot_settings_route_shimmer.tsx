import {Box} from "~/client/web/design/box.js";
import {buttonMinWidth} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {ContentParagraphShimmer2} from "~/client/web/shimmer/content_shimmer.js";
import {SpaceSettingsRouteLayoutShimmer} from "~/client/web/shimmer/internal/space_settings_route_layout_shimmer.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    spaceBotSettingsHeadingAvatarSize,
    spaceBotSettingsHeadingGap,
    spaceBotSettingsHeadingHeight,
    spaceBotSettingsHeadingHeightInstallButtonHeight,
    spaceBotSettingsHeadingHeightNameFontSize,
    spaceBotSettingsHeadingMarginBottom,
} from "~/client/web/styles/space_settings_shared_styles.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";

export function SpaceBotSettingsRouteShimmer() {
    return (
        <SpaceSettingsRouteLayoutShimmer>
            <Box display="flex" alignItems="flex-end" gap={spaceBotSettingsHeadingGap}>
                <Box
                    className={pulseAnimationClassName}
                    backgroundColor="grey-10"
                    borderRadius="full"
                    style={{
                        width: spaceBotSettingsHeadingAvatarSize,
                        height: spaceBotSettingsHeadingAvatarSize,
                    }}
                />
                <Box
                    flexGrow="1"
                    height={spaceBotSettingsHeadingHeight}
                    display="flex"
                    flexDirection="column"
                    justifyContent="space-between"
                >
                    <TextShimmer fontSize={spaceBotSettingsHeadingHeightNameFontSize} width="28" />
                    <Box
                        className={pulseAnimationClassName}
                        backgroundColor="grey-10"
                        borderRadius="1"
                        width={buttonMinWidth}
                        height={spaceBotSettingsHeadingHeightInstallButtonHeight}
                    />
                </Box>
            </Box>
            <Spacer space={spaceBotSettingsHeadingMarginBottom} />
            <ContentParagraphShimmer2 />
        </SpaceSettingsRouteLayoutShimmer>
    );
}
