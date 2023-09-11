import {useRef} from "react";
import {Box} from "~/client/design/box.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {taskRowViewMinHeight} from "~/client/tasks/internal/task_row_shared_styles.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {RemLength, Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    pulseAnimationClassName,
} from "~/shared/styles/styles.js";

const taskRowShimmerWidths: Array<Spacing> = [
    // 2x frequency
    "32",
    "32",
    // 3x frequency
    "48",
    "48",
    "48",
    // 4x frequency
    "64",
    "64",
    "64",
    "64",
    // 6x frequency
    "96",
    "96",
    "96",
    "96",
    "96",
    "96",
    // 2x frequency
    "128",
    "128",
    // 1x frequency
    "160",
];

export function TaskRowShimmer({
    randomSeed,
    index,
    indentation,
    focusPreviousTaskTitleEnd,
    focusPreviousTaskTitleAll,
}: {
    randomSeed: string;
    index: number;
    indentation: number;
    focusPreviousTaskTitleEnd: () => void;
    focusPreviousTaskTitleAll: () => void;
}) {
    const shimmerRef = useRef<HTMLDivElement>(null);
    const stableRandom = new StableRandom(`TaskRowShimmer:${randomSeed}`);

    const shimmerWidth =
        taskRowShimmerWidths[
            stableRandom.randomInteger("size", index, 0, taskRowShimmerWidths.length)
        ]!;

    const marginLeft: RemLength = `${
        parseRemLengthNumber(spacing["5"]) +
        (parseRemLengthNumber(spacing["5"]) +
            parseRemLengthNumber(spacing["6"]) +
            parseRemLengthNumber(contentSchemaStyles.listItemIndentation) * indentation)
    }rem`;

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times (because they entered the virtualization window) will have
    // the same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        const shimmerElement = assertExists(shimmerRef.current);
        for (const animation of shimmerElement.getAnimations()) {
            animation.startTime = 0;
        }
    }, []);

    return (
        <Box
            height={taskRowViewMinHeight}
            position="relative"
            // NOTE(calebmer): Setting z-index here creates a new stacking context which
            // means the task row drop indicator lines can't render on top of
            // adjacent rows.
            zIndex={undefined}
            cursor="text"
            {...useOutOfBoundsClickSelection({
                onSelect: focusPreviousTaskTitleEnd,
                onSelectAll: focusPreviousTaskTitleAll,
            })}
        >
            <Box
                position="absolute"
                zIndex="-10"
                top="0"
                bottom="0"
                left="5"
                right="5"
                pointerEvents="none"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            />
            <Box
                position="relative"
                // NOTE(calebmer): Setting z-index here creates a new stacking context which
                // means the editable collection overlay can't render on top of adjacent rows.
                zIndex={undefined}
                display="flex"
                pointerEvents="none"
            >
                <Box
                    position="relative"
                    flexShrink="0"
                    style={{width: marginLeft}}
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                    height={taskRowViewMinHeight}
                >
                    <Box width="6" paddingRight="2">
                        <Box width="4" height="4" borderRadius="full" border="grey-10" />
                    </Box>
                </Box>
                <Box
                    height={taskRowViewMinHeight}
                    flexGrow="1"
                    display="flex"
                    alignItems="center"
                    paddingRight="5"
                >
                    <Box
                        ref={shimmerRef}
                        className={pulseAnimationClassName}
                        width="full"
                        maxWidth={shimmerWidth}
                        height="3"
                        backgroundColor="grey-5"
                        borderRadius="full"
                    />
                </Box>
            </Box>
        </Box>
    );
}
