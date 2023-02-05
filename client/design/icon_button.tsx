import {IconContext} from "phosphor-react";
import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRefs} from "~/client/design/helpers/use_merged_refs";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";
import {Sprinkles, sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Disabled styles and other style variants

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

type IconButtonVariant = "accent" | "quiet" | "quiet-on-grey-5-dark-background";

type IconButtonSize = "base" | "sm" | "xs";

/**
 * A button represented by a single icon.
 *
 * There's a lot that goes into building a great button component. See the
 * `react-aria` blog post on [press events][1].
 *
 * [1]: https://react-spectrum.adobe.com/blog/building-a-button-part-1.html
 */
function IconButton(
    props: AriaButtonProps<"button"> & {
        /**
         * A description of the action the icon button will take when pressed.
         * Appears as a tooltip on hover and in the `aria-label`.
         */
        description: string;

        /**
         * Which styles should we apply to the variant?
         */
        variant?: IconButtonVariant;

        /**
         * The size of the icon button.
         */
        size?: IconButtonSize;

        /**
         * Don't show a tooltip when hovering over this icon button.
         *
         * Defaults to `false`.
         */
        withoutTooltip?: boolean;
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        description,
        variant = "quiet",
        size = "base",
        children,
        isDisabled = false,
        withoutTooltip = false,
    } = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({...props, "aria-label": description}, localRef);
    const {hoverProps, isHovered} = useHover({});

    const stylesByVariant: {[K in IconButtonVariant]: Sprinkles} = {
        accent: {
            backgroundColor: "theme-40-const",
            color: "grey-0-const",
        },
        quiet: {
            backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
            color: isPressed ? "grey-90" : "grey-70",
        },
        "quiet-on-grey-5-dark-background": {
            backgroundColor: isPressed
                ? {light: "grey-10", dark: "grey-20"}
                : isHovered
                ? {light: "grey-5", dark: "grey-10"}
                : undefined,
            color: isPressed ? "grey-90" : "grey-70",
        },
    };

    const {buttonSize, buttonPadding, iconSize} = (
        {
            base: {
                buttonSize: "7",
                buttonPadding: "1",
                iconSize: "5",
            },
            sm: {
                buttonSize: "5",
                buttonPadding: "0.5",
                iconSize: "4",
            },
            xs: {
                buttonSize: "4",
                buttonPadding: "0.5",
                iconSize: "3",
            },
        } as const
    )[size];

    return (
        <Tooltip
            placement="bottom-start"
            content={description}
            isDisabled={isDisabled || withoutTooltip}
        >
            <FocusRing>
                <button
                    {...mergeProps(buttonProps, hoverProps)}
                    ref={useMergedRefs(foreignRef, localRef)}
                    className={sprinkles({
                        width: buttonSize,
                        height: buttonSize,
                        padding: buttonPadding,
                        borderRadius: "full",
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                        ...stylesByVariant[variant],
                    })}
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing[iconSize],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </button>
            </FocusRing>
        </Tooltip>
    );
}
