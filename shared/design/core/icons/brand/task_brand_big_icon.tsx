import {SVGAttributes} from "react";
import {spacing} from "~/shared/design/core/spacing.js";

export function TaskBrandBigIcon({
    size = spacing["12"],
    color,
    splashColorClassName,
}: {
    size?: React.CSSProperties["width"] & React.CSSProperties["height"];
    color?: SVGAttributes<SVGPathElement>["fill"];
    splashColorClassName?: SVGAttributes<SVGPathElement>["className"];
}) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 48 48"
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{width: size, height: size}}
        >
            <path
                className={splashColorClassName}
                d="M15 13.25h28v29a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4v-29Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M17.375 24c0-.345.28-.625.625-.625h12a.625.625 0 1 1 0 1.25H18a.625.625 0 0 1-.625-.625ZM17.375 30c0-.345.28-.625.625-.625h6a.625.625 0 1 1 0 1.25h-6a.625.625 0 0 1-.625-.625Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M8.375 7.5c0-.345.28-.625.625-.625h30c.345 0 .625.28.625.625v23a.625.625 0 1 1-1.25 0V8.125H9.625V37.5a3.875 3.875 0 0 0 3.875 3.875h14a.625.625 0 1 1 0 1.25h-14A5.125 5.125 0 0 1 8.375 37.5v-30Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M15 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM24 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM33 3.875c.345 0 .625.28.625.625v6a.625.625 0 1 1-1.25 0v-6c0-.345.28-.625.625-.625ZM45.942 31.558a.625.625 0 0 1 0 .884l-10.5 10.5a.625.625 0 0 1-.884 0l-4.5-4.5a.625.625 0 1 1 .884-.884L35 41.616l10.058-10.058a.625.625 0 0 1 .884 0Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
