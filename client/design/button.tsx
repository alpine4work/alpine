import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {useMergedRef} from "~/client/design/helpers/use-merged-ref";
import {sprinkles} from "~/client/design/sprinkles.css";

// TODO(calebmer): Disabled styles

// TODO(calebmer): Other style variants

const ButtonForwardRef = forwardRef(Button);
export {ButtonForwardRef as Button};

function Button(
    props: AriaButtonProps<"button"> & {
        children: string;
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {children} = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({...props}, localRef);
    const {hoverProps, isHovered} = useHover({});

    return (
        <button
            {...mergeProps(buttonProps, hoverProps)}
            ref={useMergedRef(foreignRef, localRef)}
            className={sprinkles({
                height: "7",
                paddingX: "2",
                backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                borderRadius: "base",
                color: "grey-100",
                font: "sm",
            })}
        >
            {children}
        </button>
    );
}
