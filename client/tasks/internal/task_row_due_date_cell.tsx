import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {
    KeyboardEvent,
    Memo,
    Ref,
    forwardRef,
    memo,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {formatTaskDate} from "~/client/tasks/internal/format_task_date.js";
import {TaskDateInput} from "~/client/tasks/internal/task_date_input.js";
import {TaskGridViewColumn} from "~/client/tasks/internal/task_row_view.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type TaskRowDueDateCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
    focusCellInputEnd(): void;
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

const TaskRowDueDateCellForwardRefMemo = memo(forwardRef(TaskRowDueDateCell));
export {TaskRowDueDateCellForwardRefMemo as TaskRowDueDateCell};

const cellClassName = sprinkles({
    flexShrink: "0",
    width: taskRowViewColumnWidth,
    height: taskRowViewMinHeight,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
});

const previewAfterDueDateClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    paddingX: taskRowViewColumnPaddingX,
    gap: "1",
    userSelect: "text",
    color: "red-60",
});

const previewBeforeDueDateClassName = sprinkles({
    display: "flex",
    alignItems: "center",
    paddingX: taskRowViewColumnPaddingX,
    gap: "1",
    userSelect: "text",
    color: "grey-text",
});

const previewIconClassName = sprinkles({
    flexShrink: "0",
});

const previewTextClassName = sprinkles({
    flexGrow: "1",
});

function TaskRowDueDateCell(
    {
        store,
        task,
        disableExpensiveFeaturesDuringScroll,
        onCellKeyDownCapture,
        focusPreviousCell,
        focusNextCell,
    }: {
        store: TaskClientStore;
        task: TaskModel | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
    },
    ref: Ref<TaskRowDueDateCellRef>,
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

    const context = useAppContext();

    const dueDate = task?.getDueDate() ?? null;

    const cellRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    // Disable expensive features until the user hovers/focuses the cell in
    // question while not scrolling.
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

    // NOTE(calebmer): We haven't implemented read-only task rows yet but when we
    // do the optimized cell implementation and read-only mode should share an
    // implementation.
    const isReadOnly = disableExpensiveFeatures;

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInputStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(cellRef.current).firstElementChild,
                })?.focus();
            },
            focusCellInputEnd: () => {
                getLastFocusableElementIfExists({
                    withinElement: assertExists(cellRef.current).lastElementChild,
                })?.focus();
            },
        }),
        [],
    );

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
                className={
                    isReadOnly
                        ? classNames(tasksStyles.textCursorNotInheritedClassName, cellClassName)
                        : cellClassName
                }
                style={{opacity: dueDate || isHovered || isFocusWithin ? 1 : 0}}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDownCapture={event => onCellKeyDownCapture("DueDate", event)}
            >
                {isReadOnly ? (
                    dueDate && <TaskRowDueDateCellPreview dueDate={dueDate} />
                ) : (
                    <TaskDateInput
                        aria-label="Due date"
                        display="block"
                        height="full"
                        paddingX={taskRowViewColumnPaddingX}
                        overlayPlacement="bottom"
                        overlayOffset="-1"
                        focusRingAroundText={true}
                        shouldIncludeCalendarIcon={true}
                        shouldWarnIfAfterDate={true}
                        shouldFormatAroundToday={true}
                        date={dueDate}
                        onDateChange={dueDate => {
                            if (!task) return;

                            store.commitTaskActionTransaction(context, [
                                {
                                    type: "UpdateTask",
                                    time: store.clock.now(),
                                    taskId: task.id,
                                    taskAction: {
                                        type: "UpdateDueDate",
                                        dueDate,
                                    },
                                },
                            ]);
                        }}
                        // Keyboard navigation in grid view is not done with the tab key.
                        isTabbable={false}
                        onArrowLeftLeaveKeyDown={() => focusPreviousCell("DueDate")}
                        onArrowRightLeaveKeyDown={() => focusNextCell("DueDate")}
                    />
                )}
            </div>
        </FocusRing>
    );
}

function TaskRowDueDateCellPreview({dueDate}: {dueDate: CalendarDate}) {
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

    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();

    const formattedDate = useMemo(
        () =>
            formatTaskDate({
                timeZone,
                locale,
                currentDate,
                date: dueDate,
                shouldFormatAroundToday: true,
            }),
        [currentDate, dueDate, locale, timeZone],
    );

    return (
        <div
            className={
                formattedDate.isAfterDate
                    ? previewAfterDueDateClassName
                    : previewBeforeDueDateClassName
            }
            style={{
                // Get around the `textCursorNotInheritedClassName` reset.
                cursor: "text",
            }}
        >
            <CalendarBlank size={spacing["4"]} className={previewIconClassName} />
            <div className={previewTextClassName}>{formattedDate.dateString}</div>
        </div>
    );
}
