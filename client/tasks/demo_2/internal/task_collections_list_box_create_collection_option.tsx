import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {Plus} from "phosphor-react";
import {useRef, useState} from "react";
import {mergeProps, useHover, useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {Box} from "~/client/design/box";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {spacing} from "~/shared/design/spacing";
import {sprinkles} from "~/shared/styles/styles";

export function TaskCollectionsListBoxCreateCollectionOption<T>({
    comboBoxState,
    item,
    isQuiet,
}: {
    comboBoxState: ComboBoxState<T>;
    item: Node<T>;
    isQuiet: boolean;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    return (
        <FocusRing
            offset={isQuiet ? "0" : "0.5"}
            isVisible={isFocused && wasFocusVisibleWhenFocused}
        >
            <Box
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                width="full"
                padding="1.5"
                borderRadius="base"
                color={isQuiet ? "grey-text" : "grey-0"}
                backgroundColor={
                    isQuiet
                        ? isPressed
                            ? {light: "grey-10", dark: "grey-20"}
                            : isHovered
                            ? {light: "grey-5", dark: "grey-10"}
                            : undefined
                        : {light: "grey-80", dark: "grey-90"}
                }
                display="flex"
                justifyContent="center"
                alignItems="center"
                gap="1"
                position="relative"
            >
                {isPressed && !isQuiet && (
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
                        style={{opacity: buttonPressedOverlayOpacity}}
                    />
                )}
                <Plus
                    size={spacing["3"]}
                    weight={!isQuiet ? "bold" : undefined}
                    className={sprinkles({flexShrink: "0"})}
                />
                <Box fontStyle={!isQuiet ? "truncate-semi-bold" : "truncate"}>{item.rendered}</Box>
            </Box>
        </FocusRing>
    );
}
