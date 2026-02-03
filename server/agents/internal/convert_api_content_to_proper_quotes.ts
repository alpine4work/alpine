import {visitAndProduceApiContent} from "~/server/agents/internal/visit_and_produce_api_content.js";
import {ApiContent} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Convert all straight quotes (`'` and `"`) into proper curly quotes
 * (`\u201C`, `\u201D`, `\u2018`, `\u2019`).
 */
export function convertApiContentToProperQuotes(content: ApiContent): ApiContent {
    return visitAndProduceApiContent(content, {
        visitInlineElement: (element, {elements, index: currentElementIndex}) => {
            if (element.type !== "Text") return;

            // Don't convert quotes in code to proper quotes.
            if (element.marks?.some(mark => mark.type === "Code")) return;

            let hasChanged = false;
            let text = element.text;

            for (const match of element.text.matchAll(/['"]/g)) {
                const index = match.index;
                const quoteChar = text[index];

                let charBefore: string | null = null;

                if (index - 1 >= 0) {
                    charBefore = text[index - 1]!;
                } else {
                    outer: for (
                        let elementIndex = currentElementIndex - 1;
                        elementIndex >= 0;
                        elementIndex--
                    ) {
                        const previousElement = elements[elementIndex]!;

                        switch (previousElement.type) {
                            case "Break": {
                                charBefore = "\n";
                                break outer;
                            }
                            case "Mention": {
                                charBefore = "]";
                                break outer;
                            }
                            case "Text": {
                                if (previousElement.text.length === 0) break;
                                charBefore = previousElement.text[previousElement.text.length - 1]!;
                                break outer;
                            }
                            default:
                                throw exhaustive(previousElement);
                        }
                    }
                }

                let properQuote: string;

                // eslint-disable-next-line cyberworlds/string-quotes
                if (quoteChar === '"') {
                    if (
                        charBefore === null ||
                        /(\p{White_Space}|["\u201C\u201D])/u.test(charBefore)
                    ) {
                        properQuote = "\u201C";
                    } else {
                        properQuote = "\u201D";
                    }
                } else {
                    if (
                        charBefore === null ||
                        /(\p{White_Space}|['\u2018\u2019])/u.test(charBefore)
                    ) {
                        properQuote = "\u2018";
                    } else {
                        properQuote = "\u2019";
                    }
                }

                hasChanged = true;
                text = text.slice(0, index) + properQuote + text.slice(index + 1);
            }

            if (hasChanged) {
                element.text = text;
            }
        },
    });
}
