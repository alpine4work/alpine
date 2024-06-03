import {PressEvent} from "@react-types/shared";
import {IconContext, SpinnerGap} from "phosphor-react";
import {
    KeyboardEvent,
    PointerEvent,
    ReactNode,
    Ref,
    createElement,
    forwardRef,
    useCallback,
    useRef,
    useState,
} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {
    onTriggeredOverlayCloseSymbol,
    onTriggeredOverlayOpenSymbol,
} from "~/client/design/overlay_trigger_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {Tooltip, defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useTouchSlop} from "~/client/design/use_touch_slop.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/helpers/refs/assign_ref.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    Sprinkles,
    buttonStyles,
    colorSchemeVars,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

export type IconButtonVariant =
    | "accent"
    | "quiet"
    | "quiet-above-grey-5-background"
    | "quiet-above-grey-5-dark-background"
    | "outline";

export type IconButtonSize = "lg" | "base" | "md" | "sm" | "xs";

/**
 * A button represented by a single icon.
 *
 * There's a lot that goes into building a great button component. See the
 * `react-aria` blog post on [press events][1].
 *
 * Design guideline: Don't use icon buttons unless the action is:
 *
 * 1. Brutally obvious; OR
 * 2. Incredibly common
 *
 * While icon buttons without a label may look nice, they can confuse users!
 * You should only use icon buttons when they're not confusing or if using an
 * icon button without a label is for some reason very convenient for the end
 * user (e.g. it fits nicely in some space).
 *
 * [1]: https://react-spectrum.adobe.com/blog/building-a-button-part-1.html
 */
