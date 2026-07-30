import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

/**
 * We use the CaretDownUpIcon for the "Collapse heading" heading context menu
 * action, it looks like:
 *
 * ```
 *  v
 *  ^
 * ```
 */
export function CaretDownUpIcon({
    color,
    size,
    style,
}: {
    color?: string;
    style?: CSSProperties;
    size?: string | number;
}) {
    const {
        color: contextColor,
        size: contextSize,
        weight,
        mirrored,
        ...context
    } = useContext(IconContext);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 256 256"
            {...context}
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <rect width="256" height="256" fill="none" />
            <polyline
                points="80 224 128 176 176 224"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="16"
            />
            <polyline
                points="80 32 128 80 176 32"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="16"
            />
        </svg>
    );
}
