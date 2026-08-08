import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

/**
 * We use the CaretUpDownIcon for the "Expand heading" heading context menu action,
 * it looks like:
 *
 * ```
 *  ^
 *  v
 * ```
 */
export function CaretUpDownIcon({
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
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being set to
            // rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <rect width="256" height="256" fill="none" />
            <polyline
                points="80 80 128 32 176 80"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="16"
            />
            <polyline
                points="80 176 128 224 176 176"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="16"
            />
        </svg>
    );
}
