import {Box} from "~/client/web/design/box.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {pulseAnimationClassName} from "~/client/web/styles/styles.js";
import {
    taskRowViewIndentationRem,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {RemLength, Spacing, parseRemLength, screenPaddingX} from "~/shared/design/core/spacing.js";

export function TaskRowShimmer({
    width,
    ragRight,
    indentation = 0,
    withoutBorderTop,
    withoutPulseAnimation,
}: {
    width: Spacing;
    ragRight?: Spacing;
    indentation?: number;
    withoutBorderTop?: boolean;
    withoutPulseAnimation?: boolean;
}) {
    const platform = usePlatform();

    const marginLeft: RemLength = `${
        parseRemLength(platform === "mobile" ? "2" : "5") +
        parseRemLength(platform === "mobile" ? "7" : "6") +
        taskRowViewIndentationRem[platform] * indentation
    }rem`;

    return (
        <Box
            position="relative"
            width="full"
            height={taskRowViewMinHeight}
            paddingX={screenPaddingX}
            display="flex"
        >
            {!withoutBorderTop && (
                <Box
                    position="absolute"
                    left={screenPaddingX}
                    right={screenPaddingX}
                    height="border"
                    backgroundColor="grey-5"
                    style={{top: 0}}
                />
            )}
            <Box
                position="absolute"
                left={screenPaddingX}
                right={screenPaddingX}
                height="border"
                backgroundColor="grey-5"
                style={{bottom: -1}}
            />
            <Box
                flexShrink="0"
                style={{width: marginLeft}}
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                height={taskRowViewMinHeight}
            >
                <Box width={platform === "mobile" ? "7" : "6"} paddingRight="2">
                    <Box
                        width={platform === "mobile" ? "5" : "4"}
                        height={platform === "mobile" ? "5" : "4"}
                        borderRadius="full"
                        border="grey-10"
                    />
                </Box>
            </Box>
            <Box height={taskRowViewMinHeight} flexGrow="1" display="flex" alignItems="center">
                <Box
                    className={!withoutPulseAnimation ? pulseAnimationClassName : undefined}
                    width="full"
                    maxWidth={width}
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                    marginRight={ragRight}
                />
            </Box>
        </Box>
    );
}
