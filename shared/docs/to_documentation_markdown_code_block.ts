/** Renders a fenced markdown code block with an optional language label. */
export function toDocumentationMarkdownCodeBlock(code: string, language?: string): string {
    const info = language !== undefined && language.length > 0 ? language : "";
    return `\`\`\`${info}\n${code.replace(/\n+$/, "")}\n\`\`\`\n\n`;
}
