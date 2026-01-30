import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {Plus, SpinnerGap} from "phosphor-react";
import {useRef, useState} from "react";
import {useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {buttonStyles, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function TaskCollectionComboBoxCreateCollectionOption<T>({
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
    const optionRef = useRef<HTMLLIElement>(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // By default `@react-aria/listbox` allows you to press on the combobox trigger
            // then drag up and release to select an item. This is not a common interaction
            // and not something we want to support (our `<MenuButton>` doesn't support
            // this). Furthermore, on mobile it means if you press an option in a combobox
            // then scroll and release that option will be selected! Instead the scroll
            // should cancel the press. We really want to disable that behavior since it
            // feels broken.
            disallowsDifferentPressOrigin: true,
        },
        comboBoxState,
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    // We expect the rendered item to be a simple string since we want to render
    // our own text that includes the `inputValue`. If the `inputValue` was in
    // `item.rendered` it would only change if the underlying item changes.
    assert(item.rendered === "Create collection");

    return (
        <FocusRing
            offset={isQuiet ? "inset" : "0.5"}
            isVisible={isFocused && wasFocusVisibleWhenFocused}
        >
            <Box
                {...optionProps}
                ref={optionRef}
                width="full"
                padding="1.5"
                borderRadius="1"
                color={isQuiet ? "grey-100" : "grey-0"}
                backgroundColor={
                    isQuiet
                        ? isPressed
                            ? {light: "grey-10", dark: "grey-20"}
                            : isHovered
                              ? {light: "grey-5", dark: "grey-10"}
                              : undefined
                        : "grey-90"
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
                            backgroundColor: "grey-100-const",
                            pointerEvents: "none",
                        })}
                        style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
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
                        ? `Create collection \u201C${comboBoxState.inputValue}\u201D`
                        : "Create collection"}
                </Box>
            </Box>
        </FocusRing>
    );
}
