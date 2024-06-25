import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useId, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {getNextFocusableElementIfExists} from "~/client/design/helpers/get_next_focusable_element.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {formatTaskDate} from "~/client/tasks/internal/format_task_date.js";
import {TaskDateInputCalendar} from "~/client/tasks/internal/task_date_input_calendar.js";
import {TaskDateInputText} from "~/client/tasks/internal/task_date_input_text.js";
import {RemLength, Spacing, spacing} from "~/shared/design/spacing.js";
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

type TaskDateInputFocusState =
    | {
          readonly isFocusWithinInput: false;
          readonly isFocusWithinOverlay: false;
          readonly disableAnimationOut: boolean;
      }
    | {
          readonly isFocusWithinInput: true;
          readonly isFocusWithinOverlay: boolean;
          readonly disableAnimationOut: false;
      }
    | {
          readonly isFocusWithinInput: boolean;
          readonly isFocusWithinOverlay: true;
          readonly disableAnimationOut: false;
      };

const initialTaskDateInputFocusState: TaskDateInputFocusState = {
    isFocusWithinInput: false,
    isFocusWithinOverlay: false,
    disableAnimationOut: false,
};

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

    const overlayId = useId();

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

    const [focusState, setFocusState] = useState(initialTaskDateInputFocusState);

    const isEditing =
        !isReadOnly && (focusState.isFocusWithinInput || focusState.isFocusWithinOverlay);

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
                disableAnimationOut={focusState.disableAnimationOut}
                // Focusing is a direct user interaction so don't animate. To focus out the
                // user clicks somewhere else which is an indirect interaction so animate.
                disableAnimationIn
                // Prefer rendering below the input, even on mobile. On mobile we might
                // incorrectly think there's enough space above when in fact we'd be
                // conflicting with the navigation bar.
                placement="bottom"
                offset={overlayOffset}
                // The overlay blocks interaction with everything outside the overlay. Except
                // the date input. We still want to render the overlay in our current
                // overlay scope so that it animates smoothly with scroll animations (important
                // on mobile when we need to avoid the keyboard).
                isBlocking={true}
                withoutRootBlockingScope={true}
                withoutBlockingTarget={true}
                // Set a constant `overflowBottom` value instead of relying on the current
                // keyboard height (which will be updated asynchronously after `isEditing` is
                // true). This stops the overlay placement from jumping around while the
                // keyboard opens. The value was calculated based on the keyboard height in
                // iOS. We may need to change this constant if the keyboard height for iOS
                // changes or the Android keyboard height is bigger.
                overflowBottom={isMobile ? "64" : undefined}
                overflowTop={navigationBarHeight[isMobile ? "mobile" : "desktop"]}
                overlay={
                    <div
                        ref={overlayRef}
                        id={overlayId}
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
                                const isFocusWithinOverlay = event.currentTarget.contains(
                                    event.target,
                                );

                                setFocusState((focusState): TaskDateInputFocusState => {
                                    if (focusState.isFocusWithinOverlay === isFocusWithinOverlay)
                                        return focusState;

                                    return {
                                        ...focusState,
                                        isFocusWithinOverlay,
                                        disableAnimationOut: false,
                                    };
                                });
                            });
                        }}
                        onBlur={event => {
                            // Chrome dispatches a "fake" blur event when the user has an element focused
                            // but then clicks on another window, focusing that window but leaving our
                            // current window visible. `blur` is dispatched but `document.activeElement`
                            // doesn't change!
                            //
                            // Detect this case. If we receive a `blur` event but `document.activeElement`
                            // hasn't changed then escalate to a real blur.
                            if (event.target === document.activeElement) {
                                event.target.blur();
                            }

                            // If we're focusing an element with a popup (`role="combobox"` [implicitly has
                            // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly
                            // focused element will probably open its popup.
                            //
                            // This happens when you have this input open then switch to another input by
                            // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
                            //
                            // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
                            const disableAnimationOut =
                                event.relatedTarget instanceof HTMLElement
                                    ? (event.relatedTarget.ariaHasPopup ??
                                          (event.relatedTarget.role === "combobox"
                                              ? "listbox"
                                              : null)) !== null
                                    : false;

                            // `<FocusRing>` updates are run with immediate priority. Make sure this update
                            // is as well so we see both update in the same render.
                            runWithImmediatePriority(() => {
                                const isFocusWithinOverlay = event.currentTarget.contains(
                                    event.relatedTarget,
                                );

                                setFocusState((focusState): TaskDateInputFocusState => {
                                    if (focusState.isFocusWithinOverlay === isFocusWithinOverlay)
                                        return focusState;

                                    if (
                                        !isFocusWithinOverlay &&
                                        !focusState.isFocusWithinInput &&
                                        disableAnimationOut
                                    ) {
                                        return {
                                            isFocusWithinOverlay,
                                            isFocusWithinInput: focusState.isFocusWithinInput,
                                            disableAnimationOut: true,
                                        };
                                    } else {
                                        return {
                                            ...focusState,
                                            isFocusWithinOverlay,
                                            disableAnimationOut: false,
                                        };
                                    }
                                });
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
                            const isFocusWithinInput = event.currentTarget.contains(event.target);

                            setFocusState((focusState): TaskDateInputFocusState => {
                                if (focusState.isFocusWithinInput === isFocusWithinInput)
                                    return focusState;

                                return {
                                    ...focusState,
                                    isFocusWithinInput,
                                    disableAnimationOut: false,
                                };
                            });
                        });
                    }}
                    onBlur={event => {
                        // Chrome dispatches a "fake" blur event when the user has an element focused
                        // but then clicks on another window, focusing that window but leaving our
                        // current window visible. `blur` is dispatched but `document.activeElement`
                        // doesn't change!
                        //
                        // Detect this case. If we receive a `blur` event but `document.activeElement`
                        // hasn't changed then escalate to a real blur.
                        if (event.target === document.activeElement) {
                            event.target.blur();
                        }

                        // If we're focusing an element with a popup (`role="combobox"` [implicitly has
                        // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly
                        // focused element will probably open its popup.
                        //
                        // This happens when you have this input open then switch to another input by
                        // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
                        const disableAnimationOut =
                            event.relatedTarget instanceof HTMLElement
                                ? (event.relatedTarget.ariaHasPopup ??
                                      (event.relatedTarget.role === "combobox"
                                          ? "listbox"
                                          : null)) !== null
                                : false;

                        // `<FocusRing>` updates are run with immediate priority. Make sure this updates
                        // with immediate priority as well so we see both update in the same render.
                        runWithImmediatePriority(() => {
                            const isFocusWithinInput = event.currentTarget.contains(
                                event.relatedTarget,
                            );

                            setFocusState((focusState): TaskDateInputFocusState => {
                                if (focusState.isFocusWithinInput === isFocusWithinInput)
                                    return focusState;

                                if (
                                    !isFocusWithinInput &&
                                    !focusState.isFocusWithinOverlay &&
                                    disableAnimationOut
                                ) {
                                    return {
                                        isFocusWithinInput,
                                        isFocusWithinOverlay: focusState.isFocusWithinOverlay,
                                        disableAnimationOut: true,
                                    };
                                } else {
                                    return {
                                        ...focusState,
                                        isFocusWithinInput,
                                        disableAnimationOut: false,
                                    };
                                }
                            });
                        });
                    }}
                >
                    <TaskDateInputText
                        date={date}
                        onDateChange={onDateChange}
                        aria-label={ariaLabel}
                        aria-labelledby={ariaLabelledBy}
                        overlayId={isEditing ? overlayId : null}
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
