import {PressEvent} from "@react-types/shared";
import {IconContext} from "phosphor-react";
import {Ref, forwardRef, useRef} from "react";
import {AriaButtonProps, mergeProps, useButton, useHover} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring";
import {OverlayPlacement} from "~/client/design/overlay";
import {useShowToast} from "~/client/design/toast";
import {Tooltip} from "~/client/design/tooltip";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
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
         * When the user presses a button we fire this event. Use it to perform
         * an action in response to the button press.
         */
        onPress?: (event: PressEvent) => void;

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

        /**
         * Where to place the tooltip?
         *
         * Defaults to `bottom-start`.
         */
        tooltipPlacement?: OverlayPlacement;
    },
    foreignRef: Ref<HTMLButtonElement>,
) {
    const {
        description,
        onPress,
        variant = "quiet",
        size = "base",
        children,
        isDisabled = false,
        withoutTooltip = false,
        tooltipPlacement = "bottom-start",
    } = props;
    const localRef = useRef<HTMLButtonElement>(null);
    const showToast = useShowToast();

    const {buttonProps, isPressed} = useButton(
        {
            ...props,
            "aria-label": description,
            onPress: event => {
                const defaultPressErrorTitle = "The button you pressed didn’t work";

                try {
                    onPress?.(event);
                } catch (error) {
                    showToast({
                        type: "Error",
                        title: defaultPressErrorTitle,
                        error,
                    });
                    return;
                }
            },
        },
        localRef,
    );
    const {hoverProps, isHovered} = useHover({});

    const stylesByVariant: {[K in IconButtonVariant]: Sprinkles} = {
        accent: !isDisabled
            ? {
                  backgroundColor: "theme-40-const",
                  color: "grey-0-const",
              }
            : {
                  backgroundColor: "grey-5",
                  color: "grey-30",
              },
        quiet: !isDisabled
            ? {
                  backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                  color: isPressed ? "grey-90" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
        "quiet-on-grey-5-dark-background": !isDisabled
            ? {
                  backgroundColor: isPressed
                      ? {light: "grey-10", dark: "grey-20"}
                      : isHovered
                      ? {light: "grey-5", dark: "grey-10"}
                      : undefined,
                  color: isPressed ? "grey-90" : "grey-70",
              }
            : {
                  backgroundColor: undefined,
                  color: "grey-30",
              },
    };

    const {buttonSize, iconSize} = (
        {
            base: {
                buttonSize: "7",
                iconSize: "5",
            },
            sm: {
                buttonSize: "5",
                iconSize: "4",
            },
            xs: {
                buttonSize: "4",
                iconSize: "3",
            },
        } as const
    )[size];

    return (
        <Tooltip
            placement={tooltipPlacement}
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
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        borderRadius: "full",
                        overflow: "hidden",
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                        position: "relative",
                        ...stylesByVariant[variant],
                    })}
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
                                backgroundColor: "grey-dark",
                                pointerEvents: "none",
                            })}
                            style={{opacity: 0.2}}
                        />
                    )}
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
