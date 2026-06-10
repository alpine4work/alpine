import escapeHtml from "escape-html";

export function lockBoldFillIconSvg({
    className = "",
    size,
    ariaLabel,
}: {
    className?: string;
    size?: string;
    ariaLabel?: string;
} = {}) {
    const classAttribute = className.length > 0 ? ` class="${escapeHtml(className)}"` : "";
    const styleAttribute = size !== undefined ? ` style="width: ${size}; height: ${size}"` : "";
    const ariaLabelAttribute =
        ariaLabel !== undefined ? ` role="img" aria-label="${escapeHtml(ariaLabel)}"` : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"${ariaLabelAttribute}${classAttribute} viewBox="0 0 256 256" fill="currentColor"${styleAttribute}><path d="M208,80h-32v-28c0-26.4673-21.5322-48-48-48s-48,21.5327-48,48v28h-32c-8.8365,0-16,7.1635-16,16v112c0,8.8365,7.1635,16,16,16h160c8.8365,0,16-7.1635,16-16v-112c0-8.8365-7.1635-16-16-16ZM128,168c-8.8365,0-16-7.1635-16-16s7.1635-16,16-16,16,7.1635,16,16-7.1635,16-16,16ZM152,80h-48v-28c0-13.2339,10.7661-24,24-24s24,10.7661,24,24v28Z"/></svg>`;
}
