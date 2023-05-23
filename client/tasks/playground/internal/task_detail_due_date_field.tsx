import {CalendarDate, createCalendar} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useMemo, useRef, useState} from "react";
import {AriaDateFieldProps, mergeProps, useDateField, useDateSegment} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element";
import {useCurrentTimeRoundedToHour} from "~/client/helpers/use_current_time_rounded_to_hour";
import {useClientInfo} from "~/client/remix/client_info_context";
import {formatTaskDueDate} from "~/client/tasks/playground/internal/format_task_due_date";
import {TaskStatus} from "~/client/tasks/playground/task_status_button";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {sprinkles} from "~/shared/styles/styles";

export function TaskDetailDueDateField({
    status,
    dueDate,
    onDueDateChange,
    "aria-labelledby": ariaLabelledBy,
}: {
    status: TaskStatus;
    dueDate: CalendarDate;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    "aria-labelledby": string;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();
    const editableFieldRef = useRef<HTMLDivElement>(null);

    const {isAfterDueDate, dueDateString} = useMemo(
        () =>
            formatTaskDueDate({
                timeZone,
                locale,
                currentTime,
                dueDate,
            }),
        [currentTime, dueDate, locale, timeZone],
    );

    const [isFocusWithin, setIsFocusWithin] = useState(false);

    return (
        <Box position="relative">
            {!isFocusWithin && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    display="flex"
                    alignItems="center"
                    gap="1"
                    color={status === "Open" && isAfterDueDate ? "red-60" : undefined}
                    cursor="text"
                    onClick={() => {
                        getNextFocusableElementIfExists(null, {
                            withinElement: assertExists(editableFieldRef.current),
                        })?.focus();
                    }}
                >
                    <CalendarBlank size={spacing["4"]} />
                    <Box>{dueDateString}</Box>
                </Box>
            )}
            <FocusRing isVisibleWhenFocusWithin>
                <Box
                    ref={editableFieldRef}
                    pointerEvents={!isFocusWithin ? "none" : undefined}
                    style={{opacity: !isFocusWithin ? 0 : undefined}}
                    onFocus={event => {
                        setIsFocusWithin(event.currentTarget.contains(event.target));
                    }}
                    onBlur={event => {
                        setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                    }}
                >
                    <TaskDetailDueDateEditableField
                        dueDate={dueDate}
                        onDueDateChange={onDueDateChange}
                        aria-labelledby={ariaLabelledBy}
                    />
                </Box>
            </FocusRing>
        </Box>
    );
}

function TaskDetailDueDateEditableField({
    dueDate,
    onDueDateChange,
    "aria-labelledby": ariaLabelledBy,
}: {
    dueDate: CalendarDate;
    onDueDateChange: (dueDate: CalendarDate | null) => void;
    "aria-labelledby": string;
}) {
    const {locale} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldProps<CalendarDate> = {
        locale,
        createCalendar,
        "aria-labelledby": ariaLabelledBy,
        value: dueDate,
        onChange: dueDate => onDueDateChange(dueDate as CalendarDate),
    };

    const state = useDateFieldState(datePickerProps);

    const ref = useRef<HTMLDivElement>(null);
    const {fieldProps} = useDateField(datePickerProps, state, ref);

    return (
        <Box
            display="flex"
            alignItems="center"
            gap="1"
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
                    <TaskDetailDueDateEditableFieldSegment
                        key={i}
                        state={state}
                        segment={segment}
                    />
                ))}
            </Box>
        </Box>
    );
}

function TaskDetailDueDateEditableFieldSegment({
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
            backgroundColor={isFocused ? "grey-5" : undefined}
            color={segment.isPlaceholder ? "grey-50" : undefined}
            paddingX={segment.isEditable ? "0.5" : undefined}
            borderRadius={segment.isEditable ? "sm" : undefined}
            style={{...segmentProps.style, fontVariantNumeric: "tabular-nums"}}
        >
            {segment.text}
        </Box>
    );
}
