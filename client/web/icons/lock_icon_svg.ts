import escapeHtml from "escape-html";
import {Lock} from "phosphor-react";

// Hardcode Phosphor lock icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Lock;

export const lockIconSvg = ({
    className = "",
    weight = "regular",
    size,
}: {
    className?: string;
    weight?: "bold" | "regular";
    size?: `${number}em`;
} = {}) => {
    const classAttribute = className.length > 0 ? ` class="${escapeHtml(className)}"` : "";
    const styleAttribute = size !== undefined ? ` style="width: ${size}; height: ${size}"` : "";

    if (weight === "bold") {
        return `<svg xmlns="http://www.w3.org/2000/svg"${classAttribute} viewBox="0 0 256 256"${styleAttribute}><rect width="256" height="256" fill="none"/><rect x="40" y="88" width="176" height="128" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/><circle cx="128" cy="152" r="16"/><path d="M88,88V56a40,40,0,0,1,80,0V88" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/></svg>`;
    } else {
        return `<svg xmlns="http://www.w3.org/2000/svg"${classAttribute} viewBox="0 0 256 256"${styleAttribute}><rect width="256" height="256" fill="none"/><rect x="40" y="88" width="176" height="128" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="128" cy="152" r="12" fill="currentColor"/><path d="M88,88V56a40,40,0,0,1,80,0V88" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
    }
};
