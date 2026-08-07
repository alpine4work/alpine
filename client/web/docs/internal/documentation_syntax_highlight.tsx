import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {ColorSchemeVar} from "~/client/web/styles/styles.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export type DocumentationCodeLanguage = "json" | "bash" | "js" | "text";

/**
 * A deliberately tiny regex highlighter for the handful of languages that appear
 * in the docs (sample requests and responses). Not a real tokenizer.
 */
export function highlightDocumentationCode(
    code: string,
    language: DocumentationCodeLanguage,
): ReactNode {
    switch (language) {
        case "json":
            return highlightWithPattern(
                code,
                /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\B-?\d+\.?\d*\b|\b\d+\.?\d*\b)|(\btrue\b|\bfalse\b|\bnull\b)/g,
                match => {
                    if (match[1] !== undefined) return "theme-60";
                    if (match[2] !== undefined) return "green-70";
                    if (match[3] !== undefined) return "purple-70";
                    return "orange-70";
                },
            );
        case "bash":
            return highlightWithPattern(
                code,
                /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(^curl\b|\\\n\s*curl\b)|(\s-[A-Za-z]\b)/gm,
                match => {
                    if (match[1] !== undefined) return "green-70";
                    if (match[2] !== undefined) return "purple-70";
                    return "theme-60";
                },
            );
        case "js":
            return highlightWithPattern(
                code,
                /(\b(?:const|await|async|new|return|import|from)\b)|("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*)/g,
                match => {
                    if (match[1] !== undefined) return "orange-70";
                    if (match[2] !== undefined) return "green-70";
                    return "grey-40";
                },
            );
        case "text":
            return code;
        default:
            throw exhaustive(language);
    }
}

function highlightWithPattern(
    code: string,
    pattern: RegExp,
    getColor: (match: RegExpExecArray) => ColorSchemeVar,
): ReactNode {
    const parts: Array<ReactNode> = [];
    let lastIndex = 0;
    let key = 0;

    for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
        if (match.index > lastIndex) parts.push(code.slice(lastIndex, match.index));
        parts.push(
            <Box as="span" key={key++} color={getColor(match)}>
                {match[0]}
            </Box>,
        );
        lastIndex = pattern.lastIndex;
    }

    parts.push(code.slice(lastIndex));
    return parts;
}
