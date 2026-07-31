/**
 * Indent a block's continuation lines (everything after the first) by `width`
 * spaces, leaving blank lines blank so we never emit trailing whitespace. Used to
 * tuck a list item's body or a nested list under its marker.
 */
export function indentDocumentationMarkdownContinuationLines(text: string, width: number): string {
    const indent = " ".repeat(width);
    return text
        .split("\n")
        .map((line, index) => (index === 0 || line.length === 0 ? line : indent + line))
        .join("\n");
}
