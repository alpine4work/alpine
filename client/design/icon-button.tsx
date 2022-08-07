import {IconContext} from "phosphor-react";
import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {useMergedRef} from "~/client/design/helpers/use-merged-ref";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Tooltip} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";

// TODO(calebmer): Disabled styles

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
        </Tooltip>
    );
}
