import {CalendarDate, DateValue, createCalendar, today} from "@internationalized/date";
import {AriaDateFieldOptions} from "@react-aria/datepicker";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useRef, useState} from "react";
import {useDateField, useDateSegment, usePress} from "react-aria";
import {DateFieldState, DateFieldStateOptions, DateSegment, useDateFieldState} from "react-stately";
import {FocusRingBox} from "~/client/web/design/focus_ring.js";
import {
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {useIsFocusRingVisible} from "~/client/web/design/use_is_focus_ring_visible.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {inputPlaceholderStyles, sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

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
    overlayId,
    isReadOnly,
    isEditing,
    shouldIncludeCalendarIcon,
    display,
    paddingX,
    color,
    focusRingOffset,
    focusRingAroundText,
    focusRingInsetY,
    isTabbable,
    onArrowLeftLeaveKeyDown,
    onArrowRightLeaveKeyDown,
}: {
    date: CalendarDate | null;
    onDateChange: (date: CalendarDate | null) => void;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    overlayId: string | null;
    isReadOnly: boolean;
    isEditing: boolean;
    shouldIncludeCalendarIcon: boolean;
    display: "inline" | "block";
    paddingX: "0" | "1" | "1.5";
    color: "grey-100" | "grey-60";
    focusRingOffset: "0" | undefined;
    // By default the focus ring is around the full area of the input but if you
    // want it just around the text (excluding margins) you may set this to true.
    focusRingAroundText: boolean;
    focusRingInsetY: Spacing | undefined;
    isTabbable: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
}) {
    const {locale, timeZone, isAppleDevice} = useClientInfo();

    const datePickerProps: DateFieldStateOptions & AriaDateFieldOptions<CalendarDate> = {
        isDisabled: isReadOnly,
        locale,
        createCalendar,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        value: date,
        // The types are wrong. These hooks actually support `CalendarDate | null`.
        onChange: onDateChange as (value: DateValue) => void,
        // By default, `@react-aria/datepicker` sets up press listeners on our date
        // field that will focus the last element. This is nice when the right side of
        // your date input is empty space. However, we choose to implement focus on
        // press manually ourselves. The `@react-aria/datepicker` behavior gets in the
        // way so disable it.
        disablePressNavigation: true,
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

    const {pressProps: iconPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(ref.current),
                })?.focus();
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(ref.current),
                })?.focus();
            }
        },
    });

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
                    {...iconPressProps}
                    className={sprinkles({
                        alignSelf: "stretch",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: paddingX,
                        paddingRight: "1",
                    })}
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
                        !shouldIncludeCalendarIcon && index === 0
                            ? paddingX
                            : state.segments[index - 1]?.type === "literal"
                            ? "1"
                            : undefined;

                    const paddingRight =
                        index === state.segments.length - 1
                            ? paddingX
                            : state.segments[index + 1]?.type === "literal"
                            ? "1"
                            : undefined;

                    return segment.type === "literal" ? (
                        <div
                            key={index}
                            className={sprinkles({
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                flexGrow,
                                width: "0",
                                height: "full",
                                // We add padding to segments around the literal and give the literal a width
                                // of 0. So focus on pointer down should be managed by the text input segments.
                                pointerEvents: "none",
                            })}
                        >
                            <div
                                // The only prop provided to literal segments is `aria-hidden={true}`. As an
                                // optimization we avoid rendering a text segment component for literal
                                // segments.
                                // https://github.com/adobe/react-spectrum/blob/88550234c383f2a07a27aa2ca9a0a47a9f49e9aa/packages/%40react-aria/datepicker/src/useDateSegment.ts#L353-L361
                                aria-hidden={true}
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
                            overlayId={overlayId}
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
                            <FocusRingBox
                                insetY={focusRingInsetY}
                                offset={focusRingOffset}
                                targetRef={focusRingTargetRef}
                            />
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
                        {state.segments.map((segment, index) => {
                            if (segment.type === "literal") return null;

                            const paddingLeft =
                                !shouldIncludeCalendarIcon && index === 0
                                    ? paddingX
                                    : state.segments[index - 1]?.type === "literal"
                                    ? "1"
                                    : undefined;

                            const paddingRight =
                                index === state.segments.length - 1
                                    ? undefined
                                    : state.segments[index + 1]?.type === "literal"
                                    ? "1"
                                    : undefined;

                            return (
                                <div
                                    key={index}
                                    style={{
                                        fontVariantNumeric: "tabular-nums",
                                        ...(areAllSegmentsPlaceholders || segment.isPlaceholder
                                            ? inputPlaceholderStyles
                                            : {}),
                                        paddingLeft: paddingLeft ? spacing[paddingLeft] : undefined,
                                        paddingRight: paddingRight
                                            ? spacing[paddingRight]
                                            : undefined,
                                    }}
                                >
                                    {segment.text}
                                </div>
                            );
                        })}
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
                        <FocusRingBox
                            insetY={focusRingInsetY}
                            offset={focusRingOffset}
                            targetRef={focusRingTargetRef}
                        />
                    </div>
                }
            >
                {node}
            </Overlay>
        );
    }

    return (
        <div
            className={sprinkles({height: "full"})}
            onKeyDown={event => {
                switch (event.key) {
                    case "Escape": {
                        event.preventDefault();
                        event.stopPropagation();
                        event.target.blur();
                        break;
                    }
                    // When I (@calebmer) worked at Airtable Cmd+; was the shortcut for setting a
                    // date input to today. Copying this pattern here. Looks like that comes from
                    // Google Sheets where Cmd+; sets the cell to the current date.
                    //
                    // TODO(calebmer): When we have date chips in `<ContentEditor>`, I'd love for
                    // Cmd+; to insert today's date.
                    case ";": {
                        if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();
                            onDateChange(today(timeZone));
                        }
                        break;
                    }
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
    overlayId,
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
    overlayId: string | null;
    flexGrow: "1" | undefined;
    paddingLeft: "0" | "0.5" | "1" | "1.5" | undefined;
    paddingRight: "0" | "0.5" | "1" | "1.5" | undefined;
    isFirstSegment: boolean;
    isLastSegment: boolean;
    isTabbable: boolean;
    onArrowLeftLeaveKeyDown: (() => void) | undefined;
    onArrowRightLeaveKeyDown: (() => void) | undefined;
    focusStart: () => void;
    focusEnd: () => void;
}) {
    const {isAppleDevice} = useClientInfo();
    const ref = useRef<HTMLDivElement>(null);
    const {segmentProps} = useDateSegment(segment, state, ref);
    const [isFocused, setIsFocused] = useState(false);

    const {pressProps: backdropPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                assertExists(ref.current).focus({preventScroll: true});
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                assertExists(ref.current).focus({preventScroll: true});
            }
        },
    });

    return (
        <div
            className={sprinkles({
                position: "relative",
                zIndex: "0",
                display: "flex",
                alignItems: "center",
                flexGrow,
                height: "full",
                paddingLeft,
                paddingRight,
            })}
        >
            <div
                {...backdropPressProps}
                className={sprinkles({
                    position: "absolute",
                    zIndex: "-10",
                    inset: "0",
                    cursor: "text",
                })}
            />
            <div
                {...segmentProps}
                ref={ref}
                tabIndex={!isTabbable ? -1 : segmentProps.tabIndex}
                aria-haspopup="grid"
                aria-controls={overlayId ?? undefined}
                className={classNames(
                    tasksStyles.dateInputTextSegmentClassName,
                    sprinkles({
                        backgroundColor: isFocused ? "theme-selection" : undefined,
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
                        (isAppleDevice ? event.metaKey : event.ctrlKey)
                    ) {
                        focusStart();
                    } else if (
                        event.key === "ArrowRight" &&
                        (isAppleDevice ? event.metaKey : event.ctrlKey)
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
