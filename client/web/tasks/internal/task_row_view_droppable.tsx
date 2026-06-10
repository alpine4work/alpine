import {useDroppable} from "@dnd-kit/core";
import {Memo, useId} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    taskRowViewIndentationRem,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskGridViewDroppableData} from "~/client/web/tasks/task_grid_view_dnd_context.js";
import {parseRemLength, screenPaddingXRem, spacing} from "~/shared/design/core/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const droppableContainerPositionedAboveClassName = sprinkles({
    position: "absolute",
    top: "-7",
    left: "0",
    right: "0",
    zIndex: "10",
    pointerEvents: "none",
    height: taskRowViewMinHeight,
});

const droppableContainerPositionedBelowClassName = sprinkles({
    position: "absolute",
    top: "3",
    bottom: "-3",
    left: "0",
    right: "0",
    zIndex: "10",
    pointerEvents: "none",
});

const droppableClassName = sprinkles({
    position: "absolute",
    left: "0",
    top: "0",
    bottom: "0",
});

const droppableHorizontalOverIndicatorClassName = sprinkles({
    position: "absolute",
    right: "5",
    height: "border",
    pointerEvents: "none",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

const droppableVerticalOverIndicatorClassName = sprinkles({
    position: "absolute",
    height: "2",
    pointerEvents: "none",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

const droppableVerticalOverIndicatorFlippedClassName = sprinkles({
    position: "absolute",
    height: "2",
    pointerEvents: "none",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

export function TaskRowViewDroppable({
    indentation,
    nextAdjacentIndentation,
    previousAdjacentIndentation,
    isPositionedAbove,
    isVerticallyFlipped,
    getDropActions,
    setRowZIndex,
}: {
    indentation: number;
    nextAdjacentIndentation: number | null;
    previousAdjacentIndentation: number | null;
    isPositionedAbove?: boolean;
    isVerticallyFlipped?: boolean;
    getDropActions: (taskId: TaskId) => Array<TaskActionModel>;
    setRowZIndex: Memo<(zIndex: number) => () => void>;
}) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const platform = usePlatform();

    const {isOver, setNodeRef: setDroppableNodeRef} = useDroppable({
        id: useId(),
        data: cast<TaskGridViewDroppableData>({
            type: "Row",
            getDropActions,
        }),
    });

    const listItemIndent = taskRowViewIndentationRem[platform];

    const droppableListItemIndent =
        platform === "mobile"
            ? // Use a lot more space on mobile for the droppable list item hit area. Since the
              // visual indentation we render is really hard to precisely reach with a finger.
              parseRemLength("20")
            : taskRowViewIndentationRem.desktop;

    // If collections are expanded then make sure our task row renders on top of all
    // other task rows.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isOver) return;

        // Call `setRowZIndex` after a microtask since our parent effects need to run
        // before we can update the `z-index` on the correct row DOM node. If we don't call
        // in a microtask then we only set the `z-index` if this is not the row's first
        // render.
        let isCancelled = false;
        let unsetRowZIndex: (() => void) | null = null;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            unsetRowZIndex = setRowZIndex(40);
        });

        return () => {
            isCancelled = true;
            unsetRowZIndex?.();
        };
    }, [isOver, setRowZIndex]);

    return (
        <div
            className={
                isPositionedAbove
                    ? droppableContainerPositionedAboveClassName
                    : droppableContainerPositionedBelowClassName
            }
        >
            <div
                ref={setDroppableNodeRef}
                className={droppableClassName}
                style={{
                    top: 1,
                    left:
                        previousAdjacentIndentation !== null
                            ? `${droppableListItemIndent * indentation}rem`
                            : 0,
                    width:
                        nextAdjacentIndentation !== null && previousAdjacentIndentation !== null
                            ? `${
                                  droppableListItemIndent *
                                  (nextAdjacentIndentation - previousAdjacentIndentation - 1)
                              }rem`
                            : nextAdjacentIndentation !== null
                              ? `${droppableListItemIndent * nextAdjacentIndentation}rem`
                              : previousAdjacentIndentation !== null
                                ? `calc(100% - ${
                                      droppableListItemIndent * (previousAdjacentIndentation + 1)
                                  }rem)`
                                : "100%",
                }}
            />
            {isOver && (
                <div
                    className={droppableHorizontalOverIndicatorClassName}
                    style={{
                        bottom: `calc(${spacing["3"]} - 1px)`,
                        left: `${screenPaddingXRem[platform] + listItemIndent * indentation}rem`,
                    }}
                />
            )}
            {isOver && (
                <div
                    className={
                        isVerticallyFlipped
                            ? droppableVerticalOverIndicatorFlippedClassName
                            : droppableVerticalOverIndicatorClassName
                    }
                    style={{
                        width: 1,
                        bottom: isVerticallyFlipped
                            ? `calc(${spacing["1"]} - 1px)`
                            : `calc(${spacing["3"]} - 1px)`,
                        left: `${screenPaddingXRem[platform] + listItemIndent * indentation}rem`,
                    }}
                />
            )}
        </div>
    );
}
