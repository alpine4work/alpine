import classNames from "classnames";
import {
    KeyboardEvent,
    Memo,
    Ref,
    forwardRef,
    memo,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/web/helpers/use_hover_with_overlay_support.js";
import {sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {getTaskPriorityName} from "~/client/web/tasks/get_task_priority_name.js";
import {
    TaskPriorityInput,
    TaskPriorityInputRef,
} from "~/client/web/tasks/internal/task_priority_input.js";
import {TaskGridViewColumn} from "~/client/web/tasks/internal/task_row_view.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskPriorityIcon} from "~/client/web/tasks/task_priority_icon.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";

export type TaskRowPriorityCellRef = {
    focusCell(): void;
    focusCellInput(): void;
    isFocusWithinCell(): boolean;
};

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

const TaskRowPriorityCellForwardRefMemo = memo(forwardRef(TaskRowPriorityCell));
export {TaskRowPriorityCellForwardRefMemo as TaskRowPriorityCell};

const cellClassName = sprinkles({
    flexShrink: "0",
    paddingX: taskRowViewColumnPaddingX,
    overflow: "hidden",
    height: taskRowViewMinHeight,
    display: "flex",
    alignItems: "center",
});

const previewClassName = sprinkles({
    maxWidth: "full",
    height: "4",
    display: "inline-flex",
    alignItems: "center",
    gap: "1",
    userSelect: "text",
});

const previewNameClassName = sprinkles({
    fontStyle: "truncate",
});

function TaskRowPriorityCell(
    {
        isReadOnly: isActuallyReadOnly,
        store,
        task,
        disableExpensiveFeaturesDuringScroll,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusNextCell,
        focusPreviousCell,
        commitActionTransaction,
    }: {
        isReadOnly: boolean;
        store: TaskClientReadonlyStore;
        task: TaskModel | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void
        >;
    },
    ref: Ref<TaskRowPriorityCellRef>,
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

    const priority = task?.getPriority() ?? null;

    const cellRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<TaskPriorityInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    // Disable expensive features until the user hovers/focuses the cell in question
    // while not scrolling.
    //
    // This improves scroll performance and initial load performance. Since we only
    // need to render the read-only version of a cell on initial load.
    const [_disableExpensiveFeatures, setDisableExpensiveFeatures] = useState(true);
    let disableExpensiveFeatures = _disableExpensiveFeatures;
    if (
        disableExpensiveFeatures &&
        !disableExpensiveFeaturesDuringScroll &&
        (isHovered || isFocusWithin)
    ) {
        disableExpensiveFeatures = false;
        setDisableExpensiveFeatures(false);
    }

    // Treat the cell as read-only while expensive features are disabled.
    const isReadOnly = isActuallyReadOnly || disableExpensiveFeatures;

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInput: () => {
                if (isReadOnly) {
                    assertExists(cellRef.current).focus();
                } else {
                    assertExists(inputRef.current).focus();
                }
            },
            isFocusWithinCell: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(cellRef.current), document.activeElement),
        }),
        [isReadOnly],
    );

    const handlePriorityChange = (priority: TaskPriority | null) => {
        commitActionTransaction(taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priority,
                },
            },
        ]);
    };

    return (
        <FocusRing
            isVisibleFromAnyFocus={true}
            offset="0"
            insetTop="border"
            // Render underneath the combobox overlay.
            overlayZIndex="-10"
        >
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                data-testid={
                    process.env.NODE_ENV !== "production" ? "TaskRowPriorityCell" : undefined
                }
                tabIndex={-1}
                className={classNames(
                    !isActuallyReadOnly && tasksStyles.textCursorNotInheritedClassName,
                    cellClassName,
                )}
                style={{
                    width: taskRowViewColumnWidth,
                    opacity: priority || isHovered || isFocusWithin ? 1 : 0,
                }}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: () => assertExists(inputRef.current).focus(),
                    onSelectAll: () => assertExists(inputRef.current).focus(),
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDown={event => {
                    switch (event.key) {
                        case "Backspace":
                        case "Delete": {
                            if (event.currentTarget === event.target) {
                                event.preventDefault();
                                event.stopPropagation();

                                if (!isReadOnly) {
                                    handlePriorityChange(null);
                                }
                            }
                            break;
                        }
                        default: {
                            onCellKeyDown("Priority", event);
                            break;
                        }
                    }
                }}
                onKeyDownCapture={event => onCellKeyDownCapture("Priority", event)}
            >
                {isReadOnly ? (
                    priority && (
                        <div
                            className={previewClassName}
                            style={{
                                // Get around the `textCursorNotInheritedClassName` reset.
                                cursor: "text",
                                // `display: inline-flex` creates an inline layout which adds extra space below the
                                // element. Adding `vertical-align` stops the space from being added.
                                // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                                verticalAlign: "top",
                            }}
                        >
                            <TaskPriorityIcon
                                size="4"
                                priority={priority}
                                // If a task is closed, suppress the urgent warning.
                                shouldHighlightUrgent={task?.getDisplayStatus() !== "Closed"}
                            />
                            <span className={previewNameClassName}>
                                {getTaskPriorityName(priority)}
                            </span>
                        </div>
                    )
                ) : (
                    <TaskPriorityInput
                        ref={inputRef}
                        aria-label="Priority"
                        // If a task is closed, suppress the urgent warning.
                        shouldHighlightUrgent={task?.getDisplayStatus() !== "Closed"}
                        priority={priority}
                        onPriorityChange={handlePriorityChange}
                        // Keyboard navigation in grid view is not done with the tab key.
                        isTabbable={false}
                        onArrowLeftLeaveKeyDown={() => focusPreviousCell("Priority")}
                        onArrowRightLeaveKeyDown={() => focusNextCell("Priority")}
                    />
                )}
            </div>
        </FocusRing>
    );
}
