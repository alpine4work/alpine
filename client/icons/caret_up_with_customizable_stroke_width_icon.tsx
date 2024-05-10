import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// The `<CaretUp>` Phosphor icon but allows us to customize the stroke width.
export function CaretUpWithCustomizableStrokeWidthIcon({
    color,
    size,
    style,
    strokeWidthScale = 1,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
    strokeWidthScale?: number;
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
            fill={color ?? contextColor}
            viewBox="0 0 256 256"
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <polyline
                points="48 160 128 80 208 160"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16 * strokeWidthScale}
            />
        </svg>
    );
}
