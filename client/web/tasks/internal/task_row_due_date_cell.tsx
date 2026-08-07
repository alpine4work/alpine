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
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/web/helpers/use_hover_with_overlay_support.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {formatTaskDate} from "~/client/web/tasks/format_task_date.js";
import {TaskDateInput} from "~/client/web/tasks/internal/task_date_input.js";
import {TaskGridViewColumn} from "~/client/web/tasks/internal/task_row_view.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type TaskRowDueDateCellRef = {
    focusCell(): void;
    focusCellInputStart(): void;
    focusCellInputEnd(): void;
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

const TaskRowDueDateCellForwardRefMemo = memo(forwardRef(TaskRowDueDateCell));
export {TaskRowDueDateCellForwardRefMemo as TaskRowDueDateCell};

const cellClassName = sprinkles({
    flexShrink: "0",
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
    color: "grey-100",
});

const previewIconClassName = sprinkles({
    flexShrink: "0",
});

const previewTextClassName = sprinkles({
    flexGrow: "1",
});

function TaskRowDueDateCell(
    {
        isReadOnly: isActuallyReadOnly,
        store,
        task,
        disableExpensiveFeaturesDuringScroll,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusPreviousCell,
        focusNextCell,
        commitActionTransaction,
    }: {
        isReadOnly: boolean;
        store: TaskClientReadonlyStore;
        task: TaskModel | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void
        >;
    },
    ref: Ref<TaskRowDueDateCellRef>,
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

    const dueDate = task?.getDueDate() ?? null;
    const shouldWarnIfAfterDate = !!task && task.getDisplayStatus() !== "Closed";

    const cellRef = useRef<HTMLDivElement>(null);
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
            isFocusWithinCell: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(cellRef.current), document.activeElement),
        }),
        [],
    );

    const handleDueDateChange = (dueDate: CalendarDate | null) => {
        commitActionTransaction(taskId => [
            {
                type: "UpdateTask",
                time: store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate,
                },
            },
        ]);
    };

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetTop="border">
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                data-testid={
                    process.env.NODE_ENV !== "production" ? "TaskRowDueDateCell" : undefined
                }
                tabIndex={-1}
                className={
                    isReadOnly
                        ? classNames(
                              !isActuallyReadOnly && tasksStyles.textCursorNotInheritedClassName,
                              cellClassName,
                          )
                        : cellClassName
                }
                style={{
                    width: taskRowViewColumnWidth,
                    opacity: dueDate || isHovered || isFocusWithin ? 1 : 0,
                }}
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
                                    handleDueDateChange(null);
                                }
                            }
                            break;
                        }
                        default: {
                            onCellKeyDown("DueDate", event);
                            break;
                        }
                    }
                }}
                onKeyDownCapture={event => onCellKeyDownCapture("DueDate", event)}
            >
                {isReadOnly ? (
                    dueDate && (
                        <TaskRowDueDateCellPreview
                            dueDate={dueDate}
                            shouldWarnIfAfterDate={shouldWarnIfAfterDate}
                        />
                    )
                ) : (
                    <TaskDateInput
                        aria-label="Due date"
                        display="block"
                        height="full"
                        paddingX={taskRowViewColumnPaddingX}
                        overlayOffset="-1"
                        focusRingAroundText={true}
                        shouldIncludeCalendarIcon={true}
                        shouldWarnIfAfterDate={shouldWarnIfAfterDate}
                        shouldFormatAroundToday={true}
                        date={dueDate}
                        onDateChange={handleDueDateChange}
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

function TaskRowDueDateCellPreview({
    dueDate,
    shouldWarnIfAfterDate,
}: {
    dueDate: CalendarDate;
    shouldWarnIfAfterDate: boolean;
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
                shouldWarnIfAfterDate && formattedDate.isAfterDate
                    ? previewAfterDueDateClassName
                    : previewBeforeDueDateClassName
            }
            style={{
                whiteSpace: "nowrap",
                // Get around the `textCursorNotInheritedClassName` reset.
                cursor: "text",
            }}
        >
            <CalendarBlank size={spacing["4"]} className={previewIconClassName} />
            <div className={previewTextClassName}>{formattedDate.dateString}</div>
        </div>
    );
}
