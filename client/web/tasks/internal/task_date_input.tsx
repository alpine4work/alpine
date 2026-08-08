import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {CalendarBlank} from "phosphor-react";
import {useEffect, useId, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {DateInputCalendar} from "~/client/web/design/date_input_calendar.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {getElementSafeAreaInsetTopPx} from "~/client/web/design/safe_area_inset.js";
import {subscribeToMobileKeyboardFrameChange} from "~/client/web/design/subscribe_to_mobile_keyboard_frame_change.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useGetCurrentCoveredHeight} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {runWithImmediatePriority} from "~/client/web/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {formatTaskDate} from "~/client/web/tasks/format_task_date.js";
import {TaskDateInputText} from "~/client/web/tasks/internal/task_date_input_text.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {RemLength, Spacing, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";

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
 * The date field displays the formatted date we show everywhere but when you click
 * or focus we reveal a text input where you can type the date in your locale.
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
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
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

    const insetMarginY = height === "full" ? undefined : platform === "mobile" ? "2.5" : undefined;

    const getCurrentCoveredHeight = useGetCurrentCoveredHeight();

    // When our calendar overlay opens on mobile we need to scroll it into view if it's
    // rendered offscreen.
    //
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` does nothing when the task date
    // input is focused. Since that hooks is designed to avoid the mobile keyboard when
    // the mobile keyboard opens. However, if the mobile keyboard is already open and
    // the user focuses a date input then we still need to scroll the date input into
    // view. Instead of competing with `useScrollToAvoidBottomBarsAndMobileKeyboard()`
    // we fully implement scroll logic for when the date input is focused here.
    //
    // We have a hook that does basically the same thing in `<TaskDateInput>`. If you
    // make a change here you should also probably make a change there.
    const lastIsEditingRef = useRef(isEditing);
    useEffect(() => {
        if (lastIsEditingRef.current === isEditing) return;
        lastIsEditingRef.current = isEditing;

        if (platform !== "mobile") return;
        if (!isEditing) return;

        const overlayElement = assertExists(overlayRef.current);
        const overlayRectForMobileWebKit =
            isMobileWebKit && !NativeMobileBridge ? overlayElement.getBoundingClientRect() : null;

        const run = () => {
            // If component has unmounted, don't continue.
            if (!inputRef.current) return;

            const inputElement = inputRef.current;
            const overlayElement = assertExists(overlayRef.current);

            let scrollableElement: HTMLElement | null = inputElement.parentElement;
            while (scrollableElement !== null) {
                const {overflowY} = getComputedStyle(scrollableElement);

                // We found our scrollable element!
                if (overflowY === "scroll" || overflowY === "auto") break;

                scrollableElement = scrollableElement.parentElement;
            }

            if (scrollableElement === null) return;

            const inputRect = inputElement.getBoundingClientRect();
            const viewportRect = document.documentElement.getBoundingClientRect();

            // NOTE(calebmer, #mobile-webkit-weirdness): For some reason, and I have truly no
            // idea, in Safari (but not in the native app!) when we call
            // `getBoundingClientRect()` for overlay here it gives us the position before
            // Popper.js positioning is applied. But if we call `getBoundingClientRect()`
            // directly in the effect all is fine...
            const overlayRect =
                overlayRectForMobileWebKit ?? overlayElement.getBoundingClientRect();

            const top = Math.min(inputRect.top, overlayRect.top);
            const bottom = Math.max(inputRect.bottom, overlayRect.bottom);

            const spacingScale = getSpacingScaleWithoutListening();

            const clearanceTop =
                getElementSafeAreaInsetTopPx(scrollableElement) +
                convertRemLengthToPx(navigationBarHeight, spacingScale) +
                convertRemLengthToPx("1", spacingScale);

            if (top < clearanceTop) {
                const scrollDelta = top - clearanceTop;

                scrollableElement.scrollTo({
                    top: scrollableElement.scrollTop + scrollDelta,
                    behavior: "smooth",
                });
                return;
            }

            const clearanceBottom =
                viewportRect.height -
                getCurrentCoveredHeight() -
                convertRemLengthToPx("1", spacingScale);

            if (bottom > clearanceBottom) {
                const scrollDelta = bottom - clearanceBottom;

                scrollableElement.scrollTo({
                    top: scrollableElement.scrollTop + scrollDelta,
                    behavior: "smooth",
                });
                return;
            }
        };

        // This effect needs to run after `NativeMobileBridge` calls
        // `keyboard.subscribeToFrameChange` subscribers. That way we can properly avoid
        // the keyboard.
        const cleanup = subscribeToMobileKeyboardFrameChange(() => {
            cleanup();
            timeout.clear();
            run();
        });

        const timeout = createTimeout(() => {
            cleanup();
            timeout.clear();
            run();
        }, perceivedAsInstantLimitMs);
    }, [getCurrentCoveredHeight, isEditing, platform, routeLayout]);

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
                // Height of 9 for 45px on mobile to meet the [minimum recommended touch hit target
                // size][1].
                //
                // [1]:
                //     https://developer.apple.com/design/human-interface-guidelines/buttons#Best-practices
                height:
                    height === "full" ? "full" : platform === "mobile" ? "9" : cast<"4">(height),
                marginY: insetMarginY ? `-${insetMarginY}` : undefined,
            })}
        >
            {!isEditing && formattedDate && (
                <div
                    className={sprinkles({
                        // Inline flex so the clickable range doesn't extend beyond the input's contents.
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
                        // Render read-only date inputs as a single div so they may be easily selected and
                        // copied/pasted.
                        <div
                            {...previewPressProps}
                            className={sprinkles({
                                flexGrow: display === "block" ? "1" : undefined,
                                display: "flex",
                                alignItems: "center",
                                paddingLeft: !shouldIncludeCalendarIcon ? paddingX : undefined,
                                paddingRight: paddingX,
                            })}
                            // Small UX improvement, focus the day input segment if the text is "Today" or
                            // "Yesterday".
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
                                // Small UX improvement, focus the input segment the user clicked on. It's a little
                                // strange how the preview text transforms into editable text. Especially
                                // disorienting when you click the end and the start is focused. So attempt to
                                // focus the same segment the user clicked.
                                //
                                // We hope that the words separated by spaces in our date line up with the editable
                                // input segments which is the case with the en-US locale but this heuristic may
                                // need to be hardened for other locales.
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
                // Focusing is a direct user interaction so don't animate. To focus out the user
                // clicks somewhere else which is an indirect interaction so animate.
                disableAnimationIn
                // Prefer rendering the overlay above the input on mobile since the keyboard will
                // open below the input causing an overlay rendered below to jump up.
                placement={platform === "mobile" ? "top" : "bottom"}
                offset={overlayOffset}
                // The overlay blocks interaction with everything outside the overlay. Except the
                // date input. We still want to render the overlay in our current overlay scope so
                // that it animates smoothly with scroll animations (important on mobile when we
                // need to avoid the keyboard).
                isBlocking={true}
                withoutRootBlockingScope={true}
                withoutBlockingTarget={true}
                onBlockingCoverPointerDown={() => {
                    if (document.activeElement instanceof HTMLElement)
                        document.activeElement.blur();
                }}
                // Set a constant `overflowBottom` value instead of relying on the current keyboard
                // height (which will be updated asynchronously after `isEditing` is true). This
                // stops the overlay placement from jumping around while the keyboard opens. The
                // value was calculated based on the keyboard height in iOS. We may need to change
                // this constant if the keyboard height for iOS changes or the Android keyboard
                // height is bigger.
                overflowBottom={platform === "mobile" ? "18rem" : undefined}
                overflowTop={navigationBarHeight}
                overlay={
                    <div
                        ref={overlayRef}
                        id={overlayId}
                        className={classNames(
                            greyElevated2ClassName,
                            sprinkles({
                                borderRadius: "1.5",
                                backgroundColor: "grey-0",
                                boxShadow: "elevation-20",
                            }),
                        )}
                        // Focusable so that if you click on the calendar without clicking a date, we
                        // consider the calendar focused and won't close the overlay.
                        tabIndex={-1}
                        onFocus={event => {
                            // `<FocusRing>` updates are run with immediate priority. Make sure this update is
                            // as well so we see both update in the same render.
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
                            // Chrome dispatches a "fake" blur event when the user has an element focused but
                            // then clicks on another window, focusing that window but leaving our current
                            // window visible. `blur` is dispatched but `document.activeElement` doesn't
                            // change!
                            //
                            // Detect this case. If we receive a `blur` event but `document.activeElement`
                            // hasn't changed then escalate to a real blur.
                            if (event.target === document.activeElement) {
                                event.target.blur();
                            }

                            // If we're focusing an element with a popup (`role="combobox"` [implicitly has
                            // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly focused
                            // element will probably open its popup.
                            //
                            // This happens when you have this input open then switch to another input by
                            // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
                            //
                            // [1]:
                            //     https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
                            const disableAnimationOut =
                                event.relatedTarget instanceof HTMLElement
                                    ? (event.relatedTarget.ariaHasPopup ??
                                          (event.relatedTarget.role === "combobox"
                                              ? "listbox"
                                              : null)) !== null
                                    : false;

                            // `<FocusRing>` updates are run with immediate priority. Make sure this update is
                            // as well so we see both update in the same render.
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
                        <DateInputCalendar
                            date={date}
                            onDateChange={onDateChange}
                            monthCount={platform === "mobile" ? 1 : 2}
                            onClear={() => onDateChange(null)}
                        />
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
                        // Chrome dispatches a "fake" blur event when the user has an element focused but
                        // then clicks on another window, focusing that window but leaving our current
                        // window visible. `blur` is dispatched but `document.activeElement` doesn't
                        // change!
                        //
                        // Detect this case. If we receive a `blur` event but `document.activeElement`
                        // hasn't changed then escalate to a real blur.
                        if (event.target === document.activeElement) {
                            event.target.blur();
                        }

                        // If we're focusing an element with a popup (`role="combobox"` [implicitly has
                        // `aria-haspopup="listbox"`][1]) then don't animate out. Since the newly focused
                        // element will probably open its popup.
                        //
                        // This happens when you have this input open then switch to another input by
                        // tapping in `<TaskGridViewMobileKeyboardToolbar>`.
                        //
                        // [1]:
                        //     https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
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
