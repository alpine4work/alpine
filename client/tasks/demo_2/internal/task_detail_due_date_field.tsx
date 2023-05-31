import {CalendarDate} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {formatTaskDueDate} from "~/client/tasks/demo_2/internal/format_task_due_date";
import {TaskDetailDueDateFieldCalendar} from "~/client/tasks/demo_2/internal/task_detail_due_date_field_calendar";
import {TaskDetailDueDateFieldInput} from "~/client/tasks/demo_2/internal/task_detail_due_date_field_input";
import {TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";

/**
 * The due date field displays the formatted date we show everywhere but when
 * you click or focus we reveal a text input where you can type the date in
 * your locale.
 */
export function TaskDetailDueDateField({
    status,
    dueDate,
    onDueDateChange,
    "aria-labelledby": ariaLabelledBy,
}: {
    status: TaskStatus;
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    "aria-labelledby": string;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();
    const inputRef = useRef<HTMLDivElement>(null);

    const formattedDueDate = useMemo(
        () =>
            dueDate
                ? formatTaskDueDate({
                      timeZone,
                      locale,
                      currentDate,
                      dueDate,
                  })
                : null,
        [currentDate, dueDate, locale, timeZone],
    );

    const [isFocusWithinInput, setIsFocusWithinInput] = useState(false);
    const [isFocusWithinOverlay, setIsFocusWithinOverlay] = useState(false);

    const isEditing = isFocusWithinInput || isFocusWithinOverlay;

    return (
        <Box position="relative">
            {!isEditing && formattedDueDate && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    display="flex"
                    alignItems="center"
                    gap="1"
                    color={
                        status === "Open" && formattedDueDate.isAfterDueDate
                            ? "red-60"
                            : "grey-text"
                    }
                    cursor="text"
                    onClick={() => {
                        getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(inputRef.current),
                        })?.focus();
                    }}
                >
                    <CalendarBlank size={spacing["4"]} />
                    <Box>{formattedDueDate.dueDateString}</Box>
                </Box>
            )}
            <OverlayAnimated
                isVisible={isEditing}
                // Focusing is a direct user interaction so don't animate. To focus out the
                // user clicks somewhere else which is an indirect interaction so animate.
                disableAnimationIn
                placement="bottom-start"
                offset="2"
                overlay={
                    <Box
                        borderRadius="md"
                        backgroundColor={{light: "grey-0", dark: "grey-5"}}
                        boxShadow="elevation-20"
                        // Focusable so that if you click on the calendar without clicking a date, we
                        // consider the calendar focused and won't close the overlay.
                        tabIndex={-1}
                        onFocus={event => {
                            setIsFocusWithinOverlay(event.currentTarget.contains(event.target));
                        }}
                        onBlur={event => {
                            setIsFocusWithinOverlay(
                                event.currentTarget.contains(event.relatedTarget),
                            );
                        }}
                    >
                        <TaskDetailDueDateFieldCalendar
                            dueDate={dueDate}
                            onDueDateChange={onDueDateChange}
                        />
                    </Box>
                }
            >
                <FocusRing isVisibleWhenFocusWithin>
                    <Box
                        ref={inputRef}
                        pointerEvents={!isEditing && formattedDueDate ? "none" : undefined}
                        style={{opacity: !isEditing && formattedDueDate ? 0 : undefined}}
                        onFocus={event => {
                            setIsFocusWithinInput(event.currentTarget.contains(event.target));
                        }}
                        onBlur={event => {
                            setIsFocusWithinInput(
                                event.currentTarget.contains(event.relatedTarget),
                            );
                        }}
                    >
                        <TaskDetailDueDateFieldInput
                            dueDate={dueDate}
                            onDueDateChange={onDueDateChange}
                            aria-labelledby={ariaLabelledBy}
                            isEditing={isEditing}
                        />
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}
