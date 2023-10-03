import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {Plus, SpinnerGap} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {mergeProps, useHover, useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {buttonPressedOverlayOpacity} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

export function TaskCollectionsListBoxCreateCollectionOption<T>({
    comboBoxState,
    item,
    isQuiet,
    isPending,
}: {
    comboBoxState: ComboBoxState<T>;
    item: Node<T>;
    isQuiet: boolean;
    isPending: boolean;
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

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [shouldShowPendingSpinner, setShouldShowPendingSpinner] = useState(false);
    useEffect(() => {
        if (!isPending) {
            setShouldShowPendingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowPendingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isPending]);

    // Only show the pending spinner if we are actually pending.
    if (shouldShowPendingSpinner && !isPending) setShouldShowPendingSpinner(false);

    // We expect the rendered item to be a simple string since we want to render
    // our own text that includes the `inputValue`. If the `inputValue` was in
    // `item.rendered` it would only change if the underlying item changes.
    assert(item.rendered === "Create collection");

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
                {shouldShowPendingSpinner ? (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                ) : (
                    <Plus
                        size={spacing["3"]}
                        weight={!isQuiet ? "bold" : undefined}
                        className={sprinkles({flexShrink: "0"})}
                    />
                )}
                <Box fontStyle={!isQuiet ? "truncate-semi-bold" : "truncate"}>
                    {comboBoxState.inputValue.length > 0
                        ? `Create collection “${comboBoxState.inputValue}”`
                        : "Create collection"}
                </Box>
            </Box>
        </FocusRing>
    );
}
