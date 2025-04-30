import escapeHtml from "escape-html";
import {Check} from "phosphor-react";

// Hardcode Phosphor check icon SVG since we don't want to mount a React root
// for every checkbox. And since we need to generate HTML without React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
Check;

export const checkIconSvg = ({
    weight = "regular",
    className = "",
    style,
}: {
    weight?: "regular" | "bold";
    className?: string;
    style?: string;
} = {}) =>
    weight === "bold"
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(className)}"${
              style !== undefined ? ` style="${escapeHtml(style)}"` : ""
          } viewBox="0 0 256 256"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"></path></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(className)}"${
              style !== undefined ? ` style="${escapeHtml(style)}"` : ""
          } viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="216 72 104 184 48 128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/></svg>`;
