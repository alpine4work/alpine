import {CalendarDate} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {formatTaskDate} from "~/client/tasks/demo_2/internal/format_task_date";
import {TaskDateInputCalendar} from "~/client/tasks/demo_2/internal/task_date_input_calendar";
import {TaskDateInputText} from "~/client/tasks/demo_2/internal/task_date_input_text";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";

/**
 * The date field displays the formatted date we show everywhere but when
 * you click or focus we reveal a text input where you can type the date in
 * your locale.
 */
export function TaskDateInput({
    date,
    onDateChange,
    shouldIncludeCalendarIcon = false,
    shouldWarnIfAfterDate = false,
    shouldFormatToday = false,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    height = "4",
    paddingX = "0",
    focusRingOffset,
    color = "grey-text",
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
    shouldIncludeCalendarIcon?: boolean;
    shouldWarnIfAfterDate?: boolean;
    shouldFormatToday?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    height?: "full" | "4";
    paddingX?: "0" | "1";
    focusRingOffset?: "0";
    color?: "grey-text" | "grey-60";
}) {
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();
    const inputRef = useRef<HTMLDivElement>(null);

    const formattedDate = useMemo(
        () =>
            date
                ? formatTaskDate({
                      timeZone,
                      locale,
                      currentDate,
                      date,
                      shouldFormatToday,
                  })
                : null,
        [currentDate, date, locale, shouldFormatToday, timeZone],
    );

    const [isFocusWithinInput, setIsFocusWithinInput] = useState(false);
    const [isFocusWithinOverlay, setIsFocusWithinOverlay] = useState(false);

    const isEditing = isFocusWithinInput || isFocusWithinOverlay;

    return (
        <Box position="relative" height={height}>
            {!isEditing && formattedDate && (
                <Box
                    // Inline flex so the clickable range doesn't extend beyond the
                    // input's contents.
                    display="inline-flex"
                    alignItems="stretch"
                    height="full"
                    paddingX={paddingX}
                    color={shouldWarnIfAfterDate && formattedDate.isAfterDate ? "red-60" : color}
                    cursor="text"
                >
                    {shouldIncludeCalendarIcon && (
                        <Box
                            paddingRight="1"
                            onClick={() => {
                                getNextFocusableElementIfExists(null, {
                                    withinElement: assertExists(inputRef.current),
                                })?.focus();
                            }}
                        >
                            <CalendarBlank size={spacing["4"]} />
                        </Box>
                    )}
                    {formattedDate.dateString.split(" ").map((segment, index, segments) => (
                        <Box
                            key={index}
                            style={{
                                // Don't collapse space.
                                whiteSpace: "pre",
                            }}
                            onClick={() => {
                                getNextFocusableElementIfExists(null, {
                                    withinElement: assertExists(inputRef.current),
                                    // NOTE(calebmer): Small UX improvement, focus the input segment the user
                                    // clicked on. It's a little strange how the preview text transforms into
                                    // editable text. Especially disorienting when you click the end and the start
                                    // is focused. So attempt to focus the same segment the user clicked.
                                    //
                                    // We hope that the words separated by spaces in our date line up with the
                                    // editable input segments which is the case with the en-US locale but this
                                    // heuristic may need to be hardened for other locales.
                                    skipElements: index,
                                })?.focus();
                            }}
                        >
                            {segment}
                            {index < segments.length - 1 && " "}
                        </Box>
                    ))}
                </Box>
            )}
            <OverlayAnimated
                isVisible={isEditing}
                // Focusing is a direct user interaction so don't animate. To focus out the
                // user clicks somewhere else which is an indirect interaction so animate.
                disableAnimationIn
                placement="bottom-start"
                offset={defaultTooltipOffset}
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
                        <TaskDateInputCalendar date={date} onDateChange={onDateChange} />
                    </Box>
                }
            >
                <FocusRing offset={focusRingOffset} isVisibleWhenFocusWithin>
                    <Box
                        ref={inputRef}
                        width="full"
                        height={height}
                        position={!isEditing && formattedDate ? "absolute" : "relative"}
                        top={!isEditing && formattedDate ? "0" : undefined}
                        pointerEvents={!isEditing && formattedDate ? "none" : undefined}
                        style={{opacity: !isEditing && formattedDate ? 0 : undefined}}
                        onFocus={event => {
                            setIsFocusWithinInput(event.currentTarget.contains(event.target));
                        }}
                        onBlur={event => {
                            setIsFocusWithinInput(
                                event.currentTarget.contains(event.relatedTarget),
                            );
                        }}
                    >
                        <TaskDateInputText
                            date={date}
                            onDateChange={onDateChange}
                            aria-label={ariaLabel}
                            aria-labelledby={ariaLabelledBy}
                            isEditing={isEditing}
                            shouldIncludeCalendarIcon={shouldIncludeCalendarIcon}
                            height={height}
                            paddingX={paddingX}
                            color={color}
                        />
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}
