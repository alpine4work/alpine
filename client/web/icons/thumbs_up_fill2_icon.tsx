import {IconContext} from "phosphor-react";
import {CSSProperties, useContext} from "react";

// This is a different variation of the `<ThumbsUp weight="fill">` icon from
// Phosphor. We want our filled thumbs up icon to look just like the Facebook like
// button. The Phosphor icon's sleeve isn't filled even in the fill weight so we
// created our own variant.
export function ThumbsUpFill2Icon({
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
            viewBox="0 0 256 256"
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
            <path d="M55.056 96H32c-8.837 0-16 7.163-16 16v88c0 8.837 7.163 16 16 16h23.056a4 4 0 0 0 4-4V100a4 4 0 0 0-4-4ZM213.96 72H160V56c0-22.056-17.944-40-40-40a8 8 0 0 0-7.155 4.422L75.478 95.155a4 4 0 0 0-.422 1.79V212a4 4 0 0 0 4 4h122.882c12.008-.056 22.198-9.083 23.7-21.008L237.63 99.06c.141-1.06.212-2.144.209-3.219-.032-13.159-10.747-23.84-23.879-23.84Z" />
        </svg>
    );
}
