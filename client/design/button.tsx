import classNames from "classnames";
import {IconContext} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {spacing} from "~/shared/design/spacing";
import {Sprinkles, sprinkles, truncateClassName} from "~/shared/styles/styles";

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant = "accent" | "quiet";

function Button(
    props: AriaButtonProps<"button"> & {
        /**
         * Label text for the button.
         */
        children: string;

        /**
         * What variant of this button should we render?
         */
        variant?: ButtonVariant;

        /**
         * An optional icon element rendered next to the button label.
         */
        icon?: ReactNode;

        /**
         * Give the button a 100% width so it fills all available space. Defaults
         * to false.
         */
        fullWidth?: boolean;

        /**
         * Should this button submit an HTML `<form>` element that it is inside? You
         * don't need a press event if true.
         */
        formSubmit?: boolean;
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        children,
        variant = "quiet",
        icon,
        fullWidth = false,
        formSubmit = false,
        isDisabled,
    } = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({...props}, localRef);
    const {hoverProps, isHovered} = useHover({});

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
        <FocusRing>
            <button
                {...mergeProps(buttonProps, hoverProps)}
                ref={useMergedRef(foreignRef, localRef)}
                className={sprinkles({
                    ...stylesByVariant[variant],
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
                    minWidth: "16",
                    width: fullWidth ? "full" : undefined,
                    paddingX: "3",
                    typographySize: "small",
                    borderRadius: "base",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                    // If this button is in a `display: flex` element, don't shrink the button based
                    // on other contents.
                    flexShrink: "0",
                })}
                type={formSubmit ? "submit" : undefined}
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
                {!iconChild ? (
                    labelChild
                ) : (
                    <span className={sprinkles({display: "flex", gap: "1"})}>
                        {iconChild}
                        {labelChild}
                    </span>
                )}
            </button>
        </FocusRing>
    );
}
