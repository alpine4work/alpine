import {IconContext} from "phosphor-react";
import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus-ring";
import {useMergedRef} from "~/client/design/helpers/use-merged-ref";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Disabled styles and other style variants

const IconButtonForwardRef = forwardRef(IconButton);
export {IconButtonForwardRef as IconButton};

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
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {description, children} = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({...props, "aria-label": description}, localRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <Tooltip placement="bottom-start" content={description}>
            <FocusRing>
                <button
                    {...mergeProps(buttonProps, hoverProps)}
                    ref={useMergedRef(foreignRef, localRef)}
                    className={sprinkles({
                        width: "7",
                        height: "7",
                        padding: "1",
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
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </button>
            </FocusRing>
        </Tooltip>
    );
}
