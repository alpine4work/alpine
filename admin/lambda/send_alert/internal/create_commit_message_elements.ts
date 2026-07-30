import {ApiContentCodeBlockElementTextInlineElement} from "~/shared/api/specification/types/api_specification_convenience_types.js";

/**
 * Converts a GitHub commit message into inline content elements.
 *
 * Pull request references in the form `(#123)` are turned into Graphite links for
 * the repository that produced the alert.
 */
export function createCommitMessageElements(
    commitMessage: string,
    repositoryFullName: string,
): Array<ApiContentCodeBlockElementTextInlineElement> {
    const elements: Array<ApiContentCodeBlockElementTextInlineElement> = [];

    const prRegex = /\(#(\d+)\)/g;
    let lastIndex = 0;
    let match;

    while ((match = prRegex.exec(commitMessage)) !== null) {
        if (match.index > lastIndex) {
            elements.push({
                type: "Text",
                text: commitMessage.substring(lastIndex, match.index),
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

    if (lastIndex < commitMessage.length) {
        elements.push({
            type: "Text",
            text: commitMessage.substring(lastIndex),
        });
    }

    if (elements.length === 0) {
        elements.push({
            type: "Text",
            text: commitMessage,
        });
    }

    return elements;
}
