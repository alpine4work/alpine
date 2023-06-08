import {User} from "phosphor-react";
import {Box} from "~/client/design/box";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {spacing} from "~/shared/design/spacing";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

export function TaskNoAccountAvatar({size = "5"}: {size?: "3" | "5"}) {
    const radius = useSpacingPx(size) / 2;
    const strokeWidth = 1;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashes = 7;
    const gapRatio = 0.5;

    return (
        <Box flexShrink="0" position="relative" width={size} height={size} borderRadius="full">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                className={sprinkles({
                    width: size,
                    height: size,
                })}
                viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
            >
                <circle
                    cx={viewBoxSize / 2}
                    cy={viewBoxSize / 2}
                    r={radius}
                    fill="none"
                    stroke={inputPlaceholderStyles.color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${(circumference / dashes) * (1 - gapRatio)} ${
                        (circumference / dashes) * gapRatio
                    }`}
                />
            </svg>
            <Box
                position="absolute"
                inset="0"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <User
                    size={spacing["3"]}
                    color={inputPlaceholderStyles.color}
                    weight={parseInt(size, 10) < 5 ? "bold" : undefined}
                    style={{transform: `scale(${parseInt(size, 10) / 5})`}}
                />
            </Box>
        </Box>
    );
}