function IconButton(
    props: Omit<AriaButtonProps<"button">, "onPress"> & {
        /**
         * A description of the action the icon button will take when pressed.
         * Appears as a tooltip on hover and in the `aria-label`.
         */
        description: string;

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
        variant?: IconButtonVariant;

        /**
         * The size of the icon button.
         */
        size?: IconButtonSize;

        /**
         * Forces touch slop even for small button sizes. By default, larger
         * button sizes like `base` get touch slop but smaller buttons like `xs` don't
         * get touch slop. Since generally if you're using an `xs` button there are
         * multiple small buttons next to each other and touch slop would leave you
         * with conflicting touch areas.
         *
         * However, if for design reasons you have one lone `xs` button on mobile you
         * should give it touch slop.
         *
         * If set to false, `base` buttons will still get touch slop.
         */
        withTouchSlop?: boolean;

        /**
         * A keyboard shortcut that will display alongside the description in the tooltip.
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
         * Should we show the pressed style even if the button isn't currently pressed?
         * Useful if there's some secondary press target for this icon button.
         */
        isPressed?: boolean;

        /**
         * The border radius of the icon button. Defaults to `full`.
         */
        borderRadius?: "full" | "sm";

        /**
         * Manually override the button's background color.
         */
        backgroundColor?: Sprinkles["backgroundColor"];

        /**
         * Don't show a tooltip when hovering over this icon button.
         *
         * Defaults to `false`.
         */
        withoutTooltip?: boolean;

        /**
         * Where to place the tooltip?
         *
         * Defaults to `bottom-start`.
         */
        tooltipPlacement?: OverlayPlacement;

        /**
         * How far to offset the tooltip?
         *
         * Defaults to `1.5`.
         */
        tooltipOffset?: Spacing;

        /**
         * Override the icon button's tooltip content. By default we use
         * the `description`. Optionally including a `keyboardShortcutHint`.
         */
        tooltipContentOverride?: ReactNode;

        /**
         * Is the tooltip visible when our `<IconButton>` is focused?
         *
         * Defaults to `true`.
         */
        isTooltipVisibleWhenFocused?: boolean;

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

        /**
         * Called when we start hovering the button.
         */
        onHoverStart?: () => void;

        /**
         * Called when we stop hovering the button.
         */
        onHoverEnd?: () => void;

        /**
         * Called when the pointer leaves the button. Corresponds to the
         * [`pointerleave`][1] event.
         *
         * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerleave_event
         */
        onPointerLeave?: (event: PointerEvent) => void;

        /**
         * `keydown` event fired during the capture phase.
         */
        onKeyDownCapture?: (event: KeyboardEvent) => void;
    },
    foreignRef:
        | Ref<
              HTMLElement & {
                  // We add a `press()` function to our `HTMLButtonElement` so you can externally
                  // call the button's press handler to properly handle loading states and error
                  // states.
                  //
                  // You could call `click()` but that focuses the button which you might not
                  // want.
                  press(): void;
              }
          >
        | Ref<HTMLElement>,
) {
    const {
        description,
        onPress,
        pressErrorTitle,
        variant = "quiet",
        size = "base",
        withTouchSlop = false,
        keyboardShortcutHint,
        isPending: isPendingFromProps,
        withoutLoadingIndicator = false,
        isPressed: isPressedFromProps,
        borderRadius = "full",
        backgroundColor: backgroundColorFromProps,
        children,
        isDisabled = false,
        withoutTooltip = false,
        tooltipPlacement = "bottom-start",
        tooltipOffset = defaultTooltipOffset,
        tooltipContentOverride,
        isTooltipVisibleWhenFocused = true,
        isTabbable = true,
        isFocusable = true,
        onHoverStart,
        onHoverEnd,
        onPointerLeave,
        onKeyDownCapture,
    } = props;
    const localRef = useRef<HTMLElement | null>(null);
    const showToast = useShowToast();

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

    const {buttonProps, isPressed: isPressedFromButton} = useButton(
        {
            ...props,
            elementType: isFocusable ? "button" : "div",
            isDisabled: isDisabled || isPending,
            "aria-label": description,
            onPress: handlePress,
        },
        localRef,
    );

    const isPressed = isPressedFromButton || isPressedFromProps;

    const {hoverProps, isHovered} = useHover({
        onHoverStart,
        onHoverEnd,
    });

    // If we are rendered inside an `<OverlayTriggerButton>` we want to apply our
    // hover styles even though we aren't receiving pointer events since there's a
    // cover over the DOM.
    const [isTriggeredOverlayOpen, setIsTriggeredOverlayOpen] = useState(false);

    const isHoveredOrTriggeredOverlayOpen = isHovered || isTriggeredOverlayOpen;

    const stylesByVariant: {[K in IconButtonVariant]: Sprinkles} = {
        accent: !isDisabled
            ? {
                  backgroundColor: "theme-40-const",
                  color: "grey-0-const",
              }
            : {
                  backgroundColor: "grey-5",
                  color: "grey-30",
              },
        quiet: !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-10"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-5"
                      : undefined,
                  color: isPressed ? "grey-100" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-above-grey-5-background": !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? "grey-20"
                      : isHoveredOrTriggeredOverlayOpen
                      ? "grey-10"
                      : undefined,
                  color: isPressed ? "grey-100" : "grey-70",
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
                  color: isPressed ? "grey-90" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
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

    const {buttonSize, iconSize, withoutTouchSlop} = (
        {
            lg: {buttonSize: "8", iconSize: "5", withoutTouchSlop: false},
            base: {buttonSize: "7", iconSize: "5", withoutTouchSlop: false},
            md: {buttonSize: "6", iconSize: "4", withoutTouchSlop: false},
            sm: {buttonSize: "5", iconSize: "4", withoutTouchSlop: true},
            xs: {buttonSize: "4", iconSize: "3", withoutTouchSlop: true},
        } as const
    )[size];

    const defaultTouchSlop = useTouchSlop(buttonSize);
    const touchSlop =
        withTouchSlop || !withoutTouchSlop
            ? defaultTouchSlop
            : ({slop: "0", sizeWithSlop: buttonSize} as const);

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const shouldShowPendingSpinner =
        useDelayLoadingIndicator(isPending) && !withoutLoadingIndicator;

    const isQuietVariant =
        variant === "quiet" ||
        variant === "quiet-above-grey-5-background" ||
        variant === "quiet-above-grey-5-dark-background";

    const isOutlineVariant = variant === "outline";

    const willDarkenWithOverlayOnPress = !isQuietVariant && !isOutlineVariant;

    return (
        <Tooltip
            placement={tooltipPlacement}
            offset={tooltipOffset}
            content={
                tooltipContentOverride ??
                (keyboardShortcutHint ? (
                    <Box display="flex" alignItems="center" gap="1">
                        <Box>{description}</Box>
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
                    </Box>
                ) : (
                    description
                ))
            }
            isDisabled={isDisabled || withoutTooltip || isPending}
            isVisibleWhenFocused={isTooltipVisibleWhenFocused}
        >
            <FocusRing offset={isQuietVariant ? "0" : "0.5"}>
                {createElement(
                    isFocusable ? "button" : "div",
                    {
                        ...mergeProps(buttonProps, hoverProps, {onPointerLeave, onKeyDownCapture}),
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
                            display: "flex",
                            width: touchSlop.sizeWithSlop,
                            height: touchSlop.sizeWithSlop,
                            padding: touchSlop.slop,
                            margin: `-${touchSlop.slop}`,
                            borderRadius,
                            // If this button is in a `display: flex` element, don't shrink the button based
                            // on other contents.
                            flexShrink: "0",
                        }),
                        tabIndex: isFocusable
                            ? !isTabbable
                                ? -1
                                : buttonProps.tabIndex
                            : undefined,
                        // Allow the button to maintain focus when pending. This way if a button is
                        // used in a `useConfirmSaveAfterLosingFocus()` hook (like comment inputs in
                        // `<DocumentContentEditor>`) and it enters a pending state we don't think the
                        // parent element has lost focus.
                        disabled:
                            isPending && !isDisabled
                                ? undefined
                                : (buttonProps as {disabled?: boolean}).disabled,
                    },
                    <span
                        className={sprinkles({
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            width: buttonSize,
                            height: buttonSize,
                            borderRadius,
                            // You may notice our button doesn't have a pointer cursor. See:
                            // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                            cursor: "default",
                            position: "relative",
                            zIndex: "0",
                            ...stylesByVariant[variant],
                            backgroundColor:
                                backgroundColorFromProps ??
                                stylesByVariant[variant].backgroundColor,
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
                                    display: "block",
                                    position: "absolute",
                                    zIndex: "50",
                                    inset: "0",
                                    backgroundColor: "grey-100-const",
                                    pointerEvents: "none",
                                    borderRadius,
                                })}
                                style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                            />
                        )}
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing[iconSize],
                            }}
                        >
                            {shouldShowPendingSpinner ? (
                                <SpinnerGap className={spinAnimationClassName} />
                            ) : (
                                children
                            )}
                        </IconContext.Provider>
                    </span>,
                )}
            </FocusRing>
        </Tooltip>
    );
}
