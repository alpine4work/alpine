import {useRef} from "react";
import {Box} from "~/client/design/box.js";
import {
    postContentViewInnerMarginY,
    postContentViewMinHeight,
    postContentViewPaddingX,
} from "~/client/forum/post_content_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {fontSizes, pulseAnimationClassName} from "~/shared/styles/styles.js";

// NOCOMMIT: This needs to be updated!

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
            backgroundColor="grey-0"
            boxShadow="elevation-5"
            style={{height: postContentViewMinHeight}}
            display="flex"
            flexDirection="column"
        >
            <Box
                paddingX={postContentViewPaddingX}
                paddingTop={postContentViewInnerMarginY}
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
                marginX={postContentViewPaddingX}
                borderTop="grey-5"
                height="12"
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" />
                <Box
                    className={pulseAnimationClassName}
                    width="24"
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                />
            </Box>
        </Box>
    );
}
