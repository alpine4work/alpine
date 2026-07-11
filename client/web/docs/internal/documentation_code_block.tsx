/* eslint-disable react-refresh/only-export-components -- co-located markdown variants (plain functions) live beside these components. */
import {Box} from "~/client/web/design/box.js";
import {DocumentationCopyButton} from "~/client/web/docs/internal/documentation_copy_button.js";
import {
    DocumentationCodeLanguage,
    highlightDocumentationCode,
} from "~/client/web/docs/internal/documentation_syntax_highlight.js";

/** Renders a fenced markdown code block with an optional language label. */
export function toDocumentationMarkdownCodeBlock(code: string, language?: string): string {
    const info = language !== undefined && language.length > 0 ? language : "";
    return `\`\`\`${info}\n${code.replace(/\n+$/, "")}\n\`\`\`\n\n`;
}

/**
 * A docs code block: hairline card with an optional header carrying a small
 * lowercase language label and a copy button, then the highlighted code.
 */
export function DocumentationCodeBlock({
    code,
    language = "text",
    label,
    copy = true,
}: {
    code: string;
    language?: DocumentationCodeLanguage;
    label?: string;
    copy?: boolean;
}) {
    const hasHeader = label !== undefined || copy;

    return (
        <Box border="grey-5" borderRadius="2" overflow="hidden" backgroundColor="grey-1">
            {hasHeader ? (
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    paddingY="1.5"
                    paddingLeft="3"
                    paddingRight="2"
                    borderBottom="grey-5"
                    backgroundColor="grey-0"
                >
                    <Box
                        as="span"
                        fontSize="50"
                        fontStyle="code"
                        color="grey-40"
                        style={{textTransform: "lowercase", letterSpacing: "0.02em"}}
                    >
                        {label ?? ""}
                    </Box>
                    {copy ? <DocumentationCopyButton text={code} /> : null}
                </Box>
            ) : null}
            <Box
                as="pre"
                // Code blocks scroll horizontally which our custom overlay scrollbar doesn't
                // support; use the native scrollbar.
                data-scrollbar="false"
                margin="0"
                padding="3"
                overflowX="auto"
                fontSize="75"
                fontStyle="code"
                color="grey-90"
                style={{lineHeight: 1.65}}
            >
                <code>{highlightDocumentationCode(code, language)}</code>
            </Box>
        </Box>
    );
}
