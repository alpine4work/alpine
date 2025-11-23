import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/web/shimmer/use_coordinated_shimmer_animations.js";
import {
    postContentViewFooterHeight,
    postContentViewHeaderHeight,
    postContentViewInnerMarginY,
    postContentViewMinHeightPx,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";

export function PostShimmer({
    children,
    withoutPulseAnimation = false,
}: {
    children?: ReactNode;
    withoutPulseAnimation?: boolean;
}) {
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();

    return (
        <Box
            ref={useCoordinatedShimmerAnimations()}
            position="relative"
            paddingTop={postContentViewOuterMarginY}
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
                height={routeLayout === "narrow" ? "border" : "border-thick"}
                backgroundColor="grey-5"
                style={{bottom: routeLayout === "narrow" ? 0 : -1}}
            />
            <PostShimmerHeader withoutPulseAnimation={withoutPulseAnimation} />
            <Box flexGrow="1" paddingX={screenPaddingX} paddingY={postContentViewInnerMarginY}>
                {children}
            </Box>
            <PostShimmerFooter withoutPulseAnimation={withoutPulseAnimation} />
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

export function PostShimmerFooter({withoutPulseAnimation}: {withoutPulseAnimation?: boolean}) {
    return (
        <Box
            flexShrink="0"
            marginX={screenPaddingX}
            height={postContentViewFooterHeight}
            display="flex"
            alignItems="center"
        >
            <TextShimmer fontSize="75" width="20" withoutPulseAnimation={withoutPulseAnimation} />
            <Box flexGrow="1" />
            <TextShimmer fontSize="75" width="20" withoutPulseAnimation={withoutPulseAnimation} />
        </Box>
    );
}
