import {CSSProperties} from "react";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {backgroundColorVar, borderRadius, colorSchemeVars} from "~/client/styles/styles.js";
import {Spacing, convertRemLengthToPx} from "~/shared/design/core/spacing.js";

// IMPORTANT: If you update the HTML here you should also update
// `renderRemovedAccountAvatarHtml()` for code that needs to render avatars in
// `<ContentEditor>`.
export function RemovedAccountAvatar({
    children,
    size,
}: {
    children?: React.ReactNode;
    size: Spacing;
}) {
    const spacingScale = useSpacingScale();
    const avatarPx = convertRemLengthToPx(size, spacingScale);

    // Ghost cutout is 2/3 the size of the avatar, but it's places in the bottom right corner
    // of the image and the overflow is hidden.
    const ghostIconSize = avatarPx / 1.618033988749; // golden ratio
    const ghostIconStyleBase = {
        position: "absolute",
        width: ghostIconSize,
        height: ghostIconSize,
        // Position the SVG container just past the bounding box so that the ghost icon itself is
        // drawn almost exactly at the bottom right corner of the box. This looks correct at all
        // (tested) scales
        bottom: "-1px",
        right: "-1px",
    } as const;

    return (
        <>
            {children}
            <span
                style={{
                    position: "absolute",
                    overflow: "hidden",
                    width: avatarPx,
                    height: avatarPx,
                }}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 256 256"
                    style={{
                        borderRadius: borderRadius["full"],
                        position: "absolute",
                        overflow: "hidden",
                        width: avatarPx,
                        height: avatarPx,
                    }}
                >
                    <rect
                        x="0"
                        y="0"
                        width="100%"
                        height="100%"
                        fill={colorSchemeVars["grey-0"]}
                        opacity="0.6"
                        pointerEvents="none"
                    />
                </svg>
                <GhostIcon
                    color={backgroundColorVar}
                    style={{
                        ...ghostIconStyleBase,
                        overflow: "hidden",
                    }}
                    // The stroke width gets scaled according to the ghost icons size, so
                    // this hardcoded value looks good at all (tested) scales.
                    strokeWidth={132}
                />
            </span>
            {(() => {
                return (
                    <GhostIcon
                        color={colorSchemeVars["grey-60"]}
                        eyeColor={backgroundColorVar}
                        style={{...ghostIconStyleBase, overflow: "visible"}}
                        // The stroke width gets scaled according to the ghost icons size, so
                        // this hardcoded value looks good at all (tested) scales.
                        strokeWidth={24}
                    />
                );
            })()}
        </>
    );
}

function GhostIcon({
    color,
    eyeColor,
    style,
    strokeWidth,
}: {
    color: string;
    eyeColor?: string;
    style: CSSProperties;
    strokeWidth: number;
}) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="-144 -144 400 400" style={style}>
            <path
                fill={color}
                strokeOpacity={1}
                stroke={color}
                strokeWidth={strokeWidth}
                d="M216,216l-29.33-24-29.34,24L128,192,98.67,216,69.33,192,40,216V120a88,88,0,0,1,176,0Z"
            />
            <circle fill={eyeColor ?? "none"} cx="100" cy="116" r="16" />
            <circle fill={eyeColor ?? "none"} cx="156" cy="116" r="16" />
        </svg>
    );
}
