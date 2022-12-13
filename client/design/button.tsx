import {PressEvent} from "@react-types/shared";
import classNames from "classnames";
import {IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useEffect, useRef, useState} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {
    Sprinkles,
    spinAnimationClassName,
    sprinkles,
    truncateClassName,
} from "~/shared/styles/styles";

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant = "accent" | "quiet";

function Button(
    props: Omit<AriaButtonProps<"button">, "onPress"> & {
        /**
         * Label text for the button.
         */
        children: string;

        /**
         * When the user presses a button we fire this event. Use it to perform
         * an action in response to the button press.
         *
         * If a promise is returned then the button is put into a pending state until
         * the promise resolves.
         */
        onPress?: (event: PressEvent) => Promise<void> | void;

        /**
         * Which styles should we apply to the variant?
         */
        variant?: ButtonVariant;

        /**
         * An optional icon element rendered next to the button label.
         */
        icon?: ReactNode;

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
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        children,
        variant = "quiet",
        icon,
        isDisabled,
        isPending: isPendingFromProps,
        fullWidth = false,
        shouldSubmitForm = false,
        onPress,
    } = props;
    const localRef = useRef<HTMLButtonElement>(null);

    const [isPendingFromPress, setIsPendingFromPress] = useState(false);
    const isPending = isPendingFromProps || isPendingFromPress;

    const {buttonProps, isPressed} = useButton(
        {
            ...props,
            // Disable the button while we are pending to avoid multiple clicks firing the
            // action multiple times.
            isDisabled: isDisabled || isPending,
            onPress: event => {
                const promise = onPress?.(event);

                if (promise instanceof Promise) {
                    setIsPendingFromPress(true);
                    promise.finally(() => {
                        setIsPendingFromPress(false);
                    });
                }
            },
        },
        localRef,
    );

    const {hoverProps, isHovered} = useHover({});

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [shouldShowPendingSpinner, setShouldShowPendingSpinner] = useState(false);
    useEffect(() => {
        if (!isPending) {
            setShouldShowPendingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowPendingSpinner(true);
        }, uninterruptedThoughtLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isPending]);

    const labelChild = (
        <span className={classNames(sprinkles({display: "block"}), truncateClassName)}>
            {children}
        </span>
    );

    const iconChild = (
        <IconContext.Provider
            value={{
                color: "currentColor",
                size: spacing["4"],
            }}
        >
            {icon}
        </IconContext.Provider>
    );

    const stylesByVariant: {[K in ButtonVariant]: Sprinkles} = {
        // TODO(calebmer): I would like this button to have a little bit of
        // dimensionality. Work with someone who knows more about design to make
        // that happen.
        accent: {
            backgroundColor: "theme-40-const",
            color: "grey-0-const",
        },
        quiet: {
            backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
            color: "grey-100",
        },
    };

    return (
        <FocusRing offset={variant === "quiet" ? "0" : "0.5"}>
            <button
                {...mergeProps(buttonProps, hoverProps)}
                ref={useMergedRef(foreignRef, localRef)}
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
                    paddingX: "3",
                    fontSize: "small",
                    borderRadius: "base",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                    // If this button is in a `display: flex` element, don't shrink the button based
                    // on other contents.
                    flexShrink: "0",
                })}
                type={shouldSubmitForm ? "submit" : undefined}
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
                            inset: "0",
                            backgroundColor: "grey-100-const",
                        })}
                        style={{opacity: 0.2}}
                    />
                )}
                {shouldShowPendingSpinner && (
                    <SpinnerGap
                        className={classNames(
                            sprinkles({position: "absolute"}),
                            spinAnimationClassName,
                        )}
                        color="currentColor"
                        size={spacing["4"]}
                    />
                )}
                <span
                    className={sprinkles({display: "flex", gap: "1"})}
                    style={{
                        // Keep the icon and label in the DOM so we keep the shape of the button but
                        // hide them so we can show a spinner.
                        opacity: shouldShowPendingSpinner ? 0 : undefined,
                    }}
                >
                    {iconChild}
                    {labelChild}
                </span>
            </button>
        </FocusRing>
    );
}
