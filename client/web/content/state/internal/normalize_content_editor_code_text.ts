export type ContentEditorCodeTextReplacement = {
    from: number;
    to: number;
    text: string;
};

/**
 * Normalizes smart punctuation that we don't want inside code.
 */
export function normalizeContentEditorCodeText(
    text: string,
): Array<ContentEditorCodeTextReplacement> {
    const replacements: Array<ContentEditorCodeTextReplacement> = [];

    for (let index = 0; index < text.length; index++) {
        switch (text[index]) {
            case "\u201C":
            case "\u201D":
                // eslint-disable-next-line string-quotes
                replacements.push({from: index, to: index + 1, text: '"'});
                break;
            case "\u2018":
            case "\u2019":
                // eslint-disable-next-line string-quotes
                replacements.push({from: index, to: index + 1, text: "'"});
                break;
            case "\u2014":
                replacements.push({from: index, to: index + 1, text: "--"});
                break;
            case "\u2026":
                replacements.push({from: index, to: index + 1, text: "..."});
                break;
            case "\u2192":
                replacements.push({from: index, to: index + 1, text: "->"});
                break;
            case "\u2190":
                replacements.push({from: index, to: index + 1, text: "<-"});
                break;
            default:
                break;
        }
    }

    return replacements;
}
