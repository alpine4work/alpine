import {CalendarDate, DateValue, createCalendar} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useRef, useState} from "react";
import {AriaDateFieldProps, useDateField, useDateSegment} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
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
import {inputPlaceholderStyles, sprinkles, tasksStyles} from "~/shared/styles/styles.js";

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

export function TaskDateInputText({
    date,
    onDateChange,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isReadOnly,
    isEditing,
    shouldIncludeCalendarIcon,
    display,
    height,
    paddingX,
    color,
    focusRingOffset,
    focusRingAroundText,
    isTabbable,
    onArrowLeftLeaveKeyDown,
    onArrowRightLeaveKeyDown,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    isReadOnly: boolean;
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
    isTabbable: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
}) {
    const {locale} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldProps<CalendarDate> = {
        isDisabled: isReadOnly,
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

    let node = (
        <div
            ref={useMergedRefs<HTMLDivElement>(
                !focusRingAroundText ? focusRingTargetRef : null,
                focusRingVisibilityRef,
            )}
            className={sprinkles({
                // Inline flex so the clickable range doesn't extend beyond the
                // input's contents.
                display: display === "inline" ? "inline-flex" : "flex",
                height: "full",
                alignItems: "center",
                color,
                cursor: "text",
            })}
        >
            {shouldIncludeCalendarIcon && (
                <div
                    className={sprinkles({
                        alignSelf: "stretch",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: paddingX,
                        paddingRight: "1",
                    })}
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
                            areAllSegmentsPlaceholders ? inputPlaceholderStyles.color : undefined
                        }
                    />
                </div>
            )}
            <div
                {...fieldProps}
                ref={ref}
                className={sprinkles({
                    display: display === "inline" ? "inline-flex" : "flex",
                    flexGrow: display === "block" ? "1" : undefined,
                    height: "full",
                })}
            >
                {state.segments.map((segment, index) => {
                    const flexGrow =
                        display === "block" && index === state.segments.length - 1
                            ? "1"
                            : undefined;

                    const paddingLeft =
                        !shouldIncludeCalendarIcon && index === 0 ? paddingX : undefined;

                    const paddingRight = index === state.segments.length - 1 ? paddingX : undefined;

                    return segment.type === "literal" ? (
                        <div
                            key={index}
                            className={sprinkles({
                                display: "flex",
                                alignItems: "center",
                                flexGrow,
                                height: "full",
                                paddingLeft,
                                paddingRight,
                            })}
                            onClick={event => {
                                if (event.target === event.currentTarget) {
                                    getNextFocusableElementIfExists(ref.current, {
                                        withinElement: event.currentTarget.parentElement,
                                    })?.focus({preventScroll: true});
                                }
                            }}
                        >
                            <div
                                // The only prop provided to literal segments is `aria-hidden={true}`. As an
                                // optimization we avoid rendering a text segment component for literal
                                // segments.
                                // https://github.com/adobe/react-spectrum/blob/88550234c383f2a07a27aa2ca9a0a47a9f49e9aa/packages/%40react-aria/datepicker/src/useDateSegment.ts#L353-L361
                                aria-hidden={true}
                                className={sprinkles({
                                    // `react-aria`s click support for non-editable segments isn't super reliable.
                                    // So use our parent's `onClick` handler instead.
                                    pointerEvents: !segment.isEditable ? "none" : undefined,
                                })}
                                style={
                                    areAllSegmentsPlaceholders || segment.isPlaceholder
                                        ? inputPlaceholderStyles
                                        : {}
                                }
                            >
                                {segment.text}
                            </div>
                        </div>
                    ) : (
                        <TaskDateInputTextSegment
                            key={index}
                            state={state}
                            segment={segment}
                            areAllSegmentsPlaceholders={areAllSegmentsPlaceholders}
                            flexGrow={flexGrow}
                            paddingLeft={paddingLeft}
                            paddingRight={paddingRight}
                            isFirstSegment={index === 0}
                            isLastSegment={index === state.segments.length - 1}
                            isTabbable={isTabbable}
                            onArrowLeftLeaveKeyDown={onArrowLeftLeaveKeyDown}
                            onArrowRightLeaveKeyDown={onArrowRightLeaveKeyDown}
                            focusStart={focusStart}
                            focusEnd={focusEnd}
                        />
                    );
                })}
            </div>
            {focusRingAroundText && (
                <Overlay
                    isVisible={isFocusRingVisible}
                    placement="center"
                    preventOverflow={false}
                    sameWidth={true}
                    sameHeight={true}
                    overlay={
                        <div
                            className={sprinkles({
                                pointerEvents: "none",
                                position: "relative",
                            })}
                        >
                            <FocusRingBox offset={focusRingOffset} targetRef={focusRingTargetRef} />
                        </div>
                    }
                >
                    <div
                        ref={focusRingTargetRef}
                        className={sprinkles({
                            position: "absolute",
                            left: paddingX,
                            display: "inline-flex",
                            height: "4",
                            paddingLeft: shouldIncludeCalendarIcon ? "5" : undefined,
                            pointerEvents: "none",
                            opacity: "0",
                        })}
                    >
                        {state.segments.map((segment, index) => (
                            <div
                                key={index}
                                style={{
                                    fontVariantNumeric: "tabular-nums",
                                    ...(areAllSegmentsPlaceholders || segment.isPlaceholder
                                        ? inputPlaceholderStyles
                                        : {}),
                                }}
                            >
                                {segment.text}
                            </div>
                        ))}
                    </div>
                </Overlay>
            )}
        </div>
    );

    // Only wrap in an `<Overlay>` if the focus ring is around our text. Otherwise
    // we can skip rendering the component to improve performance.
    if (!focusRingAroundText) {
        node = (
            <Overlay
                isVisible={isFocusRingVisible}
                placement="center"
                preventOverflow={false}
                sameWidth={true}
                sameHeight={true}
                overlay={
                    <div className={sprinkles({pointerEvents: "none", position: "relative"})}>
                        <FocusRingBox offset={focusRingOffset} targetRef={focusRingTargetRef} />
                    </div>
                }
            >
                {node}
            </Overlay>
        );
    }

    return (
        <div
            className={sprinkles({height})}
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    event.target.blur();
                    return;
                }
            }}
        >
            {node}
        </div>
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
    isTabbable,
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
    isTabbable: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
    focusStart: () => void;
    focusEnd: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const {segmentProps} = useDateSegment(segment, state, ref);
    const [isFocused, setIsFocused] = useState(false);

    return (
        <div
            className={sprinkles({
                display: "flex",
                alignItems: "center",
                flexGrow,
                height: "full",
                paddingLeft,
                paddingRight,
            })}
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
            <div
                {...segmentProps}
                ref={ref}
                tabIndex={!isTabbable ? -1 : segmentProps.tabIndex}
                className={classNames(
                    tasksStyles.taskDateInputTextSegmentClassName,
                    sprinkles({
                        backgroundColor: isFocused ? "theme-selection" : undefined,
                        // `react-aria`s click support for non-editable segments isn't super reliable.
                        // So use our parent's `onClick` handler instead.
                        pointerEvents: !segment.isEditable ? "none" : undefined,
                    }),
                )}
                style={{
                    ...segmentProps.style,
                    fontVariantNumeric: "tabular-nums",
                    ...(areAllSegmentsPlaceholders || segment.isPlaceholder
                        ? inputPlaceholderStyles
                        : {}),
                }}
                onFocus={event => {
                    setIsFocused(true);
                    segmentProps.onFocus?.(event);
                }}
                onBlur={event => {
                    setIsFocused(false);
                    segmentProps.onBlur?.(event);
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
                        segmentProps.onKeyDown?.(event);
                    }
                }}
            >
                {segment.text}
            </div>
        </div>
    );
}
