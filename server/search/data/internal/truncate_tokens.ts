import {LanguageModelBase} from "~/server/search/data/internal/language_model_base.js";

/**
 * Truncate some text to the specified number of tokens. If the text was truncated
 * we include `…` at the end to signal truncation.
 */
export function truncateTokens(model: LanguageModelBase, text: string, tokenCount: number): string {
    // If we split between spaces, each part is one or more tokens. So slicing down
    // to `tokenCount` parts is an optimization that leaves us with the biggest
    // possible substring that fits in `tokenCount` tokens.
    const originalTextParts = text.split(/\s+/g);
    const textParts = originalTextParts.slice(0, tokenCount);
    let truncatedText: string;

    // Remove one word at a time until we're under our `tokenCount`. Given we
    // expect `tokenCount` to generally be small (<100) we're ok with this
    // iterative algorithm.
    //
    // If this turns out to be slow we could implement a binary search style
    // algorithm (remove `tokenCount / 2` words, is that less or more tokens
    // than `tokenCount`? remove `tokenCount / 4` words, is that less or more
    // tokens than `tokenCount`? etc.) or use a statistical approach (e.g. using
    // knowledge about the average tokens per English character).
    while (true) {
        truncatedText =
            textParts.join(" ") + (originalTextParts.length > textParts.length ? "…" : "");

        if (model.countTokens(truncatedText) <= tokenCount) {
            break;
        }

        textParts.pop();
    }

    return truncatedText;
}
