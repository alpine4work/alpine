import {CalendarDate, DateValue, createCalendar} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useRef, useState} from "react";
import {AriaDateFieldProps, mergeProps, useDateField, useDateSegment} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
import {Box} from "~/client/design/box";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useClientInfo} from "~/client/remix/client_info_context";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

export function TaskDateInputText({
    date,
    onDateChange,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isEditing,
    shouldIncludeCalendarIcon,
    display,
    height,
    paddingX,
    color,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    isEditing: boolean;
    shouldIncludeCalendarIcon: boolean;
    display: "inline" | "block";
    height: "full" | "4";
    paddingX: "0" | "1" | "1.5";
    color: "grey-text" | "grey-60";
}) {
    const {locale} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldProps<CalendarDate> = {
        locale,
        createCalendar,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        // The types are wrong. These hooks actually support `CalendarDate | null`.
        value: date as DateValue,
        onChange: onDateChange as (value: DateValue) => void,
    };

    const state = useDateFieldState(datePickerProps);

    // If we are no longer editing the date input and have a `null` date
    // then don't leave a partial date in our state.
    if (!isEditing && !date) {
        for (const segment of state.segments) {
            if (segment.isEditable && !segment.isPlaceholder) {
                state.clearSegment(segment.type);
            }
        }
    }

    const ref = useRef<HTMLDivElement>(null);
    const {fieldProps} = useDateField(datePickerProps, state, ref);

    return (
        <Box height={height}>
            <Box
                // Inline flex so the clickable range doesn't extend beyond the
                // input's contents.
                display={display === "inline" ? "inline-flex" : "flex"}
                height="full"
                alignItems="center"
                color={color}
                cursor="text"
            >
                {shouldIncludeCalendarIcon && (
                    <Box
                        alignSelf="stretch"
                        display="flex"
                        alignItems="center"
                        paddingLeft={paddingX}
                        paddingRight="1"
                        onPointerDown={event => {
                            if (
                                document.activeElement &&
                                assertExists(ref.current).contains(document.activeElement)
                            ) {
                                // Don't unfocus field segments when clicking on icon.
                                event.preventDefault();
                            }
                        }}
                        onClick={event => {
                            getNextFocusableElementIfExists(null, {
                                withinElement: assertExists(ref.current),
                            })?.focus();
                        }}
                    >
                        <CalendarBlank
                            size={spacing["4"]}
                            className={sprinkles({pointerEvents: "none"})}
                            color={!isEditing && !date ? inputPlaceholderStyles.color : undefined}
                        />
                    </Box>
                )}
                <Box
                    {...fieldProps}
                    ref={ref}
                    display={display === "inline" ? "inline-flex" : "flex"}
                    flexGrow={display === "block" ? "1" : undefined}
                    height="full"
                >
                    {state.segments.map((segment, index) => (
                        <TaskDateInputTextSegment
                            key={index}
                            state={state}
                            segment={segment}
                            areAllSegmentsPlaceholders={!isEditing && !date}
                            flexGrow={
                                display === "block" && index === state.segments.length - 1
                                    ? "1"
                                    : undefined
                            }
                            paddingLeft={
                                !shouldIncludeCalendarIcon && index === 0 ? paddingX : undefined
                            }
                            paddingRight={
                                index === state.segments.length - 1 ? paddingX : undefined
                            }
                        />
                    ))}
                </Box>
            </Box>
        </Box>
    );
}

function TaskDateInputTextSegment({
    state,
    segment,
    areAllSegmentsPlaceholders,
    flexGrow,
    paddingLeft,
    paddingRight,
}: {
    state: DateFieldState;
    segment: DateSegment;
    areAllSegmentsPlaceholders: boolean;
    flexGrow: "1" | undefined;
    paddingLeft: "0" | "1" | "1.5" | undefined;
    paddingRight: "0" | "1" | "1.5" | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const {segmentProps} = useDateSegment(segment, state, ref);
    const [isFocused, setIsFocused] = useState(false);

    return (
        <Box
            display="flex"
            alignItems="center"
            flexGrow={flexGrow}
            height="full"
            paddingLeft={paddingLeft}
            paddingRight={paddingRight}
            onClick={event => {
                if (event.target === event.currentTarget) {
                    if (segment.isEditable) {
                        assertExists(ref.current).focus({preventScroll: true});
                    } else {
                        getNextFocusableElementIfExists(ref.current, {
                            withinElement: event.currentTarget.parentElement,
                        })?.focus({preventScroll: true});
                    }
                }
            }}
        >
            <Box
                {...mergeProps(segmentProps, {
                    onFocus: () => setIsFocused(true),
                    onBlur: () => setIsFocused(false),
                })}
                ref={ref}
                backgroundColor={isFocused ? "theme-selection" : undefined}
                // `react-aria`s click support for non-editable segments isn't super reliable.
                // So use our parent's `onClick` handler instead.
                pointerEvents={!segment.isEditable ? "none" : undefined}
                style={{
                    ...segmentProps.style,
                    fontVariantNumeric: "tabular-nums",
                    ...(areAllSegmentsPlaceholders || segment.isPlaceholder
                        ? inputPlaceholderStyles
                        : {}),
                }}
            >
                {segment.text}
            </Box>
        </Box>
    );
}
