import {ApiContentParagraphBlockElement} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

/**
 * Converts a GitHub commit message into inline content elements.
 *
 * Pull request references in the form `(#123)` are turned into Graphite links for
 * the repository that produced the alert.
 */
export function createCommitMessageElements(
    commitMessage: string,
    repositoryFullName: string,
): Array<ApiContentParagraphBlockElement["elements"][number]> {
    const elements: Array<ApiContentParagraphBlockElement["elements"][number]> = [];

    const prRegex = /\(#(\d+)\)/g;
    const lines = commitMessage.split(/\r\n|\r|\n/);

    for (const [lineIndex, line] of lines.entries()) {
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = prRegex.exec(line)) !== null) {
            if (match.index > lastIndex) {
                elements.push({
                    type: "Text",
                    text: line.substring(lastIndex, match.index),
                });
            }

            const prNumber = match[1];
            elements.push({
                type: "Text",
                text: `(#${prNumber})`,
                marks: [
                    {
                        type: "Link",
                        url: `https://app.graphite.com/github/pr/${repositoryFullName}/${prNumber}`,
                    },
                ],
            });

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < line.length) {
            elements.push({
                type: "Text",
                text: line.substring(lastIndex),
            });
        }

        if (lineIndex < lines.length - 1) {
            elements.push({type: "Break"});
        }
    }

    return elements;
}
