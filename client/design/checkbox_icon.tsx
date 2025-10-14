import {Check} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {buttonStyles, colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";

export function CheckboxIcon({
    isChecked,
    isPressed = false,
}: {
    isChecked: boolean;
    isPressed?: boolean;
}) {
    return (
        <Box
            flexShrink="0"
            overflow="hidden"
            position="relative"
            width="3"
            height="3"
            border={!isChecked ? "grey-20" : undefined}
            borderRadius="0.5"
            backgroundColor={!isChecked ? (isPressed ? "grey-10" : "grey-0") : "grey-90"}
            display="flex"
            justifyContent="center"
            alignItems="center"
        >
            {isChecked && (
                <Check color={colorSchemeVars["grey-0"]} weight="bold" size={spacing["2.5"]} />
            )}
            {isChecked && isPressed && (
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
        </Box>
    );
}
