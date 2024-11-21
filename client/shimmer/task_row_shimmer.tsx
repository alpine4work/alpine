import {Box} from "~/client/design/box.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";
import {
    taskRowViewIndentationRem,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {RemLength, Spacing, parseRemLength, screenPaddingX} from "~/shared/design/core/spacing.js";

export function TaskRowShimmer({
    hasColumns,
    width,
    ragRight,
    indentation = 0,
}: {
    hasColumns: boolean;
    width: Spacing;
    ragRight?: Spacing;
    indentation?: number;
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
            <Box
                position="absolute"
                left={!hasColumns ? screenPaddingX : "0"}
                right={screenPaddingX}
                bottom="0"
                height="border"
                backgroundColor="grey-5"
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
                    className={pulseAnimationClassName}
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
