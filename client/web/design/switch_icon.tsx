import {Box} from "~/client/web/design/box.js";
import {accentThemeBackgroundColor} from "~/client/web/styles/styles.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";

export function SwitchIcon({
    size = "3",
    isSelected,
    isPressed = false,
}: {
    size?: "3" | "4";
    isSelected: boolean;
    isPressed?: boolean;
}) {
    const width = ({"3": "5", "4": "7"} as const)[size];
    const iconPressedWidth = `${parseRemLength(size) + parseRemLength("1") * 0.75}rem`;

    return (
        <Box
            position="relative"
            zIndex="0"
            width={width}
            height={size}
            backgroundColor={isSelected ? accentThemeBackgroundColor : "grey-10"}
            borderRadius="full"
            overflow="hidden"
            style={{
                transition: "background-color 50ms linear",
            }}
        >
            <Box
                position="absolute"
                backgroundColor="grey-0-const"
                borderRadius="full"
                boxShadow="elevation-5-without-border"
                style={{
                    top: "2px",
                    left: "0px",
                    transform: `translateX(${
                        isSelected
                            ? isPressed
                                ? `calc(${spacing[width]} - ${iconPressedWidth} + 2px)`
                                : `calc(${spacing[width]} - ${spacing[size]} + 2px)`
                            : "2px"
                    })`,
                    width: isPressed
                        ? `calc(${iconPressedWidth} - 4px)`
                        : `calc(${spacing[size]} - 4px)`,
                    height: `calc(${spacing[size]} - 4px)`,
                    transition: "width 50ms linear, transform 50ms linear",
                }}
            />
        </Box>
    );
}
