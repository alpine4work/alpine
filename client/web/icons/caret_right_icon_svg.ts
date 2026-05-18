import escapeHtml from "escape-html";
import {CaretRight} from "phosphor-react";

// Hardcode Phosphor caret right icon SVG since we don't want to mount a
// React root when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're every refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
CaretRight;

export const caretRightIconSvg = ({className = ""}: {className?: string} = {}) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="${escapeHtml(
        className,
    )}" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="96 48 176 128 96 208" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
