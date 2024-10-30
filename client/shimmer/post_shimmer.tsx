import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {TextShimmer} from "~/client/shimmer/text_shimmer.js";
import {useCoordinatedShimmerAnimations} from "~/client/shimmer/use_coordinated_shimmer_animations.js";
import {
    postContentViewFooterHeight,
    postContentViewHeaderHeight,
    postContentViewInnerMarginY,
    postContentViewMinHeightWithClosedCommentSection,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {colorSchemeVars, pulseAnimationClassName} from "~/client/styles/styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";

export function PostShimmer({
    children,
    withoutHeader = false,
}: {
    children?: ReactNode;
    withoutHeader?: boolean;
}) {
    return (
        <Box
            ref={useCoordinatedShimmerAnimations()}
            position="relative"
            paddingTop={!withoutHeader ? postContentViewOuterMarginY : undefined}
            display="flex"
            flexDirection="column"
            style={{
                minHeight: postContentViewMinHeightWithClosedCommentSection,
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
                <Box
                    height="full"
                    width="full"
                    style={{
                        // Draw border with `box-shadow` so it doesn't contribute to layout.
                        boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                    }}
                />
            </Box>
            {!withoutHeader && <PostShimmerHeader />}
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
                <TextShimmer fontSize="75" width="20" />
                <Box flexGrow="1" />
                <TextShimmer fontSize="75" width="20" />
            </Box>
        </Box>
    );
}

export function PostShimmerHeader({avatarSize = "8"}: {avatarSize?: "7" | "8"}) {
    return (
        <Box
            flexShrink="0"
            height={postContentViewHeaderHeight}
            paddingX={screenPaddingX}
            display="flex"
            alignItems="center"
        >
            <Box
                className={pulseAnimationClassName}
                flexShrink="0"
                width={avatarSize}
                height={avatarSize}
                backgroundColor="grey-10"
                borderRadius="full"
            />
            <Box flexGrow="1" paddingLeft={{mobile: "2", desktop: "3"}}>
                <TextShimmer fontSize="75" width="32" />
                <TextShimmer fontSize="50" width="16" />
            </Box>
        </Box>
    );
}
