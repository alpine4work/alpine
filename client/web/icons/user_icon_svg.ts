import escapeHtml from "escape-html";
import {User} from "phosphor-react";

// Hardcode Phosphor user icon SVG since we don't want to mount a React
// root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
User;

export const userIconSvg = ({
    weight = "regular",
    className = "",
    style = "",
}: {
    weight?: "bold" | "regular";
    className?: string;
    style?: string;
} = {}) =>
    weight === "bold"
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" style="${escapeHtml(style)}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="96" r="64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/><path d="M32,216c19.37-33.47,54.55-56,96-56s76.63,22.53,96,56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
              className,
          )}" style="${escapeHtml(style)}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="96" r="64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M32,216c19.37-33.47,54.55-56,96-56s76.63,22.53,96,56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
