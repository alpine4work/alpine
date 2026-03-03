import {
    CalendarDate,
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
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {RemLength, addRemLengths, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const taskDateInputCalendarDaySize = "8";
const taskDateInputCalendarDaySizeRem = parseRemLength(taskDateInputCalendarDaySize);

const taskDateInputCalendarWeekDayHeight = "6";
const taskDateInputCalendarWeekDayHeightRem = parseRemLength(taskDateInputCalendarWeekDayHeight);

const mobileTaskDateInputCalendarWeeksHeightRem = taskDateInputCalendarDaySizeRem * 5.25;
const desktopTaskDateInputCalendarWeeksHeightRem = taskDateInputCalendarDaySizeRem * 6;

const taskDateInputCalendarPadding = {desktop: "3", mobile: "2.5"} as const;

const taskDateInputCalendarHeaderHeight = {desktop: "6", mobile: "5"} as const;
const taskDateInputCalendarHeaderMarginBottom = {desktop: "3", mobile: "1"} as const;

const taskDateInputFooterMarginTop = {desktop: "3", mobile: "0"} as const;
const taskDateInputFooterPaddingY = {desktop: "2", mobile: "1"} as const;
const taskDateInputFooterButtonHeight = "5";

const taskDateInputFooterHeight = mapObjectValues(
    taskDateInputFooterPaddingY,
    taskDateInputFooterPaddingY =>
        addRemLengths(
            taskDateInputFooterPaddingY,
            taskDateInputFooterButtonHeight,
            taskDateInputFooterPaddingY,
        ),
);

// Ok since this exports a string constant.
// eslint-disable-next-line react-refresh/only-export-components
export const taskDateInputCalendarMobileHeight = addRemLengths(
    taskDateInputCalendarPadding.mobile,
    taskDateInputCalendarHeaderHeight.mobile,
    taskDateInputCalendarHeaderMarginBottom.mobile,
    taskDateInputCalendarWeekDayHeight,
    `${mobileTaskDateInputCalendarWeeksHeightRem}rem`,
    taskDateInputFooterMarginTop.mobile,
    taskDateInputFooterHeight.mobile,
);

// Ok since this exports a string constant.
// eslint-disable-next-line react-refresh/only-export-components
export const taskDateInputCalendarDesktopHeight = addRemLengths(
    taskDateInputCalendarPadding.desktop,
    taskDateInputCalendarHeaderHeight.desktop,
    taskDateInputCalendarHeaderMarginBottom.desktop,
    taskDateInputCalendarWeekDayHeight,
    `${desktopTaskDateInputCalendarWeeksHeightRem}rem`,
    taskDateInputFooterMarginTop.desktop,
    taskDateInputFooterHeight.desktop,
);

export function TaskDateInputCalendar({
    date,
    onDateChange,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
}) {
    const platform = usePlatform();
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
        // month. Showing two months at once saves you a click when you're near the end of
        // the month.
        //
        // On mobile, we don't have enough space on screen for two months.
        selectionAlignment: "start",
        visibleDuration: {months: platform === "mobile" ? 1 : 2},
    };

    const originalState = useCalendarState(calendarProps);

    const actualStartDate1 = originalState.visibleRange.start;
    const actualStartDate2 = platform !== "mobile" ? actualStartDate1.add({months: 1}) : null;
    const actualEndDate = originalState.visibleRange.end;

    // We want dates for the full week in the first and last weeks of the month. To do
    // this we modify our state such that that's our visible range. The
    // `useCalendarState()` hook doesn't see this modification but that's ok. We want
    // to use the month start date for navigation purposes.
    const state: typeof originalState = {
        ...originalState,
        visibleRange: {
            start: startOfWeek(originalState.visibleRange.start, locale),
            end: endOfWeek(originalState.visibleRange.end, locale),
        },
        isCellDisabled: date => {
            return (
                calendarProps.isDisabled ||
                date.compare(startOfWeek(originalState.visibleRange.start, locale)) < 0 ||
                date.compare(endOfWeek(originalState.visibleRange.end, locale)) > 0 ||
                originalState.isInvalid(date)
            );
        },
        setFocusedDate: () => {
            // Noop for now. This is called at the same time as `selectDate()` by
            // `useCalendarCell()` but if we are selecting a date outside of
            // `useCalendarState()`s visible range we don't want to update the start/end dates.
        },
    };

    const {
        calendarProps: calendarDomProps,
        prevButtonProps,
        nextButtonProps,
    } = useCalendar(calendarProps, state);

    // We manually adapt button props to our icon button component. Make sure there are
    // no more props than what we expect.
    const expectedButtonProps = new Set(["aria-label", "isDisabled", "onPress", "onFocusChange"]);
    assert(isDeepEqual(new Set(Object.keys(nextButtonProps)), expectedButtonProps));
    assert(isDeepEqual(new Set(Object.keys(prevButtonProps)), expectedButtonProps));

    const monthDateFormatter = useDateFormatter({
        month: "long",
        year: "numeric",
        timeZone,
    });

    const weeksInMonth1 = getWeeksInMonth(actualStartDate1, locale);
    const weeksInMonth2 = actualStartDate2 ? getWeeksInMonth(actualStartDate2, locale) : null;

    const maxWeeksInMonth = weeksInMonth2 ? Math.max(weeksInMonth1, weeksInMonth2) : weeksInMonth1;

    // On mobile we want our single month calendar to always be the same height
    // regardless of the number of weeks in the month. Typically, months are between
    // 5-6 weeks long with 5 being more common (a rare February may be exactly 4 weeks
    // long like February 2015). So size weeks based on the number of weeks in the
    // month.
    const weekHeightRem =
        platform === "mobile"
            ? mobileTaskDateInputCalendarWeeksHeightRem / maxWeeksInMonth
            : taskDateInputCalendarDaySizeRem;

    return (
        <Box
            {...calendarDomProps}
            paddingX={taskDateInputCalendarPadding}
            paddingTop={taskDateInputCalendarPadding}
            style={{
                height:
                    platform === "mobile"
                        ? taskDateInputCalendarMobileHeight
                        : taskDateInputCalendarDesktopHeight,
            }}
        >
            <Box
                display="flex"
                alignItems="center"
                height={taskDateInputCalendarHeaderHeight}
                marginBottom={taskDateInputCalendarHeaderMarginBottom}
            >
                <IconButton
                    // Not focusable since when clicked we don't want to unfocus the text input.
                    // Particularly on mobile. All keyboard interactivity is done through the text
                    // input. The calendar is purely a pointer affordance for convenience.
                    isFocusable={false}
                    variant="quiet"
                    size={platform !== "mobile" ? "md" : "sm"}
                    withoutTooltip
                    description={assertExists(prevButtonProps["aria-label"])}
                    isDisabled={assertExists(prevButtonProps["isDisabled"])}
                    onFocus={() => assertExists(prevButtonProps["onFocusChange"])(true)}
                    onBlur={() => assertExists(prevButtonProps["onFocusChange"])(false)}
                    onPress={assertExists(prevButtonProps["onPress"])}
                >
                    <CaretLeft />
                </IconButton>
                <Box
                    flexGrow="1"
                    textAlign="center"
                    fontSize={{mobile: "50", desktop: "75"}}
                    fontStyle="semi-bold"
                >
                    {monthDateFormatter.format(actualStartDate1.toDate(timeZone))}
                </Box>
                {actualStartDate2 && (
                    <>
                        <Spacer space="4" />
                        <Spacer space="4" />
                        <Box
                            flexGrow="1"
                            textAlign="center"
                            fontSize={{mobile: "50", desktop: "75"}}
                            fontStyle="semi-bold"
                        >
                            {monthDateFormatter.format(actualStartDate2.toDate(timeZone))}
                        </Box>
                    </>
                )}
                <IconButton
                    // Not focusable since when clicked we don't want to unfocus the text input.
                    // Particularly on mobile. All keyboard interactivity is done through the text
                    // input. The calendar is purely a pointer affordance for convenience.
                    isFocusable={false}
                    variant="quiet"
                    size={platform !== "mobile" ? "md" : "sm"}
                    withoutTooltip
                    description={assertExists(nextButtonProps["aria-label"])}
                    isDisabled={assertExists(nextButtonProps["isDisabled"])}
                    onFocus={() => assertExists(prevButtonProps["onFocusChange"])(true)}
                    onBlur={() => assertExists(prevButtonProps["onFocusChange"])(false)}
                    onPress={assertExists(nextButtonProps["onPress"])}
                >
                    <CaretRight />
                </IconButton>
            </Box>
            <Box
                display="flex"
                gap="3"
                style={{
                    height: `${
                        taskDateInputCalendarWeekDayHeightRem +
                        (platform === "mobile"
                            ? mobileTaskDateInputCalendarWeeksHeightRem
                            : desktopTaskDateInputCalendarWeeksHeightRem)
                    }rem`,
                }}
            >
                <Box>
                    <TaskDateInputCalendarGrid
                        state={state}
                        actualStartDate={actualStartDate1}
                        actualEndDate={actualEndDate}
                        currentDate={currentDate}
                        weeksInMonth={weeksInMonth1}
                        weekHeight={`${weekHeightRem}rem`}
                    />
                </Box>
                {actualStartDate2 && (
                    <Box>
                        <TaskDateInputCalendarGrid
                            state={state}
                            actualStartDate={actualStartDate2}
                            actualEndDate={actualEndDate}
                            currentDate={currentDate}
                            weeksInMonth={assertExists(weeksInMonth2)}
                            weekHeight={`${weekHeightRem}rem`}
                        />
                    </Box>
                )}
            </Box>
            <Box
                marginTop={taskDateInputFooterMarginTop}
                paddingY={taskDateInputFooterPaddingY}
                borderTop="grey-5"
                display="flex"
                justifyContent="flex-end"
                style={{height: taskDateInputFooterHeight[platform]}}
            >
                <Button
                    // Not focusable since when clicked we don't want to unfocus the text input.
                    // Particularly on mobile. All keyboard interactivity is done through the text
                    // input. The calendar is purely a pointer affordance for convenience.
                    isFocusable={false}
                    variant="quiet"
                    height={taskDateInputFooterButtonHeight}
                    paddingX="2"
                    fontSize={platform === "mobile" ? "50" : "75"}
                    onPress={() => onDateChange(null)}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
}

function TaskDateInputCalendarGrid({
    state,
    actualStartDate,
    actualEndDate,
    currentDate,
    weeksInMonth,
    weekHeight,
}: {
    state: CalendarState;
    actualStartDate: CalendarDate;
    actualEndDate: CalendarDate;
    currentDate: CalendarDate;
    weeksInMonth: number;
    weekHeight: RemLength;
}) {
    const startDate = actualStartDate;
    const endDate = endOfMonth(startDate);

    const {gridProps, headerProps, weekDays} = useCalendarGrid(
        {startDate, endDate, weekdayStyle: "short"},
        state,
    );

    return (
        <table {...gridProps} cellPadding="0">
            <thead {...headerProps}>
                <tr>
                    {weekDays.map((day, index) => (
                        <th key={index}>
                            <div
                                className={sprinkles({
                                    width: taskDateInputCalendarDaySize,
                                    height: taskDateInputCalendarWeekDayHeight,
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    fontSize: "50",
                                    fontStyle: "normal",
                                    color: "grey-50",
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
                                    <TaskDateInputCalendarCell
                                        key={i}
                                        state={state}
                                        actualStartDate={actualStartDate}
                                        actualEndDate={actualEndDate}
                                        date={date}
                                        gridStartDate={startDate}
                                        currentDate={currentDate}
                                        weekHeight={weekHeight}
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

function TaskDateInputCalendarCell({
    state,
    actualStartDate,
    actualEndDate,
    date,
    gridStartDate,
    currentDate,
    weekHeight,
}: {
    state: CalendarState;
    actualStartDate: CalendarDate;
    actualEndDate: CalendarDate;
    date: CalendarDate;
    gridStartDate: CalendarDate;
    currentDate: CalendarDate;
    weekHeight: RemLength;
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
    } = useCalendarCell(
        {date},
        state,
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        ref,
    );

    const isDateSameMonthAsGridStartDate =
        date.month === gridStartDate.month && date.year === gridStartDate.year;

    // We only want to show the selected circle once. When we have overlapping dates
    // between adjacent months, only show the selected circle around the date in its
    // month.
    //
    // For overflow dates at the start/end of the calendar grids we want to show the
    // selected circle there too since we don't render the adjacent month.
    const isSelected =
        isPressed ||
        (_isSelected &&
            (isDateSameMonthAsGridStartDate ||
                date.compare(actualStartDate) < 0 ||
                date.compare(actualEndDate) > 0));

    return (
        <td {...cellProps}>
            <div
                {...mergeProps(buttonProps, hoverProps)}
                ref={ref}
                className={sprinkles({
                    width: taskDateInputCalendarDaySize,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                })}
                style={{height: weekHeight}}
            >
                <div
                    // Put border radius on a nested `<div>` so entire parent is clickable.
                    className={sprinkles({
                        position: "relative",
                        // Selected cell backgrounds should cover overlapping hovered cell backgrounds.
                        zIndex: isSelected ? "10" : "0",
                        fontSize: "75",
                        fontStyle: isCurrentDate && !isDimmed ? "ultra-bold" : undefined,
                        borderRadius: "full",
                        backgroundColor: isSelected
                            ? "grey-10"
                            : // We use a hover state here since picking the right date requires some motor
                              // precision. So hovering helps reduce the mental load as your mouse tracks to the
                              // right position.
                              isHovered
                              ? "grey-5"
                              : undefined,
                        color:
                            isCurrentDate && !isDimmed
                                ? {light: "theme-50", dark: "theme-70"}
                                : isDimmed && !isSelected
                                  ? "grey-40"
                                  : undefined,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                    })}
                    style={{
                        width: `calc(${spacing[taskDateInputCalendarDaySize]} - 2px)`,
                        height: `calc(${spacing[taskDateInputCalendarDaySize]} - 2px)`,
                    }}
                >
                    {formattedDate}
                </div>
            </div>
        </td>
    );
}
