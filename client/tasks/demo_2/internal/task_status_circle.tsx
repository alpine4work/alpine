import {Check} from "phosphor-react";
import {Box} from "~/client/design/box";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function TaskStatusCircle({
    status,
    size,
    isPressed,
}: {
    status: "Open" | "Closed" | "Active";
    size: "3" | "4" | "5" | "6";
    isPressed?: boolean;
}) {
    return (
        <Box
            className={sprinkles({
                position: "relative",
                zIndex: "0",
                width: size,
                height: size,
                borderRadius: "full",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                overflow: "hidden",
                border: status === "Open" || status === "Active" ? "grey-40" : undefined,
                backgroundColor:
                    status === "Closed" ? "theme-50-const" : isPressed ? "grey-10" : "grey-0",
            })}
        >
            {isPressed && status === "Closed" && (
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
                <Box
                    position="absolute"
                    zIndex="10"
                    inset="0"
                    backgroundColor="grey-dark"
                    pointerEvents="none"
                    style={{
                        opacity: buttonPressedOverlayOpacity,
                    }}
                />
            )}
            {status === "Closed" && (
                <Check
                    weight="bold"
                    size={addRemLengths(spacing["2"], spacing["0.5"])}
                    style={{transform: `scale(${parseInt(size, 10) / 4})`}}
                    color={colorSchemeVars["grey-0-const"]}
                />
            )}
            {status === "Active" && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    height={size}
                    overflow="hidden"
                    style={{
                        width: `${parseRemLengthNumber(spacing[size]) / 2}rem`,
                        transform: `translate(-1px, -1px) translateX(${
                            parseRemLengthNumber(spacing[size]) / 2
                        }rem) scale(${(16 - 5) / 16})`,
                        transformOrigin: "center left",
                    }}
                >
                    <Box
                        position="absolute"
                        top="0"
                        right="0"
                        width={size}
                        height={size}
                        borderRadius="full"
                        backgroundColor={{light: "theme-20-const", dark: "theme-30-const"}}
                    />
                    {isPressed && (
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
                        <Box
                            position="absolute"
                            zIndex="10"
                            top="0"
                            right="0"
                            width={size}
                            height={size}
                            borderRadius="full"
                            backgroundColor="grey-dark"
                            pointerEvents="none"
                            style={{
                                opacity: buttonPressedOverlayOpacity,
                            }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
}
