import {PressEvent} from "@react-types/shared";
import {IconContext, SpinnerGap} from "phosphor-react";
import {
    ButtonHTMLAttributes,
    PointerEvent,
    ReactNode,
    Ref,
    forwardRef,
    useEffect,
    useRef,
    useState,
} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box.js";
import {buttonPressedOverlayOpacity} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useShowToast} from "~/client/design/toast.js";
import {Tooltip, defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Sprinkles, spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

type IconButtonVariant =
    | "accent"
    | "quiet"
    | "quiet-above-grey-5-background"
    | "quiet-above-grey-5-dark-background";

type IconButtonSize = "base" | "md" | "sm" | "xs";

/**
 * A button represented by a single icon.
 *
 * There's a lot that goes into building a great button component. See the
 * `react-aria` blog post on [press events][1].
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
         * A keyboard shortcut that will display alongside the description in the tooltip.
         */
        keyboardShortcutHint?: ReactNode;

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
         * The border radius of the icon button. Defaults to `full`.
         */
        borderRadius?: "full" | "sm";

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
         * Disable focusing this button through sequential keyboard navigation using
         * the `Tab` button. This sets `tabindex="-1"` on the element. The element will
         * still be programmatically focusable.
         */
        disableKeyboardFocus?: boolean;

        /**
         * Disable the `overflow="hidden"` style.
         */
        // NOTE(calebmer): Don't remember why I added `overflow="hidden"` in the first
        // place. At least this prop makes it explicit that the component expects
        // no overflow.
        disableOverflowHidden?: boolean;

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
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        description,
        keyboardShortcutHint,
        onPress,
        pressErrorTitle,
        variant = "quiet",
        size = "base",
        borderRadius = "full",
        children,
        isDisabled = false,
        withoutTooltip = false,
        tooltipPlacement = "bottom-start",
        tooltipOffset = defaultTooltipOffset,
        tooltipContentOverride,
        disableKeyboardFocus = false,
        disableOverflowHidden = false,
        onHoverStart,
        onHoverEnd,
        onPointerLeave,
    } = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const showToast = useShowToast();

    const [isPending, setIsPending] = useState(false);

    const {buttonProps, isPressed} = useButton(
        {
            ...props,
            isDisabled: isDisabled || isPending,
            "aria-label": description,
            onPress: event => {
                const defaultPressErrorTitle = "The button you pressed didn’t work";

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
                    setIsPending(true);

                    assert(
                        pressErrorTitle,
                        "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
                    );

                    promise.then(
                        () => {
                            setIsPending(false);
                        },
                        error => {
                            setIsPending(false);
                            showToast({
                                type: "Error",
                                title: pressErrorTitle,
                                error,
                            });
                        },
                    );
                }
            },
        },
        localRef,
    );
    const {hoverProps, isHovered} = useHover({onHoverStart, onHoverEnd});

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
                  backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                  color: isPressed ? "grey-text" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-above-grey-5-background": !isDisabled
            ? {
                  backgroundColor: isPressed ? "grey-20" : isHovered ? "grey-10" : undefined,
                  color: isPressed ? "grey-text" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-above-grey-5-dark-background": !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? {light: "grey-10", dark: "grey-20"}
                      : isHovered
                      ? {light: "grey-5", dark: "grey-10"}
                      : undefined,
                  color: isPressed ? "grey-90" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
    };

    const {buttonSize, iconSize} = (
        {
            base: {
                buttonSize: spacing["7"],
                iconSize: spacing["5"],
            },
            md: {
                buttonSize: spacing["6"],
                iconSize: spacing["4"],
            },
            sm: {
                buttonSize: spacing["5"],
                iconSize: spacing["4"],
            },
            xs: {
                buttonSize: spacing["4"],
                iconSize: spacing["3"],
            },
        } as const
    )[size];

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [_shouldShowPendingSpinner, setShouldShowPendingSpinner] = useState(false);
    useEffect(() => {
        if (!isPending) {
            setShouldShowPendingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowPendingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isPending]);

    // Only show the pending spinner if we are actually pending.
    const shouldShowPendingSpinner = _shouldShowPendingSpinner && isPending;

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
        >
            <FocusRing>
                <button
                    {...mergeProps(
                        buttonProps,
                        hoverProps,
                        // Only override `tabIndex` if `disableKeyboardFocus` is set. Otherwise let
                        // `react-aria` control `tabIndex`.
                        cast<ButtonHTMLAttributes<HTMLButtonElement>>(
                            disableKeyboardFocus ? {tabIndex: -1} : {},
                        ),
                        {onPointerLeave},
                    )}
                    ref={useMergedRefs(foreignRef, localRef)}
                    className={sprinkles({
                        flexShrink: "0",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        borderRadius,
                        overflow: !disableOverflowHidden ? "hidden" : undefined,
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                        position: "relative",
                        zIndex: "0",
                        ...stylesByVariant[variant],
                    })}
                    style={{
                        width: buttonSize,
                        height: buttonSize,
                    }}
                >
                    {isPressed && variant === "accent" && (
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
                                zIndex: "50",
                                inset: "0",
                                backgroundColor: "grey-dark",
                                pointerEvents: "none",
                                borderRadius: "full",
                            })}
                            style={{opacity: buttonPressedOverlayOpacity}}
                        />
                    )}
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: iconSize,
                        }}
                    >
                        {shouldShowPendingSpinner ? (
                            <SpinnerGap className={spinAnimationClassName} />
                        ) : (
                            children
                        )}
                    </IconContext.Provider>
                </button>
            </FocusRing>
        </Tooltip>
    );
}
