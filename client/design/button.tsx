import {PressEvent} from "@react-types/shared";
import classNames from "classnames";
import {IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, Ref, createElement, forwardRef, useCallback, useRef, useState} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {
    onTriggeredOverlayCloseSymbol,
    onTriggeredOverlayOpenSymbol,
} from "~/client/design/overlay_trigger_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/helpers/refs/assign_ref.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    Sprinkles,
    buttonStyles,
    colorSchemeVars,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant =
    | "quiet"
    | "quieter"
    | "quieter2"
    | "quiet-on"
    | "quiet-off"
    | "quiet-above-grey-5-dark-background"
    | "neutral"
    | "accent"
    | "accent-even-when-disabled"
    | "outline";

function Button(
    props: Omit<AriaButtonProps<"button">, "onPress"> & {
        /**
         * Label text for the button.
         */
        children: ReactNode;

        /**
         * When the user presses a button we fire this event. Use it to perform
         * an action in response to the button press.
         *
         * If a promise is returned then the button is put into a pending state until
         * the promise resolves.
         */
        onPress?: (event: PressEvent) => void | Promise<void>;

        /**
         * If an error occurs while running `onPress` we will report the error to the user with
         * this title. It is the "what happened" part of an error message according to [Adobe
         * Spectrum's][1] error content guidelines.
         *
         * So for example it this is a delete comment action say "Couldn’t delete comment".
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
        icon?: ReactNode;

        /**
         * Is the icon at the front or back of the button? Defaults to `start`.
         */
        iconPlacement?: "start" | "end";

        /**
         * A keyboard shortcut that will display in a tooltip on the button.
         */
        keyboardShortcutHint?: ReactNode;

        /**
         * Are we waiting for some asynchronous action that was initiated by our button
         * to complete?
         *
         * If your `onPress` event returns a promise then the button is automatically
         * put into a pending state and you don't need to pass in this prop.
         */
        isPending?: boolean;

        /**
         * Never show loading indicator even if `isPending` is true. Useful if when
         * `isPending` is set to true, some other loading indicator is visible.
         */
        withoutLoadingIndicator?: boolean;

        /**
         * Give the button a 100% width so it fills all available space. Defaults
         * to false.
         */
        fullWidth?: boolean;

        /**
         * Should the button not have a default minimum width? Can be used when there's
         * not much available space. Normally short buttons like "Ok" need a minimum
         * width to continue looking like a button.
         */
        withoutMinWidth?: boolean;

        /**
         * Should this button submit an HTML `<form>` element that it is inside? You
         * don't need a press event if true.
         */
        shouldSubmitForm?: boolean;

        /**
         * Control how much horizontal padding on this button. Default is `3`.
         */
        paddingX?: "1.5" | "2" | "3";

        /**
         * How tall is this button? Default is `7`.
         */
        height?:
            | "5"
            | "6"
            | "7"
            | "full"
            | {desktop: "5" | "6" | "7" | "full"; mobile: "5" | "6" | "7" | "full"};

        /**
         * Gap between the icon and button label. Default is `1`.
         */
        iconGap?: "0.5" | "1" | "1.5" | "2";

        /**
         * The font size of the button. Defaults to `75`.
         */
        // TODO(calebmer): Instead of having separate `paddingX`, `height`, and
        // `fontSize` we should probably put together size presets that look nice like
        // `<IconButton>`'s `size` prop?
        fontSize?: "75" | "100";

        /**
         * Amount of border radius to apply to the left of the button. Defaults to
         * `base`. Only really used to remove border radius.
         */
        borderRightRadius?: "base" | "none";

        /**
         * What to set `flexShrink` to. Defaults to 0.
         */
        flexShrink?: "0" | "1";

        /**
         * Disable focusing this button through sequential keyboard navigation using
         * the `Tab` button. This sets `tabindex="-1"` on the element. The element will
         * still be programmatically focusable.
         *
         * Defaults to `true`.
         */
        isTabbable?: boolean;

        /**
         * Disables the ability to focus this button. Turns the element into a `<div>`
         * and doesn't set `tabindex` on the element. The element isn't even focusable
         * programmatically. Useful if you don't want focus to move when the button is
         * pressed.
         *
         * Defaults to `true`.
         */
        isFocusable?: boolean;
    },
    foreignRef:
        | Ref<
              HTMLButtonElement & {
                  // We add a `press()` function to our `HTMLButtonElement` so you can externally
                  // call the button's press handler to properly handle loading states and error
                  // states.
                  //
                  // You could call `click()` but that focuses the button which you might not
                  // want.
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
        isDisabled,
        keyboardShortcutHint,
        isPending: isPendingFromProps,
        withoutLoadingIndicator = false,
        fullWidth = false,
        withoutMinWidth = false,
        shouldSubmitForm = false,
        onPress,
        pressErrorTitle,
        paddingX = "3",
        height = "7",
        iconGap = "1",
        fontSize = "75",
        borderRightRadius = "base",
        flexShrink = "0",
        isTabbable = true,
        isFocusable = true,
    } = props;
    const isMobile = useIsMobile();
    const showToast = useShowToast();
    const localRef = useRef<HTMLButtonElement | null>(null);

    const [isPendingFromPress, setIsPendingFromPress] = useState(false);
    const isPending = isPendingFromProps || isPendingFromPress;

    const handlePress = (event: PressEvent) => {
        if (isDisabled || isPending) return;

        const defaultPressErrorTitle =
            event.pointerType === "touch"
                ? "The button you tapped didn’t work"
                : "The button you clicked didn’t work";

        let promise;
        try {
            promise = onPress?.(event);
        } catch (error) {
            showToast({
                type: "Error",
                title: pressErrorTitle ?? defaultPressErrorTitle,
                error,
            });
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
                    showToast({
                        type: "Error",
                        title: pressErrorTitle,
                        error,
                    });
                },
            );
        }
    };

    const handlePressRef = useRef(handlePress);
    useLayoutEffectWithoutServerSideWarning(() => {
        handlePressRef.current = handlePress;
    });

    const {buttonProps, isPressed} = useButton(
        {
            ...props,
            elementType: isFocusable ? "button" : "div",
            // Disable the button while we are pending to avoid multiple clicks firing the
            // action multiple times.
            isDisabled: isDisabled || isPending,
            type: shouldSubmitForm ? "submit" : undefined,
            onPress: handlePress,
            // We don't focus on press on mobile since if you press down a button the user
            // might be scrolling! So if the keyboard is open we don't want to close the
            // keyboard since the button is focused. An easy case to test this is
            // `<TaskNotepadView>`. Open the keyboard on a task then start your scroll on
            // the "Fresh page" button.
            //
            // @ts-expect-error: This prop exists but is undocumented
            // https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/button/src/useButton.ts#L57-L58
            preventFocusOnPress: isMobile || !isFocusable,
            onKeyDown: event => {
                // `react-spectrum` prevents propagation by default. If
                // `event.preventDefault()` wasn't called, we want the event to propagate. That
                // way `<GlobalKeyDownEvent>` handlers can fire. Most notably our undo cmd-z
                // handler.
                if (!event.defaultPrevented) {
                    event.continuePropagation();
                }
            },
        },
        localRef,
    );

    const {hoverProps, isHovered} = useHover({});

    // If we are rendered inside an `<OverlayTriggerButton>` we want to apply our
    // hover styles even though we aren't receiving pointer events since there's a
    // cover over the DOM.
    const [isTriggeredOverlayOpen, setIsTriggeredOverlayOpen] = useState(false);

    const isHoveredOrTriggeredOverlayOpen = isHovered || isTriggeredOverlayOpen;

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const shouldShowPendingSpinner =
        useDelayLoadingIndicator(isPending) && !withoutLoadingIndicator;

    const isBold = variant === "neutral" && !isDisabled;

    const labelChild = (
        <span
            className={sprinkles({
                display: "block",
                fontStyle: isBold ? "truncate-semi-bold" : "truncate",
            })}
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
                    {icon}
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

    const stylesByVariant: {[K in ButtonVariant]: Sprinkles} = {
        quiet: !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-10"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-5"
                      : undefined,
                  color: "grey-100",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        quieter: !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-10"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-5"
                      : undefined,
                  color: isPressed ? "grey-100" : "grey-60",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        quieter2: !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-10"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-5"
                      : undefined,
                  color: isPressed ? "grey-100" : "grey-50",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-on": !isDisabled
            ? {
                  backgroundColor: isPressed ? "grey-10" : "grey-5",
                  color: "grey-100",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-off": !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-10"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-5"
                      : undefined,
                  color: isPressed ? "grey-100" : "grey-50",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-above-grey-5-dark-background": !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? {light: "grey-10", dark: "grey-20"}
                      : isHoveredOrTriggeredOverlayOpen
                      ? {light: "grey-5", dark: "grey-10"}
                      : undefined,
                  color: "grey-100",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        neutral: !isDisabled
            ? {
                  backgroundColor: {light: "grey-80", dark: "grey-90"},
                  color: "grey-0",
              }
            : {
                  backgroundColor: "grey-5",
                  color: "grey-30",
              },
        accent: !isDisabled
            ? {
                  backgroundColor: "theme-40-const",
                  color: "grey-0-const",
              }
            : {
                  backgroundColor: "grey-5",
                  color: "grey-30",
              },
        // We have the accent styles even when the button is disabled. Disabling makes
        // the button not clickable or focusable but does not visually change the
        // button. Useful for buttons we really want to accent.
        "accent-even-when-disabled": {
            backgroundColor: "theme-40-const",
            color: "grey-0-const",
        },
        outline: !isDisabled
            ? {
                  backgroundColor: isPressed ? "grey-10" : undefined,
                  color: "grey-100",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
    };

    const isQuietVariant =
        variant === "quiet" ||
        variant === "quieter" ||
        variant === "quiet-on" ||
        variant === "quiet-off" ||
        variant === "quiet-above-grey-5-dark-background";

    const isOutlineVariant = variant === "outline";

    const willDarkenWithOverlayOnPress = !isQuietVariant && !isOutlineVariant;

    let node = (
        <FocusRing offset={isQuietVariant ? "0" : "0.5"}>
            {createElement(
                isFocusable ? "button" : "div",
                {
                    ...mergeProps(buttonProps, hoverProps),
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
                                    [onTriggeredOverlayOpenSymbol]: () =>
                                        setIsTriggeredOverlayOpen(true),
                                    [onTriggeredOverlayCloseSymbol]: () =>
                                        setIsTriggeredOverlayOpen(false),
                                });

                                localRef.current = actualElement;
                                assignRef(foreignRef, actualElement);
                            }
                        },
                        [foreignRef],
                    ),
                    className: sprinkles({
                        ...stylesByVariant[variant],

                        position: "relative",
                        overflow: "hidden",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        height,
                        minWidth: !withoutMinWidth && !isQuietVariant ? "16" : undefined,
                        width: fullWidth ? "full" : undefined,
                        paddingX,
                        fontSize,
                        borderLeftRadius: "base",
                        borderRightRadius,
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                        // If this button is in a `display: flex` element, don't shrink the button based
                        // on other contents.
                        flexShrink,
                    }),
                    style: {
                        // Use a box-shadow for drawing the border so it doesn't affect layout.
                        boxShadow: isOutlineVariant
                            ? `inset 0 0 0 1px ${
                                  colorSchemeVars[isPressed ? "grey-20" : "grey-10"]
                              }`
                            : undefined,
                    },
                    tabIndex: isFocusable ? (!isTabbable ? -1 : buttonProps.tabIndex) : undefined,
                    // Allow the button to maintain focus when pending. This way if a button is
                    // used in a `useConfirmSaveAfterLosingFocus()` hook (like comment inputs in
                    // `<DocumentContentEditor>`) and it enters a pending state we don't think the
                    // parent element has lost focus.
                    disabled:
                        isPending && !isDisabled
                            ? undefined
                            : (buttonProps as {disabled?: boolean}).disabled,
                },
                isPressed && willDarkenWithOverlayOnPress && (
                    // For accent buttons, instead of choosing a darker background color shade when
                    // pressed we add a black overlay at a lowered opacity. We accomplish this with
                    // an overlay element since such a color is not in our color scheme.
                    //
                    // Darker shades in our color scheme are more saturated. We want the effect of a
                    // button being physically pressed down.
                    //
                    // When we added this there was a happy accident. The text color also got
                    // darker! This is more fitting for the physical analogy of a button being
                    // pressed down.
                    <span
                        className={sprinkles({
                            position: "absolute",
                            inset: "0",
                            backgroundColor: "grey-100-const",
                            pointerEvents: "none",
                        })}
                        style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                    />
                ),
                shouldShowPendingSpinner && !iconChild && (
                    <SpinnerGap
                        className={classNames(
                            sprinkles({position: "absolute"}),
                            spinAnimationClassName,
                        )}
                        size={spacing["4"]}
                    />
                ),
                <span
                    className={sprinkles({
                        display: "flex",
                        alignItems: "center",
                        gap: iconGap,
                        maxWidth: "full",
                    })}
                    style={{
                        // Keep the icon and label in the DOM so we keep the shape of the button but
                        // hide them so we can show a spinner.
                        opacity: shouldShowPendingSpinner && !iconChild ? 0 : undefined,
                    }}
                >
                    {iconPlacement === "start" && iconChild}
                    {labelChild}
                    {iconPlacement === "end" && iconChild}
                </span>,
            )}
        </FocusRing>
    );

    if (keyboardShortcutHint) {
        node = (
            <Tooltip
                placement="bottom"
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

    return node;
}
