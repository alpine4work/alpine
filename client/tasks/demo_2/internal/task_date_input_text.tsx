import {CalendarDate, DateValue, createCalendar} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {useRef, useState} from "react";
import {AriaDateFieldProps, mergeProps, useDateField, useDateSegment} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {FocusRingBox, useIsFocusRingVisible} from "~/client/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {Overlay} from "~/client/design/overlay.js";
import {isMac} from "~/client/helpers/browser/is_mac.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles.js";

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
    focusRingOffset,
    focusRingAroundText,
    onArrowLeftLeaveKeyDown,
    onArrowRightLeaveKeyDown,
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
    focusRingOffset: "0" | undefined;
    // By default the focus ring is around the full area of the input but if you
    // want it just around the text (excluding margins) you may set this to true.
    focusRingAroundText: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
}) {
    const {locale} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldProps<CalendarDate> = {
        locale,
        createCalendar,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        value: date,
        // The types are wrong. These hooks actually support `CalendarDate | null`.
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

    const areAllSegmentsPlaceholders = !isEditing && !date;

    const focusRingTargetRef = useRef<HTMLDivElement>(null);
    const [isFocusRingVisible, focusRingVisibilityRef] = useIsFocusRingVisible({
        isVisibleWhenFocusWithin: true,
    });

    const focusStart = () => {
        getNextFocusableElementIfExists(null, {
            withinElement: assertExists(ref.current),
        })?.focus();
    };

    const focusEnd = () => {
        getLastFocusableElementIfExists({
            withinElement: assertExists(ref.current),
        })?.focus();
    };

    return (
        <Box
            height={height}
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.target.blur();
                    return;
                }
            }}
        >
            <Overlay
                isVisible={!focusRingAroundText && isFocusRingVisible}
                placement="center"
                preventOverflow={false}
                sameWidth={true}
                sameHeight={true}
                overlay={
                    <Box pointerEvents="none" position="relative">
                        <FocusRingBox offset={focusRingOffset} targetRef={focusRingTargetRef} />
                    </Box>
                }
            >
                <Box
                    ref={useMergedRefs<HTMLDivElement>(
                        !focusRingAroundText ? focusRingTargetRef : null,
                        focusRingVisibilityRef,
                    )}
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
                            onClick={() => {
                                getNextFocusableElementIfExists(null, {
                                    withinElement: assertExists(ref.current),
                                })?.focus();
                            }}
                        >
                            <CalendarBlank
                                size={spacing["4"]}
                                className={sprinkles({pointerEvents: "none"})}
                                color={
                                    areAllSegmentsPlaceholders
                                        ? inputPlaceholderStyles.color
                                        : undefined
                                }
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
                                areAllSegmentsPlaceholders={areAllSegmentsPlaceholders}
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
                                isFirstSegment={index === 0}
                                isLastSegment={index === state.segments.length - 1}
                                onArrowLeftLeaveKeyDown={onArrowLeftLeaveKeyDown}
                                onArrowRightLeaveKeyDown={onArrowRightLeaveKeyDown}
                                focusStart={focusStart}
                                focusEnd={focusEnd}
                            />
                        ))}
                    </Box>
                    {focusRingAroundText && (
                        <Overlay
                            isVisible={isFocusRingVisible}
                            placement="center"
                            preventOverflow={false}
                            sameWidth={true}
                            sameHeight={true}
                            overlay={
                                <Box pointerEvents="none" position="relative">
                                    <FocusRingBox
                                        offset={focusRingOffset}
                                        targetRef={focusRingTargetRef}
                                    />
                                </Box>
                            }
                        >
                            <Box
                                ref={focusRingTargetRef}
                                position="absolute"
                                left={paddingX}
                                display="inline-flex"
                                height="4"
                                paddingLeft={shouldIncludeCalendarIcon ? "5" : undefined}
                                pointerEvents="none"
                                opacity="0"
                            >
                                {state.segments.map((segment, index) => (
                                    <Box
                                        key={index}
                                        style={{
                                            fontVariantNumeric: "tabular-nums",
                                            ...(areAllSegmentsPlaceholders || segment.isPlaceholder
                                                ? inputPlaceholderStyles
                                                : {}),
                                        }}
                                    >
                                        {segment.text}
                                    </Box>
                                ))}
                            </Box>
                        </Overlay>
                    )}
                </Box>
            </Overlay>
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
    isFirstSegment,
    isLastSegment,
    onArrowLeftLeaveKeyDown,
    onArrowRightLeaveKeyDown,
    focusStart,
    focusEnd,
}: {
    state: DateFieldState;
    segment: DateSegment;
    areAllSegmentsPlaceholders: boolean;
    flexGrow: "1" | undefined;
    paddingLeft: "0" | "1" | "1.5" | undefined;
    paddingRight: "0" | "1" | "1.5" | undefined;
    isFirstSegment: boolean;
    isLastSegment: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
    focusStart: () => void;
    focusEnd: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const {segmentProps} = useDateSegment(segment, state, ref);
    const [isFocused, setIsFocused] = useState(false);

    const {onKeyDown, ...mergedSegmentProps} = mergeProps(segmentProps, {
        onFocus: () => setIsFocused(true),
        onBlur: () => setIsFocused(false),
    });

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
                {...mergedSegmentProps}
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
                onKeyDown={event => {
                    if (isFirstSegment && event.key === "ArrowLeft") {
                        event.preventDefault();
                        event.stopPropagation();
                        onArrowLeftLeaveKeyDown?.();
                    } else if (isLastSegment && event.key === "ArrowRight") {
                        event.preventDefault();
                        event.stopPropagation();
                        onArrowRightLeaveKeyDown?.();
                    } else if (
                        event.key === "ArrowLeft" &&
                        (isMac ? event.metaKey : event.ctrlKey)
                    ) {
                        focusStart();
                    } else if (
                        event.key === "ArrowRight" &&
                        (isMac ? event.metaKey : event.ctrlKey)
                    ) {
                        focusEnd();
                    } else {
                        onKeyDown?.(event);
                    }
                }}
            >
                {segment.text}
            </Box>
        </Box>
    );
}
