import {Box} from "~/client/design/box.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";
import {
    desktopTaskRowViewIndentationRem,
    mobileTaskRowViewIndentationRem,
    taskRowViewMinHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {
    RemLength,
    Spacing,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";

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
    const isMobile = useIsMobile();

    const marginLeft: RemLength = `${
        parseRemLengthNumber(spacing[isMobile ? "2" : "5"]) +
        parseRemLengthNumber(spacing[isMobile ? "7" : "6"]) +
        (isMobile ? mobileTaskRowViewIndentationRem : desktopTaskRowViewIndentationRem) *
            indentation
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
                <Box width={isMobile ? "7" : "6"} paddingRight="2">
                    <Box
                        width={isMobile ? "5" : "4"}
                        height={isMobile ? "5" : "4"}
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
