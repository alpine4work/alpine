import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// NOTE(calebmer): This icon was derived from Phosphor's `<TextIndent>` icon and
// inspired by the design of [Font Awesome's `block-quote` icon][1].
//
// [1]: https://fontawesome.com/icons/block-quote?s=solid
export function QuoteBlockIcon({
    color,
    size,
    style,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
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
            fill={color ?? contextColor}
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
                fill="currentColor"
                d="M28 15a1 1 0 0 0-1-1H11a1 1 0 1 0 0 2h16a1 1 0 0 0 1-1Zm-17 7h16a1 1 0 1 1 0 2H11a1 1 0 0 1 0-2ZM27 8H5a1 1 0 0 1 0-2h22a1 1 0 1 1 0 2ZM4.293 14.293A1 1 0 0 1 6 15v8a1 1 0 1 1-2 0v-8a1 1 0 0 1 .293-.707Z"
            />
        </svg>
    );
}
