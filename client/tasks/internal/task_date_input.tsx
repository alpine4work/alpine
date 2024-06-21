import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useGetCurrentCoveredHeight} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {formatTaskDate} from "~/client/tasks/internal/format_task_date.js";
import {TaskDateInputCalendar} from "~/client/tasks/internal/task_date_input_calendar.js";
import {TaskDateInputText} from "~/client/tasks/internal/task_date_input_text.js";
import {RemLength, Spacing, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
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
    color = "grey-100",
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
    color?: "grey-100" | "grey-60";
    overlayOffset?: Spacing | `-${Spacing}` | RemLength;
    focusRingOffset?: "0";
    focusRingAroundText?: boolean;
    isTabbable?: boolean;
    onArrowLeftLeaveKeyDown?: () => void;
    onArrowRightLeaveKeyDown?: () => void;
}) {
    const isMobile = useIsMobile();
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();
    const inputRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

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

    const getCurrentCoveredHeight = useGetCurrentCoveredHeight();

    // When our calendar overlay opens on mobile we need to scroll it into view if
    // it's rendered offscreen.
    //
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` does nothing when the task
    // date input is focused. Since that hooks is designed to avoid the mobile
    // keyboard when the mobile keyboard opens. However, if the mobile keyboard is
    // already open and the user focuses a date input then we still need to scroll
    // the date input into view. Instead of competing with
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` we fully implement scroll
    // logic for when the date input is focused here.
    //
    // We have a hook that does basically the same thing in
    // `<TaskCollectionsInput>`. If you make a change here you should also probably
    // make a change there.
    const lastIsEditingRef = useRef(isEditing);
    useEffect(() => {
        if (lastIsEditingRef.current === isEditing) return;
        lastIsEditingRef.current = isEditing;

        if (!isMobile) return;
        if (!isEditing) return;

        const run = () => {
            const overlayElement = assertExists(overlayRef.current);

            let scrollableElement: HTMLElement | null = overlayElement.parentElement;
            while (scrollableElement !== null) {
                const {overflowY} = getComputedStyle(scrollableElement);

                // We found our scrollable element!
                if (overflowY === "scroll" || overflowY === "auto") break;

                scrollableElement = scrollableElement.parentElement;
            }

            if (scrollableElement === null) return;

            const overlayRect = overlayElement.getBoundingClientRect();
            const viewportHeight = document.documentElement.getBoundingClientRect().height;

            const clearanceBottom =
                viewportHeight -
                getCurrentCoveredHeight() -
                convertRemLengthToPx(spacing["1"], getRemPxWithoutListening());

            if (overlayRect.bottom <= clearanceBottom) return;

            const scrollDelta = overlayRect.bottom - clearanceBottom;

            scrollableElement.scrollTo({
                top: scrollableElement.scrollTop + scrollDelta,
                behavior: "smooth",
            });
        };

        let isCancelled = false;

        // This effect needs to run after `NativeMobileBridge` calls
        // `keyboard.subscribeToFrameChange` subscribers. That way we can properly
        // avoid the keyboard. In testing it seems like
        // `keyboard.subscribeToFrameChange` is consistently called after double
        // `requestAnimationFrame()` (which ensures we finish the current animation
        // frame).
        //
        // NOTE(calebmer): I don't know enough about how WebKit does cross-thread
        // communication to know if it's a guarantee that we'll always get
        // `keyboard.subscribeToFrameChange` within two animation frames. Maybe as a
        // fallback we should wait for 2 request animation frames AND ~50ms?
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (isCancelled) return;
                run();
            });
        });

        return () => {
            isCancelled = true;
        };
    }, [getCurrentCoveredHeight, isEditing, isMobile]);

    const insetMarginY = height === "full" ? undefined : isMobile ? "2.5" : undefined;

    const {pressProps: previewPressProps} = usePress({
        // Preview doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                const skipElementsString = (event.target as HTMLElement).dataset.skip;
                const skipElements = skipElementsString
                    ? parseInt(skipElementsString, 10)
                    : undefined;

                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(inputRef.current),
                    skipElements,
                })?.focus();
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                const skipElementsString = (event.target as HTMLElement).dataset.skip;
                const skipElements = skipElementsString
                    ? parseInt(skipElementsString, 10)
                    : undefined;

                getNextFocusableElementIfExists(null, {
                    withinElement: assertExists(inputRef.current),
                    skipElements,
                })?.focus();
            }
        },
    });

    return (
        <div
            className={sprinkles({
                position: "relative",
                width: display === "block" ? "full" : undefined,
                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit
                // target size][1].
                //
                // [1]: https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                height: height === "full" ? "full" : isMobile ? "9" : cast<"4">(height),
                marginY: insetMarginY ? `-${insetMarginY}` : undefined,
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
                            {...previewPressProps}
                            className={sprinkles({
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: paddingX,
                                paddingRight: "1",
                            })}
                        >
                            <CalendarBlank size={spacing["4"]} />
                        </div>
                    )}
                    {isReadOnly || formattedDate.isFormattedAroundToday ? (
                        // Render read-only date inputs as a single div so they may be easily selected
                        // and copied/pasted.
                        <div
                            {...previewPressProps}
                            className={sprinkles({
                                flexGrow: display === "block" ? "1" : undefined,
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: !shouldIncludeCalendarIcon ? paddingX : undefined,
                                paddingRight: paddingX,
                            })}
                            // Small UX improvement, focus the day input segment if the text is "Today"
                            // or "Yesterday".
                            //
                            // Used by `previewPressProps`.
                            data-skip={1}
                        >
                            {formattedDate.dateString}
                        </div>
                    ) : (
                        formattedDate.dateString.split(" ").map((segment, index, segments) => (
                            <div
                                {...previewPressProps}
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
                                // Small UX improvement, focus the input segment the user clicked on. It's a
                                // little strange how the preview text transforms into editable text.
                                // Especially disorienting when you click the end and the start is focused. So
                                // attempt to focus the same segment the user clicked.
                                //
                                // We hope that the words separated by spaces in our date line up with the
                                // editable input segments which is the case with the en-US locale but this
                                // heuristic may need to be hardened for other locales.
                                //
                                // Used by `previewPressProps`.
                                data-skip={index}
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
                // On mobile we only allow rendering the overlay below the input. The view must
                // scroll to fit it.
                placement="bottom"
                fallbackPlacements={isMobile ? emptyArray : undefined}
                offset={overlayOffset}
                // The overlay blocks interaction with everything below it, except the element
                // we're targeting (the date input).
                isBlocking={true}
                shouldBlockingCoverExcludeTarget={true}
                overlay={
                    <div
                        ref={overlayRef}
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
                            // `<FocusRing>` updates are run with immediate priority. Make sure this update
                            // is as well so we see both update in the same render.
                            runWithImmediatePriority(() => {
                                setIsFocusWithinOverlay(event.currentTarget.contains(event.target));
                            });
                        }}
                        onBlur={event => {
                            // `<FocusRing>` updates are run with immediate priority. Make sure this update
                            // is as well so we see both update in the same render.
                            runWithImmediatePriority(() => {
                                setIsFocusWithinOverlay(
                                    event.currentTarget.contains(event.relatedTarget),
                                );
                            });
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
                        height: "full",
                        position: !isEditing && formattedDate ? "absolute" : "relative",
                        top: !isEditing && formattedDate ? "0" : undefined,
                        pointerEvents: !isEditing && formattedDate ? "none" : undefined,
                    })}
                    style={{opacity: !isEditing && formattedDate ? 0 : undefined}}
                    onFocus={event => {
                        // `<FocusRing>` updates are run with immediate priority. Make sure this updates
                        // with immediate priority as well so we see both update in the same render.
                        runWithImmediatePriority(() => {
                            setIsFocusWithinInput(event.currentTarget.contains(event.target));
                        });
                    }}
                    onBlur={event => {
                        // `<FocusRing>` updates are run with immediate priority. Make sure this updates
                        // with immediate priority as well so we see both update in the same render.
                        runWithImmediatePriority(() => {
                            setIsFocusWithinInput(
                                event.currentTarget.contains(event.relatedTarget),
                            );
                        });
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
                        paddingX={paddingX}
                        color={color}
                        focusRingOffset={focusRingOffset}
                        focusRingAroundText={focusRingAroundText}
                        focusRingInsetY={insetMarginY}
                        isTabbable={isTabbable}
                        onArrowLeftLeaveKeyDown={onArrowLeftLeaveKeyDown}
                        onArrowRightLeaveKeyDown={onArrowRightLeaveKeyDown}
                    />
                </div>
            </OverlayAnimated>
        </div>
    );
}
