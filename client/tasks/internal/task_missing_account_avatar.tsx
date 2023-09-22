import {User} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px.js";
import {spacing} from "~/shared/design/spacing.js";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles.js";

export function TaskMissingAccountAvatar({size = "5"}: {size?: "3" | "4" | "5"}) {
    return (
        <Box flexShrink="0" position="relative" width={size} height={size} borderRadius="full">
            <TaskMissingAccountAvatarDashedCircle size={size} />
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

export function TaskMissingAccountAvatarDashedCircle({size}: {size: "3" | "4" | "5"}) {
    const radius = useSpacingPx(size) / 2;
    const strokeWidth = 1;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashes = 7;
    const gapRatio = 0.5;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={sprinkles({
                display: "block",
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
    );
}
