import {PressEvent} from "@react-types/shared";
import classNames from "classnames";
import {IconContext, SpinnerGap} from "phosphor-react";
import {
    ReactNode,
    Ref,
    createElement,
    forwardRef,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    subscribeToTriggeredOverlayCloseEvent,
    subscribeToTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip, TooltipRef} from "~/client/web/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useTouchSlop} from "~/client/web/design/use_touch_slop.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {
    Sprinkles,
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    buttonStyles,
    colorSchemeVars,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

export const buttonMinWidth = "16";

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant =
    | "quiet"
    | "quieter"
    | "quietest"
    | "quiet-even-when-disabled"
    | "quieter-even-when-disabled"
    | "quietest-even-when-disabled"
    | "quiet-on"
    | "quiet-off"
    | "neutral"
    | "neutral-disabled"
    | "accent"
    | "accent-even-when-disabled"
    | "outline"
    | "text-input";

function Button(
    props: Omit<AriaButtonProps<"button">, "onPress"> & {
        /**
         * Label text for the button.
         */
        children: ReactNode;

        /**
         * When the user presses a button we fire this event. Use it to perform an action
         * in response to the button press.
         *
         * If a promise is returned then the button is put into a pending state until the
         * promise resolves.
         */
        onPress?: (event: PressEvent) => void | Promise<void>;

        /**
         * If an error occurs while running `onPress` we will report the error to the user
         * with this title. It is the "what happened" part of an error message according to
         * [Adobe Spectrum's][1] error content guidelines.
         *
         * So for example it this is a delete comment action say "Couldn't delete comment".
         *
         * Optional if the `onPress` event does not return a promise.
         *
         * [1]: https://spectrum.adobe.com/page/writing-for-errors
         */
        pressErrorTitle?: string;

        /**
         * Which styles should we apply to the variant?
         */
        variant?: ButtonVariant;

        /**
         * An optional icon element rendered next to the button label.
         */
        icon?: MaybeThunk<ReactNode, [props: {isPressed: boolean}]>;

        /**
         * Is the icon at the front or back of the button? Defaults to `start`.
         */
        iconPlacement?: "start" | "end";

        /**
         * A keyboard shortcut that will display in a tooltip on the button.
         */
        keyboardShortcutHint?: ReactNode;

        /**
         * Tooltip offset for the keyboard shortcut hint.
         */
        keyboardShortcutHintTooltipOffset?: Spacing;

        /**
         * Are we waiting for some asynchronous action that was initiated by our button to
         * complete?
         *
         * If your `onPress` event returns a promise then the button is automatically put
         * into a pending state and you don't need to pass in this prop.
         */
        isPending?: boolean;

        /**
         * Should we show the pending spinner even if the delay after switching to
         * `isPending` hasn't occurred? If `undefined` then we only show the pending
         * spinner after a short delay when `isPending` is set. If `false` then we never
         * show the pending loading spinner and if `true` then we always show the pending
         * loading spinner (if `isPending` is also true).
         *
         * Generally you should avoid using this prop and let the button handle its own
         * loading spinner. This is an advanced feature when you need to exactly control
         * when the pending spinner shows.
         */
        shouldShowPendingSpinner?: boolean;

        /**
         * Never show loading indicator even if `isPending` is true. Useful if when
         * `isPending` is set to true, some other loading indicator is visible.
         */
        withoutLoadingIndicator?: boolean;

        /**
         * Give the button a 100% width so it fills all available space. Defaults to false.
         */
        fullWidth?: boolean;

        /**
         * Set the maximum width of the button. If the button exceeds this width the text
         * will be truncated.
         */
        maxWidth?: "full";

        /**
         * Should the button not have a default minimum width? Can be used when there's not
         * much available space. Normally short buttons like "Ok" need a minimum width to
         * continue looking like a button.
         */
        withoutMinWidth?: boolean;

        /**
         * Should this button submit an HTML `<form>` element that it is inside? You don't
         * need a press event if true.
         */
        shouldSubmitForm?: boolean;

        /**
         * Don't focus the button when it's pressed. By default, this is true if
         * `isFocusable` is false.
         */
        withoutFocusOnPress?: boolean;

        /**
         * Should we show the pressed style even if the button isn't currently pressed?
         * Useful if there's some secondary press target for this button.
         */
        isPressed?: boolean;

        /**
         * Should we show the hovered style even if the button isn't currently hovered?
         * Useful if there's some secondary hover target for this icon button.
         */
        isHovered?: boolean;

        /**
         * Is the button disabled? Does not display a reason tooltip like when you use
         * `disabledReason`. Generally you should prefer `disabledReason`. If you set
         * `disabledReason` then you don't have to set `isDisabled`. Disabled actions may
         * not be selected.
         */
        isDisabled?: boolean;

        /**
         * Is this button disabled? If so, for what reason? We will display the reason as a
         * tooltip if the user tries to interact with a disabled action. Disabled actions
         * may not be selected.
         */
        disabledReason?: string;

        /**
         * Control how much horizontal padding on this button. Default is `3`.
         */
        paddingX?: "1" | "1.5" | "2" | "2.5" | "3";

        /**
         * How tall is this button? Default is `7`.
         */
        height?:
            | "5"
            | "6"
            | "7"
            | "8"
            | "9"
            | "full"
            | {
                  desktop: "5" | "6" | "7" | "8" | "9" | "full";
                  mobile: "5" | "6" | "7" | "8" | "9" | "full";
              };

        /**
         * Gap between the icon and button label. Default is `1`.
         */
        iconGap?: "0.5" | "1" | "1.5" | "2";

        /**
         * The font size of the button. Defaults to `75`.
         */
        // TODO(calebmer): Instead of having separate `paddingX`, `height`, and `fontSize`
        // we should probably put together size presets that look nice like
        // `<IconButton>`'s `size` prop?
        fontSize?: "50" | "75" | "100" | "200";

        /**
         * Amount of border radius to use. Defaults to `1`.
         */
        borderRadius?: "1" | "1.5" | "2";

        /**
         * Amount of border radius to apply to the right of the button. Defaults to `1`.
         * Only really used to remove border radius.
         */
        borderRightRadius?: "1" | "none";

        /**
         * What to set `flexShrink` to. Defaults to 0.
         */
        flexShrink?: "0" | "1";

        /**
         * Choose how to offset the focus ring around this button. Default is based on the
         * button `variant`.
         *
         * The underlying `<FocusRing>` default is `0.5`. (But sometimes we choose `0`
         * based on the variant.)
         */
        focusRingOffset?: "border" | "0" | "0.5";

        /**
         * Disable focusing this button through sequential keyboard navigation using the
         * `Tab` button. This sets `tabindex="-1"` on the element. The element will still
         * be programmatically focusable.
         *
         * Defaults to `true`.
         */
        isTabbable?: boolean;

        /**
         * Disables the ability to focus this button. Turns the element into a `<div>` and
         * doesn't set `tabindex` on the element. The element isn't even focusable
         * programmatically. Useful if you don't want focus to move when the button is
         * pressed.
         *
         * Defaults to `true`.
         */
        isFocusable?: boolean;

        /**
         * Called when we start hovering the button.
         */
        onHoverStart?: () => void;

        /**
         * Called when we stop hovering the button.
         */
        onHoverEnd?: () => void;
    },
    foreignRef:
        | Ref<
              HTMLButtonElement & {
                  // We add a `press()` function to our `HTMLButtonElement` so you can externally
                  // call the button's press handler to properly handle loading states and error
                  // states.
                  //
                  // You could call `click()` but that focuses the button which you might not want.
                  press(): void;
              }
          >
        | Ref<HTMLButtonElement>,
) {
    const {
        children,
        variant = "quiet",
        icon,
        iconPlacement = "start",
        isDisabled: isDisabledFromProps = false,
        disabledReason,
        keyboardShortcutHint,
        keyboardShortcutHintTooltipOffset,
        isPending: isPendingFromProps,
        shouldShowPendingSpinner: shouldShowPendingSpinnerFromProps,
        withoutLoadingIndicator = false,
        fullWidth = false,
        maxWidth,
        withoutMinWidth = false,
        shouldSubmitForm = false,
        withoutFocusOnPress = false,
        isPressed: isPressedFromProps = false,
        isHovered: isHoveredFromProps = false,
        onPress,
        pressErrorTitle,
        paddingX = "3",
        height = "7",
        iconGap = "1",
        fontSize = "75",
        borderRadius = "1",
        borderRightRadius,
        flexShrink = "0",
        focusRingOffset,
        isTabbable = true,
        isFocusable = true,
        onHoverStart,
        onHoverEnd,
    } = props;
    const platform = usePlatform();
    const reporter = useReporter();
    const localRef = useRef<HTMLButtonElement | null>(null);

    const isDisabled = isDisabledFromProps || disabledReason !== undefined;

    const [isPendingFromPress, setIsPendingFromPress] = useState(false);
    const isPending = isPendingFromProps || isPendingFromPress;

    const disabledReasonTooltipRef = useRef<TooltipRef>(null);

    const handlePress = (event: PressEvent) => {
        if (isDisabled || isPending) return;

        const defaultPressErrorTitle =
            event.pointerType === "touch"
                ? "The button you tapped didn\u2019t work"
                : "The button you clicked didn\u2019t work";

        let promise;
        try {
            promise = onPress?.(event);
        } catch (error) {
            reporter.displayError(pressErrorTitle ?? defaultPressErrorTitle, error);
            return;
        }

        // If the press returns a promise:
        //
        // - Show a loading spinner after a short delay
        // - Show a toast if there was an error
        if (promise instanceof Promise) {
            setIsPendingFromPress(true);

            assert(
                pressErrorTitle,
                "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
            );

            promise.then(
                () => {
                    setIsPendingFromPress(false);
                },
                error => {
                    setIsPendingFromPress(false);
                    reporter.displayError(pressErrorTitle, error);
                },
            );
        }
    };

    const handlePressRef = useRef(handlePress);
    useLayoutEffectWithoutServerSideWarning(() => {
        handlePressRef.current = handlePress;
    });

    const {buttonProps, isPressed: isPressedFromButton} = useButton(
        {
            ...props,
            elementType: isFocusable ? "button" : "div",
            // NOTE(calebmer): Don't disable the button while it's pending. We don't want to
            // run the press event handler again while the button is pending but we do still
            // want the button to be interactive (`isPressed` should be true and we shouldn't
            // set the `disabled` HTML property).
            isDisabled,
            type: shouldSubmitForm ? "submit" : undefined,
            onPress: handlePress,
            // We don't focus on press on mobile since if you press down a button the user
            // might be scrolling! So if the keyboard is open we don't want to close the
            // keyboard since the button is focused.
            //
            // @ts-expect-error: This prop exists but is undocumented
            // https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/button/src/useButton.ts#L57-L58
            preventFocusOnPress: withoutFocusOnPress || platform === "mobile" || !isFocusable,
            onKeyDown: event => {
                // `react-spectrum` prevents propagation by default. If `event.preventDefault()`
                // wasn't called, we want the event to propagate. That way `<GlobalKeyDownEvent>`
                // handlers can fire. Most notably our undo cmd-z handler.
                if (!event.defaultPrevented) {
                    event.continuePropagation();
                }
            },
        },
        localRef,
    );

    const isPressed = isPressedFromButton || isPressedFromProps;

    const {hoverProps, isHovered: isHoveredFromState} = useHover({
        onHoverStart,
        onHoverEnd,
    });

    const isHovered = isHoveredFromProps || isHoveredFromState;

    // If we are rendered inside an `<OverlayTriggerButton>` we want to apply our hover
    // styles even though we aren't receiving pointer events since there's a cover over
    // the DOM.
    const [isTriggeredOverlayOpen, setIsTriggeredOverlayOpen] = useState(false);

    const isHoveredBackground = isHovered || isTriggeredOverlayOpen;

    const touchSlop = useTouchSlop(height);

    // We wait a bit before showing our pending spinner. Some actions are very fast so
    // we delay showing a spinner to avoid a loading spinner flicker which can be
    // jarring.
    const shouldShowPendingSpinner =
        (useDelayLoadingIndicator(
            isPending && typeof shouldShowPendingSpinnerFromProps === "undefined",
        ) &&
            !withoutLoadingIndicator) ||
        (shouldShowPendingSpinnerFromProps && isPending);

    const isBold = variant === "neutral" && !isDisabled;

    const labelChild = (
        <span
            className={sprinkles({
                display: "block",
                fontStyle: "truncate",
            })}
            style={{
                // NOTE(calebmer): I'm finding `font-weight: 500` looks a little too bold here. So
                // tone down the font weight a bit.
                fontWeight: isBold ? 425 : undefined,
            }}
        >
            {children}
        </span>
    );

    const iconSize: Spacing = "3";

    const iconChild = icon ? (
        <span
            className={sprinkles({
                position: "relative",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            })}
        >
            <span style={{opacity: shouldShowPendingSpinner ? 0 : undefined}}>
                <IconContext.Provider
                    value={{
                        color: "currentColor",
                        size: spacing[iconSize],
                        weight: isBold ? "bold" : "regular",
                    }}
                >
                    {typeof icon === "function" ? icon({isPressed}) : icon}
                </IconContext.Provider>
            </span>
            {shouldShowPendingSpinner && (
                <SpinnerGap
                    className={spinAnimationClassName}
                    size={spacing[iconSize]}
                    style={{position: "absolute"}}
                />
            )}
        </span>
    ) : null;

    let styles: Sprinkles;
    let isQuietVariant = false;

    switch (variant) {
        case "quiet": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: "grey-100",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "quieter": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-60",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "quietest": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-50",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "quiet-even-when-disabled": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: "grey-100",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-100",
                  };
            break;
        }
        case "quieter-even-when-disabled": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-60",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-60",
                  };
            break;
        }
        case "quietest-even-when-disabled": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-50",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-50",
                  };
            break;
        }
        case "quiet-on": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed ? "grey-10-translucent" : "grey-5-translucent",
                      color: "grey-100",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "quiet-off": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredBackground
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-50",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "neutral": {
            styles = !isDisabled
                ? {
                      backgroundColor: {light: "grey-90", dark: "grey-100"},
                      color: "grey-0",
                  }
                : {
                      backgroundColor: "grey-5",
                      color: "grey-30",
                  };
            break;
        }
        case "neutral-disabled": {
            styles = {
                backgroundColor: "grey-5",
                // Slightly darker text color than the usual disabled color (`grey-30`) since we
                // want to make the button look a little more interactive. If you use
                // `neutral-disabled` instead of `isDisabled` it's probably because you want the
                // button to do something when pressed.
                color: "grey-40",
            };
            break;
        }
        case "accent": {
            styles = !isDisabled
                ? {
                      backgroundColor: accentThemeBackgroundColor,
                      color: accentThemeForegroundColor,
                  }
                : {
                      backgroundColor: "grey-5",
                      color: "grey-30",
                  };
            break;
        }
        // We have the accent styles even when the button is disabled. Disabling makes the
        // button not clickable or focusable but does not visually change the button.
        // Useful for buttons we really want to accent.
        case "accent-even-when-disabled": {
            styles = {
                backgroundColor: accentThemeBackgroundColor,
                color: accentThemeForegroundColor,
            };
            break;
        }
        case "outline": {
            styles = !isDisabled
                ? {
                      backgroundColor: isPressed ? "grey-10" : undefined,
                      color: "grey-100",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "text-input": {
            styles = !isDisabled
                ? {
                      backgroundColor: isPressed ? "grey-5" : "grey-0",
                      color: "grey-100",
                      boxShadow: "elevation-5-with-grey-10-border",
                  }
                : {
                      backgroundColor: "grey-5",
                      color: "grey-30",
                      boxShadow: "elevation-5-with-grey-10-border",
                  };
            break;
        }
        default:
            throw exhaustive(variant);
    }

    const isOutlineVariant = variant === "outline";

    const willDarkenWithOverlayOnPress =
        !isQuietVariant && !isOutlineVariant && variant !== "text-input";

    useEffect(() => {
        // Element is re-created when this prop changes.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        isFocusable;

        const element = assertExists(localRef.current);

        const handleOverlayOpen = () => setIsTriggeredOverlayOpen(true);
        const handleOverlayClose = () => setIsTriggeredOverlayOpen(false);

        const unsubscribe1 = subscribeToTriggeredOverlayOpenEvent(element, handleOverlayOpen);
        const unsubscribe2 = subscribeToTriggeredOverlayCloseEvent(element, handleOverlayClose);

        return () => {
            unsubscribe1();
            unsubscribe2();
        };
    }, [isFocusable]);

    let node = (
        <FocusRing
            offset={focusRingOffset ?? (isQuietVariant ? "0" : "0.5")}
            insetY={touchSlop.slop}
        >
            {createElement(
                isFocusable ? "button" : "div",
                // eslint-disable-next-line react-compiler/react-compiler
                {
                    ...mergeProps(
                        // eslint-disable-next-line react-compiler/react-compiler
                        {
                            onPointerDown: () => {
                                // Make sure to skip the tooltip hover delay and show the disabled reason
                                // immediately on press.
                                if (disabledReason !== undefined) {
                                    assertExists(
                                        disabledReasonTooltipRef.current,
                                    ).skipTooltipHoverDelay();
                                }
                            },
                        },
                        buttonProps,
                        hoverProps,
                    ),
                    ref: useCallback(
                        (element: HTMLButtonElement) => {
                            if (element === null) {
                                localRef.current = null;
                                assignRef(foreignRef, null);
                            } else {
                                const actualElement = Object.assign(element, {
                                    press: () => {
                                        handlePressRef.current({
                                            type: "press",
                                            pointerType: "virtual",
                                            target: element,
                                            shiftKey: false,
                                            ctrlKey: false,
                                            metaKey: false,
                                            altKey: false,
                                            continuePropagation: () => {},
                                        });
                                    },
                                });

                                localRef.current = actualElement;
                                assignRef(foreignRef, actualElement);
                            }
                        },
                        [foreignRef],
                    ),
                    className: sprinkles({
                        display: "flex",
                        width: fullWidth ? "full" : undefined,
                        maxWidth,
                        height: touchSlop.sizeWithSlop,
                        paddingY: touchSlop.slop,
                        marginY: `-${touchSlop.slop}`,
                        borderRadius: "1",
                        // If this button is in a `display: flex` element, don't shrink the button based on
                        // other contents.
                        flexShrink,
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                    }),
                    tabIndex: isFocusable ? (!isTabbable ? -1 : buttonProps.tabIndex) : undefined,
                },
                <span
                    className={sprinkles({
                        ...styles,
                        position: "relative",
                        overflow: "hidden",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        height,
                        minWidth: !withoutMinWidth && !isQuietVariant ? buttonMinWidth : undefined,
                        width: fullWidth ? "full" : undefined,
                        paddingX,
                        fontSize,
                        borderLeftRadius: borderRadius,
                        borderRightRadius: borderRightRadius ?? borderRadius,
                    })}
                    style={{
                        // Use a box-shadow for drawing the border so it doesn't affect layout.
                        boxShadow: isOutlineVariant
                            ? `inset 0 0 0 1px ${
                                  colorSchemeVars[isPressed ? "grey-20" : "grey-10"]
                              }`
                            : undefined,
                    }}
                >
                    {isPressed && willDarkenWithOverlayOnPress && (
                        // For accent buttons, instead of choosing a darker background color shade when
                        // pressed we add a black overlay at a lowered opacity. We accomplish this with an
                        // overlay element since such a color is not in our color scheme.
                        //
                        // Darker shades in our color scheme are more saturated. We want the effect of a
                        // button being physically pressed down.
                        //
                        // When we added this there was a happy accident. The text color also got darker!
                        // This is more fitting for the physical analogy of a button being pressed down.
                        <span
                            className={sprinkles({
                                zIndex: "50",
                                position: "absolute",
                                inset: "0",
                                backgroundColor: "grey-100-const",
                                pointerEvents: "none",
                            })}
                            style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                        />
                    )}
                    {shouldShowPendingSpinner && !iconChild && (
                        <SpinnerGap
                            className={classNames(
                                sprinkles({position: "absolute"}),
                                spinAnimationClassName,
                            )}
                            size={spacing["4"]}
                        />
                    )}
                    <span
                        className={sprinkles({
                            display: "flex",
                            alignItems: "center",
                            gap: iconGap,
                            maxWidth: "full",
                        })}
                        style={{
                            // Keep the icon and label in the DOM so we keep the shape of the button but hide
                            // them so we can show a spinner.
                            opacity: shouldShowPendingSpinner && !iconChild ? 0 : undefined,
                        }}
                    >
                        {iconPlacement === "start" && iconChild}
                        {labelChild}
                        {iconPlacement === "end" && iconChild}
                    </span>
                </span>,
            )}
        </FocusRing>
    );

    if (keyboardShortcutHint) {
        node = (
            <Tooltip
                placement="bottom"
                offset={keyboardShortcutHintTooltipOffset}
                content={
                    <Box color="grey-50">
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing["3"],
                            }}
                        >
                            {keyboardShortcutHint}
                        </IconContext.Provider>
                    </Box>
                }
            >
                {node}
            </Tooltip>
        );
    }

    if (disabledReason !== undefined) {
        node = (
            <Tooltip
                ref={disabledReasonTooltipRef}
                placement="bottom-start"
                content={disabledReason}
                // If the user presses a disabled button, keep showing the tooltip.
                isVisibleAfterPress={true}
            >
                {node}
            </Tooltip>
        );
    }

    return node;
}
