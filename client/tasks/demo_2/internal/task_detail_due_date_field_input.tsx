import {CalendarDate, DateValue, createCalendar} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useRef, useState} from "react";
import {AriaDateFieldProps, mergeProps, useDateField, useDateSegment} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
import {Box} from "~/client/design/box";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useClientInfo} from "~/client/remix/client_info_context";
import {spacing} from "~/shared/design/spacing";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

export function TaskDetailDueDateFieldInput({
    dueDate,
    onDueDateChange,
    "aria-labelledby": ariaLabelledBy,
    isEditing,
}: {
    dueDate: CalendarDate | null;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    "aria-labelledby": string;
    isEditing: boolean;
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

    // If we are no longer editing the due date input and have a `null` due date
    // then don't leave a partial date in our state.
    if (!isEditing && !dueDate) {
        for (const segment of state.segments) {
            if (segment.isEditable && !segment.isPlaceholder) {
                state.clearSegment(segment.type);
            }
        }
    }

    const ref = useRef<HTMLDivElement>(null);
    const {fieldProps} = useDateField(datePickerProps, state, ref);

    return (
        <Box height="4">
            <Box
                // Inline flex so the clickable range doesn't extend beyond the
                // input's contents.
                display="inline-flex"
                alignItems="center"
                gap="1"
                color="grey-text"
                cursor="text"
                onPointerDown={event => {
                    if (event.target === event.currentTarget) {
                        // Don't unfocus field segments when clicking on icon or margin.
                        event.preventDefault();

                        // If our input doesn't already have focus then give it focus.
                        if (
                            !document.activeElement ||
                            !event.currentTarget.contains(document.activeElement)
                        ) {
                            getNextFocusableElementIfExists(null, {
                                withinElement: event.currentTarget,
                            })?.focus();
                        }
                    }
                }}
            >
                <CalendarBlank
                    size={spacing["4"]}
                    className={sprinkles({pointerEvents: "none"})}
                    color={!isEditing ? inputPlaceholderStyles.color : undefined}
                />
                <Box {...fieldProps} ref={ref} display="inline-flex">
                    {state.segments.map((segment, i) => (
                        <TaskDetailDueDateFieldInputSegment
                            key={i}
                            state={state}
                            segment={segment}
                            areAllSegmentsPlaceholders={!isEditing}
                        />
                    ))}
                </Box>
            </Box>
        </Box>
    );
}

function TaskDetailDueDateFieldInputSegment({
    state,
    segment,
    areAllSegmentsPlaceholders,
}: {
    state: DateFieldState;
    segment: DateSegment;
    areAllSegmentsPlaceholders: boolean;
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
            backgroundColor={isFocused ? "theme-selection" : undefined}
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
    );
}
