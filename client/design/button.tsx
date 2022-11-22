import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Disabled styles and other style variants

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
        <FocusRing>
            <button
                {...mergeProps(buttonProps, hoverProps)}
                ref={useMergedRef(foreignRef, localRef)}
                className={sprinkles({
                    height: "7",
                    paddingX: "3",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                    borderRadius: "base",
                    color: "grey-100",
                    typographySize: "small",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                })}
            >
                {children}
            </button>
        </FocusRing>
    );
}
