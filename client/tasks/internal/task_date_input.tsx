import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useMemo, useRef, useState} from "react";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {formatTaskDate} from "~/client/tasks/internal/format_task_date.js";
import {TaskDateInputCalendar} from "~/client/tasks/internal/task_date_input_calendar.js";
import {TaskDateInputText} from "~/client/tasks/internal/task_date_input_text.js";
import {RemLength, Spacing, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {greyElevated2ClassName, sprinkles} from "~/shared/styles/styles.js";

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

/**
 * The date field displays the formatted date we show everywhere but when
 * you click or focus we reveal a text input where you can type the date in
 * your locale.
 */
export function TaskDateInput({
    date,
    onDateChange,
    isReadOnly = false,
    shouldIncludeCalendarIcon = false,
    shouldWarnIfAfterDate = false,
    shouldFormatAroundToday = false,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    display = "inline",
    height = "4",
    paddingX = "0",
    color = "grey-text",
    overlayPlacement = "bottom-start",
    overlayOffset = defaultTooltipOffset,
    focusRingOffset,
    focusRingAroundText = false,
    isTabbable = true,
    onArrowLeftLeaveKeyDown,
    onArrowRightLeaveKeyDown,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
    isReadOnly?: boolean;
    shouldIncludeCalendarIcon?: boolean;
    shouldWarnIfAfterDate?: boolean;
    shouldFormatAroundToday?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    display?: "inline" | "block";
    height?: "full" | "4";
    paddingX?: "0" | "1" | "1.5";
    color?: "grey-text" | "grey-60";
    overlayPlacement?: OverlayPlacement;
    overlayOffset?: Spacing | `-${Spacing}` | RemLength;
    focusRingOffset?: "0";
    focusRingAroundText?: boolean;
    isTabbable?: boolean;
    onArrowLeftLeaveKeyDown?: () => void;
    onArrowRightLeaveKeyDown?: () => void;
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
                      shouldFormatAroundToday,
                  })
                : null,
        [currentDate, date, locale, shouldFormatAroundToday, timeZone],
    );

    const [isFocusWithinInput, setIsFocusWithinInput] = useState(false);
    const [isFocusWithinOverlay, setIsFocusWithinOverlay] = useState(false);

    const isEditing = !isReadOnly && (isFocusWithinInput || isFocusWithinOverlay);

    return (
        <div
            className={sprinkles({
                position: "relative",
                height,
                width: display === "block" ? "full" : undefined,
            })}
        >
            {!isEditing && formattedDate && (
                <div
                    className={sprinkles({
                        // Inline flex so the clickable range doesn't extend beyond the
                        // input's contents.
                        display: display === "inline" ? "inline-flex" : "flex",
                        alignItems: "stretch",
                        height: "full",
                        color:
                            shouldWarnIfAfterDate && formattedDate.isAfterDate ? "red-60" : color,
                        cursor: !isReadOnly ? "text" : undefined,
                        userSelect: isReadOnly ? "text" : undefined,
                    })}
                >
                    {shouldIncludeCalendarIcon && (
                        <div
                            className={sprinkles({
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: paddingX,
                                paddingRight: "1",
                            })}
                            onClick={() => {
                                getNextFocusableElementIfExists(null, {
                                    withinElement: assertExists(inputRef.current),
                                })?.focus();
                            }}
                        >
                            <CalendarBlank size={spacing["4"]} />
                        </div>
                    )}
                    {isReadOnly || formattedDate.isFormattedAroundToday ? (
                        // Render read-only date inputs as a single div so they may be easily selected
                        // and copied/pasted.
                        <div
                            className={sprinkles({
                                flexGrow: display === "block" ? "1" : undefined,
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: !shouldIncludeCalendarIcon ? paddingX : undefined,
                                paddingRight: paddingX,
                            })}
                            onClick={() => {
                                getNextFocusableElementIfExists(null, {
                                    withinElement: assertExists(inputRef.current),
                                    // NOTE(calebmer): Small UX improvement, focus the day input segment if the
                                    // text is "Today" or "Yesterday".
                                    skipElements: 1,
                                })?.focus();
                            }}
                        >
                            {formattedDate.dateString}
                        </div>
                    ) : (
                        formattedDate.dateString.split(" ").map((segment, index, segments) => (
                            <div
                                key={index}
                                className={sprinkles({
                                    flexGrow:
                                        display === "block" && index === segments.length - 1
                                            ? "1"
                                            : undefined,
                                    display: "flex",
                                    alignItems: "center",
                                    paddingLeft:
                                        !shouldIncludeCalendarIcon && index === 0
                                            ? paddingX
                                            : undefined,
                                    paddingRight:
                                        index === segments.length - 1 ? paddingX : undefined,
                                })}
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
                            </div>
                        ))
                    )}
                </div>
            )}
            <OverlayAnimated
                isVisible={isEditing}
                // Focusing is a direct user interaction so don't animate. To focus out the
                // user clicks somewhere else which is an indirect interaction so animate.
                disableAnimationIn
                placement={overlayPlacement}
                offset={overlayOffset}
                overlay={
                    <div
                        className={classNames(
                            greyElevated2ClassName,
                            sprinkles({
                                borderRadius: "md",
                                backgroundColor: "grey-0",
                                boxShadow: "elevation-20",
                            }),
                        )}
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
                    </div>
                }
            >
                <div
                    ref={inputRef}
                    className={sprinkles({
                        width: "full",
                        height,
                        position: !isEditing && formattedDate ? "absolute" : "relative",
                        top: !isEditing && formattedDate ? "0" : undefined,
                        pointerEvents: !isEditing && formattedDate ? "none" : undefined,
                    })}
                    style={{opacity: !isEditing && formattedDate ? 0 : undefined}}
                    onFocus={event => {
                        setIsFocusWithinInput(event.currentTarget.contains(event.target));
                    }}
                    onBlur={event => {
                        setIsFocusWithinInput(event.currentTarget.contains(event.relatedTarget));
                    }}
                >
                    <TaskDateInputText
                        date={date}
                        onDateChange={onDateChange}
                        aria-label={ariaLabel}
                        aria-labelledby={ariaLabelledBy}
                        isReadOnly={isReadOnly}
                        isEditing={isEditing}
                        shouldIncludeCalendarIcon={shouldIncludeCalendarIcon}
                        display={display}
                        height={height}
                        paddingX={paddingX}
                        color={color}
                        focusRingOffset={focusRingOffset}
                        focusRingAroundText={focusRingAroundText}
                        isTabbable={isTabbable}
                        onArrowLeftLeaveKeyDown={onArrowLeftLeaveKeyDown}
                        onArrowRightLeaveKeyDown={onArrowRightLeaveKeyDown}
                    />
                </div>
            </OverlayAnimated>
        </div>
    );
}
