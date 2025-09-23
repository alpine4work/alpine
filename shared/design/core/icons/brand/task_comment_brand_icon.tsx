import {SVGAttributes} from "react";

export function TaskCommentBrandIcon({
    size,
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
            viewBox="0 0 20 20"
            style={{width: size, height: size}}
        >
            <path
                className={splashColorClassName}
                d="M6.25 5.52h11.667v12.084c0 .92-.747 1.667-1.667 1.667H7.917c-.92 0-1.667-.746-1.667-1.667V5.521Z"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M3.125 3.125c0-.345.28-.625.625-.625h12.5c.345 0 .625.28.625.625V5.5a.625.625 0 1 1-1.25 0V3.75H4.375v11.875c0 .332.132.65.366.884a.625.625 0 0 1-.884.884 2.5 2.5 0 0 1-.732-1.768v-12.5Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M6.25 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM10 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM13.75 1.25c.345 0 .625.28.625.625v2.5a.625.625 0 1 1-1.25 0v-2.5c0-.345.28-.625.625-.625ZM9.02 8.143a6.125 6.125 0 1 1 .915 10.296l-1.884.628a1.083 1.083 0 0 1-1.37-1.37l.63-1.882a6.125 6.125 0 0 1 1.708-7.672Zm4.048-.008a4.875 4.875 0 0 0-4.537 7.307c.09.155.109.341.052.511l-.61 1.823 1.825-.609a.625.625 0 0 1 .51.052 4.875 4.875 0 1 0 2.76-9.084Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
