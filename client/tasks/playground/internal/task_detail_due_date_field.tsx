import {
    CalendarDate,
    DateDuration,
    DateValue,
    createCalendar,
    endOfMonth,
    endOfWeek,
    getWeeksInMonth,
    isWeekend,
    startOfMonth,
    startOfWeek,
} from "@internationalized/date";
import {CalendarBlank, CaretLeft, CaretRight} from "phosphor-react";
import {useCallback, useMemo, useRef, useState} from "react";
import {
    AriaCalendarProps,
    AriaDateFieldProps,
    mergeProps,
    useCalendar,
    useCalendarCell,
    useCalendarGrid,
    useDateField,
    useDateFormatter,
    useDateSegment,
} from "react-aria";
import {
    CalendarState,
    CalendarStateOptions,
    DateFieldState,
    DateFieldStateOptions,
    DateSegment,
    useCalendarState,
    useDateFieldState,
} from "react-stately";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {IconButton} from "~/client/design/icon_button";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {Spacer} from "~/client/design/spacer";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {formatTaskDueDate} from "~/client/tasks/playground/internal/format_task_due_date";
import {TaskStatus} from "~/client/tasks/playground/task_status_button";
import {spacing} from "~/shared/design/spacing";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {sprinkles} from "~/shared/styles/styles";

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
                        status === "Open" && formattedDueDate.isAfterDueDate ? "red-60" : undefined
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
                        />
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}

function TaskDetailDueDateFieldInput({
    dueDate,
    onDueDateChange,
    "aria-labelledby": ariaLabelledBy,
}: {
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    "aria-labelledby": string;
}) {
    const {locale} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldProps<CalendarDate> = {
        locale,
        createCalendar,
        "aria-labelledby": ariaLabelledBy,
        // The types are wrong. These hooks actually support `CalendarDate | null`.
        value: dueDate as DateValue,
        onChange: onDueDateChange as (value: DateValue) => void,
    };

    const state = useDateFieldState(datePickerProps);

    const isPlaceholder = state.segments.every(
        segment => !segment.isEditable || segment.isPlaceholder,
    );

    const ref = useRef<HTMLDivElement>(null);
    const {fieldProps} = useDateField(datePickerProps, state, ref);

    return (
        <Box
            display="flex"
            alignItems="center"
            gap="1"
            color={isPlaceholder ? "grey-50" : "grey-text"}
            cursor="text"
            onPointerDown={event => {
                if (event.target === event.currentTarget) {
                    // Don't unfocus field segments when clicking on icon or margin.
                    event.preventDefault();
                }
            }}
        >
            <CalendarBlank size={spacing["4"]} className={sprinkles({pointerEvents: "none"})} />
            <Box {...fieldProps} ref={ref} display="flex">
                {state.segments.map((segment, i) => (
                    <TaskDetailDueDateFieldInputSegment key={i} state={state} segment={segment} />
                ))}
            </Box>
        </Box>
    );
}

