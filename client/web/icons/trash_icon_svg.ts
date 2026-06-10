/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";
import {Trash} from "phosphor-react";
import {RemLength} from "~/shared/design/core/spacing.js";

// Hardcode Phosphor trash icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Trash;

export const trashIconSvg = ({
    size,
    className = "",
    style = "",
}: {
    className?: string;
    style?: string;
    size?: RemLength | `${number}em`;
} = {}) => {
    const classAttribute = className.length > 0 ? ` class="${escapeHtml(className)}"` : "";
    const styleAttribute =
        size !== undefined
            ? ` style="width: ${size}; height: ${size}${style.length > 0 ? `; ${escapeHtml(style)}"` : '"'}`
            : style.length > 0
              ? ` style="${escapeHtml(style)}"`
              : "";

    return `<svg xmlns="http://www.w3.org/2000/svg"${classAttribute} fill="currentColor" viewBox="0 0 256 256"${styleAttribute}><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>`;
};
