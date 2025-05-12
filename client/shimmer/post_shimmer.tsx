import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/shimmer/use_coordinated_shimmer_animations.js";
import {
    postContentViewFooterHeight,
    postContentViewHeaderHeight,
    postContentViewInnerMarginY,
    postContentViewMinHeightPx,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";

export function PostShimmer({
    children,
    withoutHeader = false,
    withoutPulseAnimation = false,
}: {
    children?: ReactNode;
    withoutHeader?: boolean;
    withoutPulseAnimation?: boolean;
}) {
    const spacingScale = useSpacingScale();

    return (
        <Box
            ref={useCoordinatedShimmerAnimations()}
            position="relative"
            paddingTop={!withoutHeader ? postContentViewOuterMarginY : undefined}
            display="flex"
            flexDirection="column"
            style={{
                minHeight: postContentViewMinHeightPx[spacingScale],
                paddingBottom: postContentViewOuterMarginBottom,
            }}
        >
            <Box
                position="absolute"
                left="0"
                right="0"
                bottom="0"
                height="border"
                paddingX={screenPaddingX}
            >
                <Box height="full" width="full" backgroundColor="grey-5" />
            </Box>
            {!withoutHeader && <PostShimmerHeader withoutPulseAnimation={withoutPulseAnimation} />}
            <Box flexGrow="1" paddingX={screenPaddingX} paddingY={postContentViewInnerMarginY}>
                {children}
            </Box>
            <Box
                flexShrink="0"
                marginX={screenPaddingX}
                height={postContentViewFooterHeight}
                display="flex"
                alignItems="center"
            >
                <TextShimmer
                    fontSize="75"
                    width="20"
                    withoutPulseAnimation={withoutPulseAnimation}
                />
                <Box flexGrow="1" />
                <TextShimmer
                    fontSize="75"
                    width="20"
                    withoutPulseAnimation={withoutPulseAnimation}
                />
            </Box>
        </Box>
    );
}

export function PostShimmerHeader({
    avatarSize = "8",
    withoutPulseAnimation = false,
}: {
    avatarSize?: "7" | "8";
    withoutPulseAnimation?: boolean;
}) {
    return (
        <Box
            flexShrink="0"
            height={postContentViewHeaderHeight}
            paddingX={screenPaddingX}
            display="flex"
            alignItems="center"
        >
            <Box
                className={!withoutPulseAnimation ? pulseAnimationClassName : undefined}
                flexShrink="0"
                width={avatarSize}
                height={avatarSize}
                backgroundColor="grey-10"
                borderRadius="full"
            />
            <Box flexGrow="1" paddingLeft={{mobile: "2", desktop: "3"}}>
                <TextShimmer
                    fontSize="75"
                    width="32"
                    withoutPulseAnimation={withoutPulseAnimation}
                />
                <TextShimmer
                    fontSize="50"
                    width="16"
                    withoutPulseAnimation={withoutPulseAnimation}
                />
            </Box>
        </Box>
    );
}
