import {PressEvent} from "@react-types/shared";
import {IconContext, SpinnerGap} from "phosphor-react";
import {
    KeyboardEvent,
    PointerEvent,
    ReactNode,
    Ref,
    RefObject,
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
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {
    subscribeToTriggeredOverlayCloseEvent,
    subscribeToTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip, TooltipRef, defaultTooltipOffset} from "~/client/web/design/tooltip.js";
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

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

export type IconButtonVariant =
    | "accent"
    | "quiet"
    | "quiet-above-grey-5-background"
    | "quiet-above-content-file-viewer-modal"
    | "quiet-elevation-10"
    | "quiet-elevation-20"
    | "quiet-darken"
    | "neutral"
    | "outline"
    | "image";

export type IconButtonSize = "xl" | "lg" | "base" | "md" | "sm" | "xs";

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
 * While icon buttons without a label may look nice, they can confuse users! You
 * should only use icon buttons when they're not confusing or if using an icon
 * button without a label is for some reason very convenient for the end user (e.g.
 * it fits nicely in some space).
 *
 * [1]: https://react-spectrum.adobe.com/blog/building-a-button-part-1.html
 */
function IconButton(
    props: Omit<AriaButtonProps<"button">, "onPress"> & {
        /**
         * A description of the action the icon button will take when pressed. Appears as a
         * tooltip on hover and in the `aria-label`.
         */
        description: string;

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
        variant?: IconButtonVariant;

        /**
         * The size of the icon button.
         */
        size?: IconButtonSize;

        /**
         * A keyboard shortcut that will display alongside the description in the tooltip.
         */
        keyboardShortcutHint?: ReactNode;

        /**
         * Are we waiting for some asynchronous action that was initiated by our button to
         * complete?
         *
         * If your `onPress` event returns a promise then the button is automatically put
         * into a pending state and you don't need to pass in this prop.
         */
        isPending?: boolean;

        /**
         * Never show loading indicator even if `isPending` is true. Useful if when
         * `isPending` is set to true, some other loading indicator is visible.
         */
        withoutLoadingIndicator?: boolean;

        /**
         * Don't focus the button when it's pressed. By default, this is true if
         * `isFocusable` is false.
         */
        withoutFocusOnPress?: boolean;

        /**
         * Should we show the pressed style even if the button isn't currently pressed?
         * Useful if there's some secondary press target for this icon button.
         */
        isPressed?: boolean;

        /**
         * Should we show the hovered style even if the button isn't currently hovered?
         * Useful if there's some secondary hover target for this icon button.
         */
        isHovered?: boolean;

        /**
         * The border radius of the icon button. Defaults to `full`.
         */
        borderRadius?: "full" | "0.5" | "1" | "none";

        /**
         * Manually override the button's background color.
         */
        backgroundColor?: Sprinkles["backgroundColor"];

        /**
         * Allow changing the button cursor. You should have a good reason to change this.
         * See "[Buttons shouldn't have a hand cursor][1]".
         *
         * [1]:
         *     https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
         */
        cursor?: "default" | "pointer";

        /**
         * Don't show a tooltip when hovering over this icon button.
         *
         * Defaults to `false`.
         */
        withoutTooltip?: boolean;

        /**
         * Reference to the button's tooltip.
         */
        tooltipRef?: RefObject<TooltipRef | null>;

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
         * Override the icon button's tooltip content. By default we use the `description`.
         * Optionally including a `keyboardShortcutHint`.
         */
        tooltipContentOverride?: ReactNode;

        /**
         * Is the tooltip visible when our `<IconButton>` is focused?
         *
         * Defaults to `true`.
         */
        isTooltipVisibleWhenFocused?: boolean;

        /**
         * Is the tooltip visible after our `<IconButton>` is pressed?
         *
         * Defaults to `false`.
         */
        isTooltipVisibleAfterPress?: boolean;

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
                  // You could call `click()` but that focuses the button which you might not want.
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
        keyboardShortcutHint,
        isPending: isPendingFromProps,
        withoutLoadingIndicator = false,
        withoutFocusOnPress = false,
        isPressed: isPressedFromProps = false,
        isHovered: isHoveredFromProps = false,
        borderRadius = "full",
        backgroundColor: backgroundColorFromProps,
        cursor = "default",
        children,
        isDisabled = false,
        withoutTooltip = false,
        tooltipRef,
        tooltipPlacement = "bottom-start",
        tooltipOffset = defaultTooltipOffset,
        tooltipContentOverride,
        isTooltipVisibleWhenFocused = true,
        isTooltipVisibleAfterPress = false,
        isTabbable = true,
        isFocusable = true,
        onHoverStart,
        onHoverEnd,
        onPointerLeave,
        onKeyDownCapture,
    } = props;
    const localRef = useRef<HTMLElement | null>(null);
    const platform = usePlatform();
    const reporter = useReporter();

    const [isPendingFromPress, setIsPendingFromPress] = useState(false);
    const isPending = isPendingFromProps || isPendingFromPress;

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
            "aria-label": description,
            onPress: handlePress,
            // We don't focus on press on mobile since if you press down a button the user
            // might be scrolling! So if the keyboard is open we don't want to close the
            // keyboard since the button is focused.
            //
            // @ts-expect-error: This prop exists but is undocumented
            // https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/button/src/useButton.ts#L57-L58
            preventFocusOnPress: withoutFocusOnPress || platform === "mobile" || !isFocusable,
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

    const isHoveredOrTriggeredOverlayOpen = isHovered || isTriggeredOverlayOpen;

    let styles: Sprinkles;
    let isQuietVariant = false;

    switch (variant) {
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
        case "quiet": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? "grey-10-translucent"
                          : isHoveredOrTriggeredOverlayOpen
                            ? "grey-5-translucent"
                            : undefined,
                      color: isPressed ? "grey-100" : "grey-70",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        case "quiet-above-grey-5-background": {
            isQuietVariant = true;

            styles = !isDisabled
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
                  };
            break;
        }
        // Variant for a quiet icon button specifically over our `<ContentFileViewerModal>`
        // component which has hand picked dark grey background color for both light and
        // dark mode.
        case "quiet-above-content-file-viewer-modal": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed
                          ? {light: "grey-40-const", dark: "grey-60-const"}
                          : isHoveredOrTriggeredOverlayOpen
                            ? {light: "grey-50-const", dark: "grey-70-const"}
                            : undefined,
                      color: isPressed ? "grey-0-const" : "grey-10-const",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30-const",
                  };
            break;
        }
        case "quiet-elevation-10": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed ? "grey-5" : "grey-0",
                      color: isPressed ? "grey-80" : "grey-70",
                      boxShadow: "elevation-10",
                  }
                : {
                      backgroundColor: "grey-0",
                      color: "grey-30",
                      boxShadow: "elevation-10",
                  };
            break;
        }
        case "quiet-elevation-20": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: isPressed ? "grey-5" : "grey-0",
                      color: isPressed ? "grey-80" : "grey-70",
                      boxShadow: "elevation-20",
                  }
                : {
                      backgroundColor: "grey-0",
                      color: "grey-30",
                      boxShadow: "elevation-20",
                  };
            break;
        }
        case "quiet-darken": {
            isQuietVariant = true;

            styles = !isDisabled
                ? {
                      backgroundColor: undefined,
                      color: "grey-70",
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
        case "image": {
            styles = !isDisabled
                ? {
                      backgroundColor: undefined,
                      color: "grey-70",
                  }
                : {
                      backgroundColor: undefined,
                      color: "grey-30",
                  };
            break;
        }
        default:
            throw exhaustive(variant);
    }

    let buttonSize: Spacing;
    let iconSize: Spacing;

    switch (size) {
        case "xl":
            buttonSize = "10";
            iconSize = "5";
            break;
        case "lg":
            buttonSize = "8";
            iconSize = "5";
            break;
        case "base":
            buttonSize = "7";
            iconSize = "5";
            break;
        case "md":
            buttonSize = "6";
            iconSize = "4";
            break;
        case "sm":
            buttonSize = "5";
            iconSize = "4";
            break;
        case "xs":
            buttonSize = "5";
            iconSize = "3";
            break;
        default:
            throw exhaustive(size);
    }

    const touchSlop = useTouchSlop(buttonSize);

    // We wait a bit before showing our pending spinner. Some actions are very fast so
    // we delay showing a spinner to avoid a loading spinner flicker which can be
    // jarring.
    const shouldShowPendingSpinner =
        useDelayLoadingIndicator(isPending) && !withoutLoadingIndicator;

    const isOutlineVariant = variant === "outline";
    const isBold = variant === "neutral" && !isDisabled;

    const willDarkenWithOverlayOnPress =
        (!isQuietVariant && !isOutlineVariant) || variant === "quiet-darken";

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

    return (
        <Tooltip
            ref={tooltipRef}
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
            isVisibleAfterPress={isTooltipVisibleAfterPress}
        >
            <FocusRing
                offset={isQuietVariant ? "0" : "0.5"}
                // Make sure the `<FocusRing>` doesn't render around the touch slop area. Just the
                // button area.
                inset={touchSlop.slop}
            >
                {createElement(
                    isFocusable ? "button" : "div",
                    // eslint-disable-next-line react-compiler/react-compiler
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
                            // If this button is in a `display: flex` element, don't shrink the button based on
                            // other contents.
                            flexShrink: "0",
                        }),
                        tabIndex: isFocusable
                            ? !isTabbable
                                ? -1
                                : buttonProps.tabIndex
                            : undefined,
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
                            cursor,
                            position: "relative",
                            zIndex: "0",
                            ...styles,
                            backgroundColor: backgroundColorFromProps ?? styles.backgroundColor,
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
                                weight: isBold ? "bold" : "regular",
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
