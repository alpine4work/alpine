import {IconContext} from "phosphor-react";
import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Disabled styles and other style variants

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

type IconButtonSize = "base" | "small";

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
         * The size of the icon button.
         */
        size?: IconButtonSize;
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {description, size = "base", children} = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({...props, "aria-label": description}, localRef);
    const {hoverProps, isHovered} = useHover({});

    const {buttonSize, buttonPadding, iconSize, tooltipOffset} = (
        {
            base: {
                buttonSize: "7",
                buttonPadding: "1",
                iconSize: "5",
                tooltipOffset: "2",
            },
            small: {
                buttonSize: "4",
                buttonPadding: "0.5",
                iconSize: "3",
                tooltipOffset: "1",
            },
        } as const
    )[size];

    return (
        <Tooltip placement="bottom-start" offset={tooltipOffset} content={description}>
            <FocusRing>
                <button
                    {...mergeProps(buttonProps, hoverProps)}
                    ref={useMergedRef(foreignRef, localRef)}
                    className={sprinkles({
                        width: buttonSize,
                        height: buttonSize,
                        padding: buttonPadding,
                        backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                        borderRadius: "full",
                        color: isPressed ? "grey-90" : "grey-70",
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
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
