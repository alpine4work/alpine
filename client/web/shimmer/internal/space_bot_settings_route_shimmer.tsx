import {Box} from "~/client/web/design/box.js";
import {buttonMinWidth} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {textInputClassName} from "~/client/web/design/text_input.js";
import {
    ContentParagraphShimmer2,
    ContentParagraphShimmer4,
} from "~/client/web/shimmer/content_shimmer.js";
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
import {contentStyles, pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {Spacing, addRemLengths} from "~/shared/design/core/spacing.js";

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
            <Box height={contentStyles.paragraphMargin} />
            <ContentParagraphShimmer4 />

            <Box
                display="flex"
                flexDirection="column"
                gap="8"
                style={{paddingTop: addRemLengths("16", "2")}}
            >
                <SpaceBotSettingsRouteShimmerSectionHeading />
                <Box display="flex" flexDirection="column" gap="7">
                    <SpaceBotSettingsRouteShimmerField labelWidth="32" hintRagRight="6" />
                    <SpaceBotSettingsRouteShimmerField labelWidth="24" hintRagRight="16" />
                </Box>
            </Box>
        </SpaceSettingsRouteLayoutShimmer>
    );
}

// A section heading is a bold title above a hairline border, matching the "Events"
// / "Space settings" section headers in the loaded page.
function SpaceBotSettingsRouteShimmerSectionHeading() {
    return (
        <Box
            display="flex"
            alignItems="baseline"
            justifyContent="space-between"
            paddingBottom="1.5"
            borderBottom="grey-5"
        >
            <TextShimmer fontSize="300" width="28" />
            <TextShimmer fontSize="50" width="32" />
        </Box>
    );
}

// A field is a label and hint on the left with a text input on the right.
function SpaceBotSettingsRouteShimmerField({
    labelWidth,
    hintRagRight,
}: {
    labelWidth: Spacing;
    hintRagRight: Spacing;
}) {
    return (
        <Box
            minHeight="10"
            gap="6"
            display="flex"
            alignItems="flex-start"
            justifyContent="space-between"
        >
            <Box flexGrow="1" minWidth="flex-fit">
                <TextShimmer fontSize="100" width={labelWidth} />
                <Spacer space="1" />
                <TextShimmer fontSize="75" width="64" ragRight={hintRagRight} />
            </Box>
            <Box width="full" maxWidth="48" flexShrink="0">
                <Box height="9" className={textInputClassName} />
            </Box>
        </Box>
    );
}
