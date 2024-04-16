import {useRef} from "react";
import {Box} from "~/client/design/box.js";
import {
    postContentViewFooterHeight,
    postContentViewMinHeightWithClosedCommentSection,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
    postContentViewPaddingX,
} from "~/client/forum/post_content_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {fontSizes, pulseAnimationClassName} from "~/shared/styles/styles.js";

export function PostShimmer() {
    const shimmerRef = useRef<HTMLDivElement>(null);

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times (because they entered the virtualization window) will have
    // the same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        const shimmerElements = assertExists(shimmerRef.current).getElementsByClassName(
            pulseAnimationClassName,
        );
        for (const shimmerElement of shimmerElements) {
            for (const animation of shimmerElement.getAnimations()) {
                animation.startTime = 0;
            }
        }
    }, []);

    return (
        <Box
            ref={shimmerRef}
            position="relative"
            backgroundColor="grey-0"
            paddingTop={postContentViewOuterMarginY}
            display="flex"
            flexDirection="column"
            style={{
                height: postContentViewMinHeightWithClosedCommentSection,
                paddingBottom: postContentViewOuterMarginBottom,
            }}
        >
            <Box
                position="absolute"
                left="0"
                right="0"
                bottom="0"
                paddingX={postContentViewPaddingX}
            >
                <Box width="full" borderBottom="grey-5" />
            </Box>
            <Box
                flexShrink="0"
                paddingX={postContentViewPaddingX}
                display="flex"
                alignItems="center"
            >
                <Box
                    className={pulseAnimationClassName}
                    flexShrink="0"
                    width="8"
                    height="8"
                    backgroundColor="grey-10"
                    borderRadius="full"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                />
                <Box paddingLeft="3">
                    <Box
                        style={{height: fontSizes["75"].lineHeight}}
                        display="flex"
                        alignItems="center"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width="32"
                            height="3"
                            backgroundColor="grey-5"
                            borderRadius="full"
                        />
                    </Box>
                    <Box
                        style={{height: fontSizes["50"].lineHeight}}
                        display="flex"
                        alignItems="center"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width="16"
                            height="2"
                            backgroundColor="grey-5"
                            borderRadius="full"
                        />
                    </Box>
                </Box>
            </Box>
            <Box flexGrow="1" />
            <Box
                flexShrink="0"
                marginX={postContentViewPaddingX}
                height={postContentViewFooterHeight}
                display="flex"
                alignItems="center"
            >
                <Box
                    className={pulseAnimationClassName}
                    width="20"
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                />
                <Box flexGrow="1" />
                <Box
                    className={pulseAnimationClassName}
                    width="20"
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                />
            </Box>
        </Box>
    );
}
