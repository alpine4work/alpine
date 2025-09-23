import {SVGAttributes} from "react";
import {spacing} from "~/shared/design/core/spacing.js";

export function ChatBrandBigIcon({
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
                fillRule="evenodd"
                d="M24.377 37.494a11.944 11.944 0 0 1-6.595-1.729l-4.003 1.201a1 1 0 0 1-1.245-1.245l1.2-4.003A11.944 11.944 0 0 1 12 25.5c0-6.627 5.373-12 12-12 5.594 0 10.293 3.827 11.623 9.006.126-.004.251-.006.377-.006 6.627 0 12 5.373 12 12 0 2.276-.634 4.405-1.735 6.218l1.201 4.003a1 1 0 0 1-1.245 1.245l-4.003-1.2A11.944 11.944 0 0 1 36 46.5c-5.594 0-10.293-3.827-11.623-9.006Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M18.938 6.664A12.875 12.875 0 0 0 6.64 25.58a.625.625 0 0 1 .048.472L5.154 31.25a.877.877 0 0 0 .623 1.095.875.875 0 0 0 .463-.008l5.205-1.53a.625.625 0 0 1 .471.048 12.875 12.875 0 1 0 7.021-24.191ZM9.575 8.16a14.125 14.125 0 1 1 1.98 23.916l-4.962 1.459a2.124 2.124 0 0 1-2.638-2.638l1.464-4.957A14.125 14.125 0 0 1 9.575 8.16Z"
                clipRule="evenodd"
            />
            <path
                fill={color}
                fillRule="evenodd"
                d="M30.111 14.987a.625.625 0 0 1 .658-.59A14.124 14.124 0 0 1 42.574 34.94l1.459 4.963a2.126 2.126 0 0 1-2.638 2.638l-4.958-1.465a14.134 14.134 0 0 1-19.769-7.89.625.625 0 0 1 1.18-.415 12.885 12.885 0 0 0 18.229 7.083.625.625 0 0 1 .472-.048l5.198 1.535a.875.875 0 0 0 1.086-1.086l-1.53-5.205a.625.625 0 0 1 .049-.471 12.873 12.873 0 0 0-10.65-18.935.625.625 0 0 1-.59-.658Z"
                clipRule="evenodd"
            />
        </svg>
    );
}
