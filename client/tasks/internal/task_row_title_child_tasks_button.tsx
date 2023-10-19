import {CaretUp} from "phosphor-react";
import {Key, KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {TaskChildTasksProgressWheel} from "~/client/tasks/internal/task_child_tasks_progress_wheel.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

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

export type TaskRowTitleChildTasksButtonRef = {
    focus(): void;
};

const TaskRowTitleChildTasksButtonForwardRef = forwardRef(TaskRowTitleChildTasksButton);
export {TaskRowTitleChildTasksButtonForwardRef as TaskRowTitleChildTasksButton};

const buttonClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    marginLeft: "3",
    paddingLeft: "1",
    paddingRight: "0.5",
    paddingY: "0.5",
    gap: "1",
    borderRadius: "base",
});

function TaskRowTitleChildTasksButton(
    {
        stateKey,
        childTaskCount,
        closedChildTaskCount,
        areChildTasksExpanded,
        onAreChildTasksExpandedToggle,
        onKeyDown,
    }: {
        stateKey: Key | undefined;
        childTaskCount: number;
        closedChildTaskCount: number;
        areChildTasksExpanded: boolean;
        onAreChildTasksExpandedToggle: () => void;
        onKeyDown: (event: KeyboardEvent) => void;
    },
    ref: Ref<TaskRowTitleChildTasksButtonRef>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this file. It is critical for scroll performance that this component renders
    // fast. Use the `sprinkles()` function in the module body instead. We've
    // observed while profiling the sprinkles function takes a meaningful amount of
    // time during render.
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

    const buttonRef = useRef<HTMLDivElement>(null);
    const {hoverProps, isHovered} = useHover({});
    const {pressProps, isPressed} = usePress({onPress: onAreChildTasksExpandedToggle});

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(buttonRef.current).focus(),
        }),
        [],
    );

    return (
        <Tooltip content={areChildTasksExpanded ? "Collapse subtasks" : "Expand subtasks"}>
            <FocusRing offset="0">
                <div
                    {...mergeProps(hoverProps, pressProps, {onKeyDown})}
                    ref={buttonRef}
                    className={buttonClassName}
                    // Focusable by keyboard navigation.
                    tabIndex={-1}
                    style={{
                        backgroundColor: isPressed
                            ? colorSchemeVars["grey-10"]
                            : isHovered
                            ? colorSchemeVars["grey-5"]
                            : undefined,
                    }}
                >
                    <TaskChildTasksProgressWheel
                        childTaskCount={childTaskCount}
                        closedChildTaskCount={closedChildTaskCount}
                        isHovered={isHovered}
                        isPressed={isPressed}
                    />
                    <div style={{color: colorSchemeVars["grey-70"]}}>
                        {closedChildTaskCount}/{childTaskCount}
                    </div>
                    <CaretUp
                        // When our grid view resets (we find out through a `stateKey` change) we don't
                        // want to animate our caret. By setting it as a key here React will fully
                        // destroy and recreate this component skipping the transition animation.
                        key={stateKey}
                        size={spacing["3"]}
                        style={{
                            transform: areChildTasksExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 200ms ease",
                        }}
                    />
                </div>
            </FocusRing>
        </Tooltip>
    );
}
