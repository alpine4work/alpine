import {CaretUp} from "phosphor-react";
import {Key, KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {TaskChildTasksProgressWheel} from "~/client/web/tasks/task_child_tasks_progress_wheel.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

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
    isFocusable(): boolean;
    focus(): void;
};

const TaskRowTitleChildTasksButtonForwardRef = forwardRef(TaskRowTitleChildTasksButton);
export {TaskRowTitleChildTasksButtonForwardRef as TaskRowTitleChildTasksButton};

const buttonFontSize = "75";
const buttonPaddingY = "0.5";

const buttonClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    paddingLeft: "1",
    paddingRight: "0.5",
    paddingY: buttonPaddingY,
    gap: "1",
    borderRadius: "1",
    fontSize: buttonFontSize,
});

function TaskRowTitleChildTasksButton(
    {
        stateKey,
        task,
        areChildTasksExpanded,
        onAreChildTasksExpandedToggle,
        isMaxExpandedTaskDepth,
        onKeyDown,
    }: {
        stateKey: Key | undefined;
        task: TaskModel | null;
        areChildTasksExpanded: boolean;
        onAreChildTasksExpandedToggle: () => void;
        isMaxExpandedTaskDepth: boolean;
        onKeyDown: (event: KeyboardEvent) => void;
    },
    ref: Ref<TaskRowTitleChildTasksButtonRef>,
) {
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
    const navigate = useNavigate();

    const buttonRef = useRef<HTMLDivElement>(null);

    const childTaskCount = task?.getChildTaskCount() ?? 0;
    const closedChildTaskCount = task?.getClosedChildTaskCount() ?? 0;

    const {hoverProps, isHovered} = useHover({});

    const {pressProps, isPressed} = usePress({
        onPress: () => {
            if (!isMaxExpandedTaskDepth) {
                onAreChildTasksExpandedToggle();
            } else {
                if (task) navigate(`/task/${task.id}`);
            }
        },
    });

    useImperativeHandle(
        ref,
        () => ({
            isFocusable: () => platform !== "mobile",
            focus: () => {
                if (platform !== "mobile") {
                    assertExists(buttonRef.current).focus();
                }
            },
        }),
        [platform],
    );

    return (
        <Tooltip
            content={
                isMaxExpandedTaskDepth
                    ? "Open to see subtasks"
                    : areChildTasksExpanded
                      ? "Collapse subtasks"
                      : "Expand subtasks"
            }
        >
            <FocusRing offset="0">
                <div
                    {...mergeProps(hoverProps, pressProps, {onKeyDown})}
                    ref={buttonRef}
                    className={buttonClassName}
                    // Focusable by keyboard navigation.
                    //
                    // Except on mobile! In mobile mode we expect the user to be interacting with touch
                    // and not have access to a physical keyboard. If the virtual keyboard is open
                    // (since they're editing text) and they expand/collapse a task then we don't want
                    // to move focus to the button causing the keyboard to close. Ideally this could be
                    // focusable on mobile but we prevent moving focus and closing the keyboard with
                    // `event.preventDefault()` but this doesn't seem possible.
                    tabIndex={platform !== "mobile" ? -1 : undefined}
                    style={{
                        paddingRight: isMaxExpandedTaskDepth ? spacing["1.5"] : undefined,
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
                        {`${closedChildTaskCount}/${childTaskCount}`}
                    </div>
                    {!isMaxExpandedTaskDepth && (
                        <CaretUp
                            // When our grid view resets (we find out through a `stateKey` change) we don't
                            // want to animate our caret. By setting it as a key here React will fully destroy
                            // and recreate this component skipping the transition animation.
                            key={stateKey}
                            size={spacing["3"]}
                            style={{
                                transform: areChildTasksExpanded
                                    ? "rotate(180deg)"
                                    : "rotate(0deg)",
                                transition: "transform 200ms ease",
                            }}
                        />
                    )}
                </div>
            </FocusRing>
        </Tooltip>
    );
}
