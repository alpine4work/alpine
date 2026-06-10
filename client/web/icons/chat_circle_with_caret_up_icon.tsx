import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// Combination of `<ChatCircle>` and `<CaretUp>` from Phosphor.
export function ChatCircleWithCaretUpIcon({
    color,
    size,
    style,
    caretStyle,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
    caretStyle?: CSSProperties;
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
            viewBox="0 0 32 32"
            stroke={color ?? contextColor}
            fill="none"
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
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.991 26.389a12 12 0 1 0-4.375-4.375l-1.563 4.669a1 1 0 0 0 1.264 1.265l4.674-1.56Z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m11 18 5-5 5 5"
                style={caretStyle}
            />
        </svg>
    );
}