function TaskDetailDueDateFieldInputSegment({
    state,
    segment,
}: {
    state: DateFieldState;
    segment: DateSegment;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const {segmentProps} = useDateSegment(segment, state, ref);
    const [isFocused, setIsFocused] = useState(false);

    return (
        <Box
            {...mergeProps(segmentProps, {
                onFocus: () => setIsFocused(true),
                onBlur: () => setIsFocused(false),
            })}
            ref={ref}
            // NOCOMMIT: Grey is too low contrast in dark mode
            backgroundColor={isFocused ? "grey-5" : undefined}
            color={segment.isPlaceholder ? "grey-50" : undefined}
            paddingX={segment.isEditable ? "0.5" : undefined}
            borderRadius={segment.isEditable ? "sm" : undefined}
            style={{...segmentProps.style}}
        >
            {segment.text}
        </Box>
    );
}

function TaskDetailDueDateFieldCalendar({
    dueDate,
    onDueDateChange,
}: {
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
}) {
    const {locale, timeZone} = useClientInfo();
    const currentDate = useCurrentDate();

    const [focusedDate, setFocusedDate] = useState(dueDate ?? currentDate);

    const {calendarName, calendar} = useMemo(() => {
        const calendarName = new Intl.DateTimeFormat(locale).resolvedOptions().calendar;
        const calendar = createCalendar(calendarName);
        return {calendarName, calendar};
    }, [locale]);

    const calendarProps: CalendarStateOptions & AriaCalendarProps<DateValue> = {
        locale,
        createCalendar: useCallback(
            actualCalendarName => {
                assert(actualCalendarName === calendarName);
                return calendar;
            },
            [calendar, calendarName],
        ),
        // The types are wrong. These hooks actually support `CalendarDate | null`.
        value: dueDate as DateValue,
        onChange: onDueDateChange as (value: DateValue) => void,
        focusedValue: focusedDate,
        onFocusChange: setFocusedDate,
        // When we are at the end of the month you probably want to select dates next
        // month. Showing two months at once saves you a click when you're near the end
        // of the month.
        selectionAlignment: "start",
        visibleDuration: {months: 2},
    };

    const _state = useCalendarState(calendarProps);

    const actualStartDate = _state.visibleRange.start;

    // We want dates for the full week in the first and last weeks of the month. To
    // do this we modify our state such that that's our visible range. The
    // `useCalendarState()` hook doesn't see this modification but that's ok. We
    // want to use the month start date for navigation purposes.
    const state: typeof _state = {
        ..._state,
        visibleRange: {
            start: startOfWeek(_state.visibleRange.start, locale),
            end: endOfWeek(_state.visibleRange.end, locale),
        },
        isCellDisabled: date => {
            return (
                calendarProps.isDisabled ||
                date.compare(startOfWeek(_state.visibleRange.start, locale)) < 0 ||
                date.compare(endOfWeek(_state.visibleRange.end, locale)) > 0 ||
                _state.isInvalid(date)
            );
        },
        setFocusedDate: () => {
            // Noop for now. This is called at the same time as `selectDate()` by
            // `useCalendarCell()` but if we are selecting a date outside of
            // `useCalendarState()`s visible range we don't want to update the
            // start/end dates.
        },
    };

    const {
        calendarProps: calendarDomProps,
        prevButtonProps,
        nextButtonProps,
    } = useCalendar(calendarProps, state);

    // We manually adapt button props to our icon button component. Make sure there
    // are no more props than what we expect.
    const expectedButtonProps = new Set([
        "aria-label",
        "isDisabled",
        "onPress",
        "onFocus",
        "onBlur",
    ]);
    assert(isDeepEqual(new Set(Object.keys(nextButtonProps)), expectedButtonProps));
    assert(isDeepEqual(new Set(Object.keys(prevButtonProps)), expectedButtonProps));

    const monthDateFormatter = useDateFormatter({
        month: "long",
        year: "numeric",
        timeZone,
    });

    return (
        <Box {...calendarDomProps} padding="3" paddingBottom="2">
            <Box display="flex" paddingBottom="3">
                <IconButton
                    size="xs"
                    withoutTooltip
                    description={assertExists(prevButtonProps["aria-label"])}
                    isDisabled={assertExists(prevButtonProps["isDisabled"])}
                    onFocus={assertExists(prevButtonProps["onFocus"])}
                    onBlur={assertExists(prevButtonProps["onBlur"])}
                    onPress={assertExists(prevButtonProps["onPress"])}
                >
                    <CaretLeft />
                </IconButton>
                <Box flexGrow="1" textAlign="center" fontStyle="semi-bold">
                    {monthDateFormatter.format(actualStartDate.toDate(timeZone))}
                </Box>
                <Spacer space="4" />
                <Spacer space="4" />
                <Box flexGrow="1" textAlign="center" fontStyle="semi-bold">
                    {monthDateFormatter.format(actualStartDate.add({months: 1}).toDate(timeZone))}
                </Box>
                <IconButton
                    size="xs"
                    withoutTooltip
                    description={assertExists(nextButtonProps["aria-label"])}
                    isDisabled={assertExists(nextButtonProps["isDisabled"])}
                    onFocus={assertExists(nextButtonProps["onFocus"])}
                    onBlur={assertExists(nextButtonProps["onBlur"])}
                    onPress={assertExists(nextButtonProps["onPress"])}
                >
                    <CaretRight />
                </IconButton>
            </Box>
            <Box display="flex" gap="4">
                <Box>
                    <TaskDetailDueDateFieldCalendarGrid
                        state={state}
                        actualStartDate={actualStartDate}
                        currentDate={currentDate}
                    />
                </Box>
                <Box>
                    <TaskDetailDueDateFieldCalendarGrid
                        state={state}
                        actualStartDate={actualStartDate}
                        currentDate={currentDate}
                        offset={{months: 1}}
                    />
                </Box>
            </Box>
            <Box
                marginTop="3"
                paddingTop="2"
                borderTop={{light: "grey-5", dark: "grey-10"}}
                display="flex"
                justifyContent="flex-end"
            >
                <Button
                    variant="quiet-above-dark-grey-5-background"
                    height="5"
                    paddingX="2"
                    onPress={() => onDueDateChange(null)}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
}

function TaskDetailDueDateFieldCalendarGrid({
    state,
    actualStartDate,
    currentDate,
    offset = {},
}: {
    state: CalendarState;
    actualStartDate: CalendarDate;
    currentDate: CalendarDate;
    offset?: DateDuration;
}) {
    const {locale} = useClientInfo();

    const startDate = actualStartDate.add(offset);
    const endDate = endOfMonth(startDate);

    const {gridProps, headerProps, weekDays} = useCalendarGrid({startDate, endDate}, state);

    const weeksInMonth = getWeeksInMonth(startDate, locale);

    return (
        <table {...gridProps} cellPadding="0">
            <thead {...headerProps}>
                <tr>
                    {weekDays.map((day, index) => (
                        <th key={index}>
                            <div
                                className={sprinkles({
                                    width: "6",
                                    height: "6",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    fontSize: "50",
                                    fontStyle: "semi-bold",
                                    color: "grey-60",
                                })}
                            >
                                {day}
                            </div>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {createArrayWithLength(weeksInMonth, weekIndex => (
                    <tr key={weekIndex}>
                        {state
                            .getDatesInWeek(weekIndex, startDate)
                            .map((date, i) =>
                                date ? (
                                    <TaskDetailDueDateFieldCalendarCell
                                        key={i}
                                        state={state}
                                        date={date}
                                        gridStartDate={startDate}
                                        currentDate={currentDate}
                                    />
                                ) : (
                                    <td key={i} />
                                ),
                            )}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function TaskDetailDueDateFieldCalendarCell({
    state,
    date,
    gridStartDate,
    currentDate,
}: {
    state: CalendarState;
    date: CalendarDate;
    gridStartDate: CalendarDate;
    currentDate: CalendarDate;
}) {
    const {locale} = useClientInfo();
    const ref = useRef<HTMLDivElement>(null);

    const isDimmed =
        isWeekend(date, locale) ||
        date.compare(startOfMonth(gridStartDate)) < 0 ||
        date.compare(endOfMonth(gridStartDate)) > 0;

    const isCurrentDate = date.compare(currentDate) === 0;

    const {cellProps, buttonProps, isSelected, formattedDate} = useCalendarCell({date}, state, ref);

    return (
        <td {...cellProps}>
            <div {...buttonProps} ref={ref}>
                <div
                    // Put border radius on a nested `<div>` so entire parent is clickable.
                    className={sprinkles({
                        width: "6",
                        height: "6",
                        fontSize: "50",
                        fontStyle: isCurrentDate && !isDimmed ? "ultra-bold" : undefined,
                        borderRadius: "full",
                        backgroundColor: isSelected
                            ? {light: "grey-5", dark: "grey-10"}
                            : undefined,
                        color:
                            isCurrentDate && !isDimmed
                                ? {light: "theme-60", dark: "theme-70"}
                                : isDimmed && !isSelected
                                ? {light: "grey-40", dark: "grey-50"}
                                : undefined,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                    })}
                >
                    {formattedDate}
                </div>
            </div>
        </td>
    );
}
