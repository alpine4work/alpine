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
import {CaretLeft, CaretRight} from "phosphor-react";
import {useCallback, useMemo, useRef, useState} from "react";
import {
    AriaCalendarProps,
    mergeProps,
    useCalendar,
    useCalendarCell,
    useCalendarGrid,
    useDateFormatter,
    useHover,
} from "react-aria";
import {CalendarState, CalendarStateOptions, useCalendarState} from "react-stately";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {Spacer} from "~/client/design/spacer";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {spacing} from "~/shared/design/spacing";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {sprinkles} from "~/shared/styles/styles";

export function TaskDateFieldCalendar({
    date,
    onDateChange,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
}) {
    const {locale, timeZone} = useClientInfo();
    const currentDate = useCurrentDate();

    const [focusedDate, setFocusedDate] = useState(date ?? currentDate);

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
        value: date as DateValue,
        onChange: onDateChange as (value: DateValue) => void,
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
    const actualEndDate = _state.visibleRange.end;

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
                    variant="quiet-above-grey-5-dark-background"
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
                    variant="quiet-above-grey-5-dark-background"
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
            <Box display="flex" gap="3">
                <Box>
                    <TaskDateFieldCalendarGrid
                        state={state}
                        actualStartDate={actualStartDate}
                        actualEndDate={actualEndDate}
                        currentDate={currentDate}
                    />
                </Box>
                <Box>
                    <TaskDateFieldCalendarGrid
                        state={state}
                        actualStartDate={actualStartDate}
                        actualEndDate={actualEndDate}
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
                    variant="quiet-above-grey-5-dark-background"
                    height="5"
                    paddingX="2"
                    onPress={() => onDateChange(null)}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
}

function TaskDateFieldCalendarGrid({
    state,
    actualStartDate,
    actualEndDate,
    currentDate,
    offset = {},
}: {
    state: CalendarState;
    actualStartDate: CalendarDate;
    actualEndDate: CalendarDate;
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
                                    width: "7",
                                    height: "7",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    fontSize: "75",
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
                                    <TaskDateFieldCalendarCell
                                        key={i}
                                        state={state}
                                        actualStartDate={actualStartDate}
                                        actualEndDate={actualEndDate}
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

function TaskDateFieldCalendarCell({
    state,
    actualStartDate,
    actualEndDate,
    date,
    gridStartDate,
    currentDate,
}: {
    state: CalendarState;
    actualStartDate: CalendarDate;
    actualEndDate: CalendarDate;
    date: CalendarDate;
    gridStartDate: CalendarDate;
    currentDate: CalendarDate;
}) {
    const {locale} = useClientInfo();
    const ref = useRef<HTMLDivElement>(null);
    const {hoverProps, isHovered} = useHover({});

    const isDimmed =
        isWeekend(date, locale) ||
        date.compare(startOfMonth(gridStartDate)) < 0 ||
        date.compare(endOfMonth(gridStartDate)) > 0;

    const isCurrentDate = date.compare(currentDate) === 0;

    const {
        cellProps,
        buttonProps,
        isPressed,
        isSelected: _isSelected,
        formattedDate,
    } = useCalendarCell({date}, state, ref);

    const isDateSameMonthAsGridStartDate =
        date.month === gridStartDate.month && date.year === gridStartDate.year;

    // We only want to show the selected circle once. When we have overlapping
    // dates between adjacent months, only show the selected circle around the date
    // in its month.
    //
    // For overflow dates at the start/end of the calendar grids we want to show
    // the selected circle there too since we don't render the adjacent month.
    const isSelected =
        isPressed ||
        (_isSelected &&
            (isDateSameMonthAsGridStartDate ||
                date.compare(actualStartDate) < 0 ||
                date.compare(actualEndDate) > 0));

    return (
        <td {...cellProps}>
            <div {...mergeProps(buttonProps, hoverProps)} ref={ref} style={{padding: 1}}>
                <div
                    // Put border radius on a nested `<div>` so entire parent is clickable.
                    className={sprinkles({
                        fontSize: "75",
                        fontStyle: isCurrentDate && !isDimmed ? "ultra-bold" : undefined,
                        borderRadius: "full",
                        backgroundColor: isSelected
                            ? {light: "grey-10", dark: "grey-20"}
                            : // We use a hover state here since picking the right date requires some motor
                            // precision. So hovering helps reduce the mental load as your mouse tracks to
                            // the right position.
                            isHovered
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
                    style={{
                        width: `calc(${spacing["7"]} - 2px)`,
                        height: `calc(${spacing["7"]} - 2px)`,
                    }}
                >
                    {formattedDate}
                </div>
            </div>
        </td>
    );
}
