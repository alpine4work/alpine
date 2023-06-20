import {CalendarDate} from "@internationalized/date";
import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {getLastFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {TaskDateInput} from "~/client/tasks/demo_2/internal/task_date_input";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";

export function TaskRowDueDateCell({
    dueDate,
    onDueDateChange,
}: {
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
}) {
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

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
                    shouldIncludeCalendarIcon={true}
                    shouldWarnIfAfterDate={true}
                    shouldFormatAroundToday={true}
                    date={dueDate}
                    onDateChange={onDueDateChange}
                />
            </Box>
        </Box>
    );
}
