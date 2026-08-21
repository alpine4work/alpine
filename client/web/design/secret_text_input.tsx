import {Eye, EyeSlash} from "phosphor-react";
import {Ref, forwardRef, useId, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {TextInputProps, TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {textInputHeightSpacingForFontSize} from "~/client/web/design/text_input_height_spacing_for_font_size.js";
import {pointerEventsNoneNotInheritedClassName, sprinkles} from "~/client/web/styles/styles.js";

export type SecretTextInputProps = Omit<TextInputProps, "inputMode" | "paddingRight"> & {
    /**
     * When true and the input is disabled, render a masked placeholder instead of the
     * actual value. Useful when the caller has a secret value but must not display it
     * (e.g. a non-admin viewing bot settings).
     */
    isValueHiddenWhenDisabled?: boolean;

    /**
     * Length of the masked placeholder when `isValueHiddenWhenDisabled` is true.
     * Defaults to 16.
     */
    hiddenValuePlaceholderLength?: number;
};

/**
 * Single-line text input for secret values with a reveal/hide control.
 */
export const SecretTextInput = forwardRef(function SecretTextInput(
    props: SecretTextInputProps,
    ref: Ref<HTMLInputElement>,
) {
    const {label} = props;

    const id = useId();

    return (
        <Box>
            <label
                className={sprinkles({
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "truncate-semi-bold",
                    paddingBottom: "1.5",
                })}
                htmlFor={id}
            >
                {label}
            </label>
            <SecretTextInputWithoutLabel {...props} ref={ref} id={id} />
        </Box>
    );
});

export type SecretTextInputWithoutLabelProps = Omit<SecretTextInputProps, "label"> &
    // You must provide one of these props for accessibility! Or use
    // `<SecretTextInput>` that comes with an accessible label.
    (| {id: string; "aria-label"?: undefined; "aria-labelledby"?: undefined}
        | {"aria-label": string; id?: undefined; "aria-labelledby"?: undefined}
        | {"aria-labelledby": string; id?: undefined; "aria-label"?: undefined}
    );

/**
 * Single-line text input for secret values with a reveal/hide control and no
 * label.
 */
export const SecretTextInputWithoutLabel = forwardRef(function SecretTextInputWithoutLabel(
    {
        value,
        isDisabled = false,
        isValueHiddenWhenDisabled = false,
        hiddenValuePlaceholderLength = 16,
        fontSize = "75",
        ...props
    }: SecretTextInputWithoutLabelProps,
    ref: Ref<HTMLInputElement>,
) {
    const [isRevealed, setIsRevealed] = useState(false);
    if (isRevealed && isDisabled) setIsRevealed(false);

    const displayValue =
        isDisabled && isValueHiddenWhenDisabled ? "x".repeat(hiddenValuePlaceholderLength) : value;

    const isRevealButtonVisible = displayValue.length > 0 && !isDisabled;

    // The space reserved for the eye icon is square, so we can use the height spacing
    // for the width
    const revealButtonContainerWidth = textInputHeightSpacingForFontSize(fontSize);

    return (
        <Box position="relative" width="full">
            <TextInputWithoutLabel
                {...props}
                ref={ref}
                fontSize={fontSize}
                value={displayValue}
                isDisabled={isDisabled}
                // Make sure the secret content doesn't overlap with the reveal icon button.
                paddingRight={isRevealButtonVisible ? revealButtonContainerWidth : undefined}
                inputMode={isRevealed ? "text" : "password"}
            />
            {isRevealButtonVisible && (
                <Box
                    // The icon button `borderRadius` corners when clicked should fallthrough to the
                    // input.
                    className={pointerEventsNoneNotInheritedClassName}
                    position="absolute"
                    right="0"
                    top="0"
                    bottom="0"
                    width={revealButtonContainerWidth}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                >
                    <IconButton
                        description={isRevealed ? "Hide" : "Reveal"}
                        // Avoid perfect alignment with bottom of the text input.
                        tooltipOffset="1"
                        size={fontSize === "75" ? "sm" : "md"}
                        onPress={() => setIsRevealed(!isRevealed)}
                    >
                        {isRevealed ? <EyeSlash /> : <Eye />}
                    </IconButton>
                </Box>
            )}
        </Box>
    );
});
