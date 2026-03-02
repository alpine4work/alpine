import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    taskGridViewPaddingBottomWithNext,
    taskGridViewPaddingBottomWithoutNext,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {Spacing, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

const paddingBottomWithNextGridViewClassName = sprinkles({
    position: "relative",
    width: "full",
    marginX: "center",
    height: taskGridViewPaddingBottomWithNext,
});

const paddingBottomWithoutNextGridViewClassName = sprinkles({
    position: "relative",
    width: "full",
    marginX: "center",
    height: taskGridViewPaddingBottomWithoutNext,
});

const paddingBottomRowLinesBackgroundClassName = sprinkles({
    position: "absolute",
    left: screenPaddingX,
    right: screenPaddingX,
});

const paddingBottomRowLinesBackgroundImage = `repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(${spacing[taskRowViewMinHeight]} - 1px),
    ${colorSchemeVars["grey-5"]} calc(${spacing[taskRowViewMinHeight]} - 1px),
    ${colorSchemeVars["grey-5"]} ${spacing[taskRowViewMinHeight]}
)`;

export function TaskRowViewPaddingBottom({
    rowMaxWidth,
    isInert,
    hasNextGridView,
    hasDecorativeGhostRowBackground,
    focusTitleEnd,
    focusTitleAll,
}: {
    rowMaxWidth: Spacing | null;
    isInert: boolean;
    hasNextGridView: boolean;
    hasDecorativeGhostRowBackground: boolean;
    focusTitleEnd: () => void;
    focusTitleAll: () => void;
}) {
    const platform = usePlatform();

    return (
        <div
            className={
                hasNextGridView
                    ? paddingBottomWithNextGridViewClassName
                    : paddingBottomWithoutNextGridViewClassName
            }
            style={{
                cursor: !isInert ? "text" : undefined,
                maxWidth: rowMaxWidth ? spacing[rowMaxWidth] : undefined,
                height:
                    platform === "mobile" && !hasNextGridView
                        ? `calc(var(--safe-area-inset-bottom, 0px) + ${spacing[taskGridViewPaddingBottomWithoutNext]})`
                        : undefined,

                // Important: This prevents the 100vh height element we render below from
                // adding extra scroll height. We want to add decorative task row lines going
                // off the bottom of the screen making the task product feel like a sheet of
                // lined paper. We use 100vh since that'll guarantee fill the remaining space
                // under our last row. But we don't want that extra 100vh to cause us to
                // scroll more.
                contain: "layout",
            }}
            {...useOutOfBoundsClickSelection({
                isDisabled: isInert,
                // Also accept events from child background `<div>`.
                accept: () => true,
                onSelect: focusTitleEnd,
                onSelectAll: focusTitleAll,
            })}
        >
            {hasDecorativeGhostRowBackground && (
                <div
                    className={paddingBottomRowLinesBackgroundClassName}
                    style={{
                        top: 1,
                        height: "100vh",
                        backgroundImage: paddingBottomRowLinesBackgroundImage,
                    }}
                />
            )}
        </div>
    );
}
