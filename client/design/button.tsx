import {PressEvent} from "@react-types/shared";
import classNames from "classnames";
import {IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useEffect, useRef, useState} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useShowToast} from "~/client/design/toast";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {Spacing, spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {Sprinkles, spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant = "accent" | "quiet";

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
         * Are we waiting for some asynchronous action that was initiated by our button
         * to complete?
         *
         * If your `onPress` event returns a promise then the button is automatically
         * put into a pending state and you don't need to pass in this prop.
         */
        isPending?: boolean;

        /**
         * Give the button a 100% width so it fills all available space. Defaults
         * to false.
         */
        fullWidth?: boolean;

        /**
         * Should this button submit an HTML `<form>` element that it is inside? You
         * don't need a press event if true.
         */
        shouldSubmitForm?: boolean;

        /**
         * Control how much horizontal padding on this button. Default is `3`.
         */
        paddingX?: "2" | "3";
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        children,
        variant = "quiet",
        icon,
        iconPlacement = "start",
        isDisabled,
        isPending: isPendingFromProps,
        fullWidth = false,
        shouldSubmitForm = false,
        onPress,
        pressErrorTitle,
        paddingX = "3",
    } = props;
    const showToast = useShowToast();
    const localRef = useRef<HTMLButtonElement>(null);

    const [isPendingFromPress, setIsPendingFromPress] = useState(false);
    const isPending = isPendingFromProps || isPendingFromPress;

    const {buttonProps, isPressed} = useButton(
        {
            ...props,
            // Disable the button while we are pending to avoid multiple clicks firing the
            // action multiple times.
            isDisabled: isDisabled || isPending,
            type: shouldSubmitForm ? "submit" : undefined,
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
                // - Only close the menu if the action succeeds
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
            },
        },
        localRef,
    );

    const {hoverProps, isHovered} = useHover({});

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

    const labelChild = (
        <span className={sprinkles({display: "block", fontStyle: "truncate"})}>{children}</span>
    );

    const iconSize: Spacing = "3";

    const iconChild = icon ? (
        <IconContext.Provider
            value={{
                color: "currentColor",
                size: spacing[iconSize],
            }}
        >
            {icon}
        </IconContext.Provider>
    ) : null;

    const stylesByVariant: {[K in ButtonVariant]: Sprinkles} = {
        quiet: {
            backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
            color: "grey-text",
        },
        accent: {
            backgroundColor: "theme-40-const",
            color: "grey-0-const",
        },
    };

    return (
        <FocusRing offset={variant === "quiet" ? "0" : "0.5"}>
            <button
                {...mergeProps(buttonProps, hoverProps)}
                ref={useMergedRefs(foreignRef, localRef)}
                className={sprinkles({
                    ...stylesByVariant[variant],

                    // Override the styles in `stylesByVariant` but only if we are in one of
                    // these states.
                    ...(isDisabled
                        ? {
                              backgroundColor: variant !== "quiet" ? "grey-5" : undefined,
                              color: "grey-30",
                          }
                        : {}),

                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "7",
                    minWidth: variant !== "quiet" ? "16" : undefined,
                    width: fullWidth ? "full" : undefined,
                    paddingX,
                    fontSize: "75",
                    borderRadius: "base",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                    // If this button is in a `display: flex` element, don't shrink the button based
                    // on other contents.
                    flexShrink: "0",
                })}
            >
                {isPressed && variant !== "quiet" && (
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
                            backgroundColor: "grey-dark",
                            pointerEvents: "none",
                        })}
                        style={{opacity: 0.2}}
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
                    className={sprinkles({display: "flex", alignItems: "center", gap: "1"})}
                    style={{
                        // Keep the icon and label in the DOM so we keep the shape of the button but
                        // hide them so we can show a spinner.
                        opacity: shouldShowPendingSpinner && !iconChild ? 0 : undefined,
                    }}
                >
                    {iconPlacement === "start" &&
                        iconChild &&
                        (shouldShowPendingSpinner ? (
                            <SpinnerGap
                                className={spinAnimationClassName}
                                size={spacing[iconSize]}
                            />
                        ) : (
                            iconChild
                        ))}
                    {labelChild}
                    {iconPlacement === "end" &&
                        iconChild &&
                        (shouldShowPendingSpinner ? (
                            <SpinnerGap
                                className={spinAnimationClassName}
                                size={spacing[iconSize]}
                            />
                        ) : (
                            iconChild
                        ))}
                </span>
            </button>
        </FocusRing>
    );
}
