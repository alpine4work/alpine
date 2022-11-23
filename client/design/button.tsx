import classNames from "classnames";
import {IconContext} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {spacing} from "~/shared/design/spacing";
import {Sprinkles, sprinkles, truncateClassName} from "~/shared/styles/styles";

// TODO(calebmer): Disabled styles and other style variants

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

type ButtonVariant = "primary" | "quiet";

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
         * Should the icon be rendered before the label (`leading`) or after the label
         * (`trailing`)? Defaults to before the label (`leading`).
         */
        iconPosition?: "leading" | "trailing";

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
        variant = "primary",
        icon,
        iconPosition = "leading",
        fullWidth = false,
        formSubmit = false,
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
        primary: {
            backgroundColor: isPressed ? "theme-60-const" : "theme-40-const",
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
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "7",
                    width: fullWidth ? "full" : undefined,
                    paddingX: "3",
                    typographySize: "small",
                    borderRadius: "base",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                })}
                type={formSubmit ? "submit" : undefined}
            >
                {!iconChild ? (
                    labelChild
                ) : (
                    <span className={sprinkles({display: "flex", gap: "1"})}>
                        {iconChild && iconPosition === "leading" && iconChild}
                        {labelChild}
                        {iconChild && iconPosition === "trailing" && iconChild}
                    </span>
                )}
            </button>
        </FocusRing>
    );
}
