import {CalendarDate} from "@internationalized/date";
import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {TaskDateInput} from "~/client/tasks/demo_2/internal/task_date_input.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {tasksStyles} from "~/shared/styles/styles.js";

export type TaskRowDueDateCellRef = {
    focusStart(): void;
    focusEnd(): void;
};

const TaskRowDueDateCellForwardRef = forwardRef(TaskRowDueDateCell);
export {TaskRowDueDateCellForwardRef as TaskRowDueDateCell};

function TaskRowDueDateCell(
    {
        dueDate,
        onDueDateChange,
        focusTaskPreviousCell,
        focusTaskNextCell,
    }: {
        dueDate: CalendarDate | null;
        onDueDateChange: (dueDate: CalendarDate | null) => void;
        focusTaskPreviousCell: () => void;
        focusTaskNextCell: () => void;
    },
    ref: Ref<TaskRowDueDateCellRef>,
) {
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusStart: () => {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(inputContainerRef.current),
                })?.focus();
            },
            focusEnd: () => {
                getLastFocusableElementIfExists({
                    withinElement: assertExists(inputContainerRef.current),
                })?.focus();
            },
        }),
        [],
    );

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            width={taskRowViewColumnWidth}
            overflow="hidden"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => {
                    getLastFocusableElementIfExists({
                        withinElement: assertExists(inputContainerRef.current),
                    })?.focus({preventScroll: true});
                },
                onSelectAll: () => {
                    getLastFocusableElementIfExists({
                        withinElement: assertExists(inputContainerRef.current),
                    })?.focus({preventScroll: true});
                },
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
        >
            <Box
                ref={inputContainerRef}
                height={taskRowViewMinHeight}
                display="flex"
                alignItems="center"
                opacity={dueDate || isHovered || isFocusWithin ? "100" : "0"}
            >
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
                    onDateChange={onDueDateChange}
                    onArrowLeftLeaveKeyDown={focusTaskPreviousCell}
                    onArrowRightLeaveKeyDown={focusTaskNextCell}
                />
            </Box>
        </Box>
    );
}
