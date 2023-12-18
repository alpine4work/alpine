import {Mark, Node} from "prosemirror-model";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
} from "~/shared/content/content_type_names.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Match different new-line formats. [Same newline regex that's in
 * `compromise`][1].
 *
 * [1]: https://github.com/spencermountain/compromise/blob/cb5068d01e4a2002e5baabd2e332e0f077a5997f/src/1-one/tokenize/methods/01-sentences/01-simple-split.js#L5
 */
const newLineRegExp = /(?:(?:\r?\n|\r)+)/g;

/**
 * Takes some content and prints it as a single line plain text snippet. This
 * plain text preview is used for inbox entry content previews and search
 * result content previews.
 *
 * `getContentSnippet()` can be used to extract some piece of content and this
 * function can be used for printing that content to a plain text preview.
 */
export function printContentSingleLineTextSnippet(content: ContentWithReferences): string {
    const segments = printContentSingleLineTextSnippetWithHighlighting(content, () => false);

    if (segments.length === 0) return "";
    if (segments.length === 1) return segments[0]!.text;

    let text = "";

    for (const segment of segments) {
        text += segment.text;
    }

    return text;
}

/**
 * Same as `printContentSingleLineTextSnippet()` (see the documentation on that
 * function) but we preserve the styling for marks where
 * `shouldHighlightMark()` returns true. Used for showing search result content
 * previews since we need to highlight matched words.
 */
export function printContentSingleLineTextSnippetWithHighlighting(
    content: ContentWithReferences,
    shouldHighlightMark: (mark: Mark) => boolean,
): Array<{isHighlighted: boolean; text: string}> {
    const segments: Array<{isHighlighted: boolean; text: string}> = [];
    let breakPunctuation: string | null = null;
    let isHighlighted = false;
    const orderListItemNumberByNode = new Map<Node, number>();

    const print = (text: string) => {
        // Break punctuation is used to separate content which otherwise would have
        // rendered on separate lines. For example, we put a period after a heading
        // then print the paragraph which follows.
        if (breakPunctuation !== null) {
            const lastSegment = segments[segments.length - 1];

            if (lastSegment) {
                const actuallyIsHighlighted = isHighlighted;

                isHighlighted = lastSegment.isHighlighted && isHighlighted;

                if (
                    /(?:\p{Sentence_Terminal}|\p{Terminal_Punctuation})\s*$/u.test(lastSegment.text)
                ) {
                    actuallyPrint(" ");
                } else {
                    actuallyPrint(`${breakPunctuation} `);
                }

                isHighlighted = actuallyIsHighlighted;
            }

            breakPunctuation = null;
        }

        actuallyPrint(text);
    };

    const actuallyPrint = (text: string) => {
        const lastSegment = segments[segments.length - 1];

        if (!lastSegment || lastSegment.isHighlighted !== isHighlighted) {
            segments.push({isHighlighted, text});
        } else {
            lastSegment.text += text;
        }
    };

    const printBlockNode = (parentNode: Node, node: Node) => {
        const typeName = node.type.name as ContentBlockNodeTypeName | "title";

        switch (typeName) {
            case "paragraph": {
                for (const childNode of node.content.content) {
                    printInlineNode(childNode);
                }

                breakPunctuation = ".";
                break;
            }
            case "title":
            case "heading": {
                for (const childNode of node.content.content) {
                    printInlineNode(childNode);
                }

                // Use a colon after headings to introduce the following content. Headings
                // typically aren't quite proper sentences. Often they're nouns describing the
                // following section. Colons are similarly used to introduce the content which
                // follows so let's use that.
                breakPunctuation = ":";
                break;
            }
            case "quoteBlock": {
                for (const childNode of node.content.content) {
                    printBlockNode(node, childNode);
                }
                break;
            }
            case "unorderedListItem":
            case "checkListItem": {
                for (const childNode of node.content.content) {
                    printBlockNode(node, childNode);
                }
                break;
            }
            case "orderedListItem": {
                let listItemNumber = orderListItemNumberByNode.get(node);

                if (listItemNumber === undefined) {
                    computeContentOrderedListItemNumbers(parentNode, orderListItemNumberByNode);
                    listItemNumber = orderListItemNumberByNode.get(node);
                    assert(listItemNumber !== undefined);
                }

                print(`${listItemNumber}. `);

                for (const childNode of node.content.content) {
                    printBlockNode(node, childNode);
                }
                break;
            }
            case "codeBlock": {
                for (const childNode of node.content.content) {
                    printInlineNode(childNode);
                }

                breakPunctuation = "";
                break;
            }
            case "divider": {
                break;
            }
            default:
                throw exhaustive(typeName);
        }
    };

    const printInlineNode = (node: Node) => {
        const typeName = node.type.name as ContentInlineNodeTypeName;

        const hasHighlightMark = node.marks.some(shouldHighlightMark);
        if (hasHighlightMark) {
            isHighlighted = true;
        }

        switch (typeName) {
            case "text": {
                let isFirstLine = true;

                // `paragraph` text doesn't contain newlines (instead if has `break`s) but
                // `codeBlock` text will contain newlines.
                for (const lineText of node.text!.split(newLineRegExp)) {
                    if (!isFirstLine) breakPunctuation = "";
                    isFirstLine = false;

                    print(lineText);
                }
                break;
            }
            case "break": {
                // A break doesn't always separate ideas. Sometimes its contribution is purely
                // visual. We still want a space between the content it breaks apart but no
                // other punctuation.
                breakPunctuation = "";
                break;
            }
            case "mention": {
                const mention: ContentMention = node.attrs.mention;
                const account = content.references.accountById.get(mention.accountId);
                if (!account) {
                    print(`@${missingAccountName}`);
                    break;
                }

                const accountName = mention.isShort
                    ? getAccountShortNameWithoutFullNameTooltip(account.initialData)
                    : account.initialData.name;

                print(`@${accountName}`);
                break;
            }
            default:
                throw exhaustive(typeName);
        }

        if (hasHighlightMark) {
            isHighlighted = false;
        }
    };

    for (const node of content.doc.content.content) {
        printBlockNode(content.doc, node);
    }

    return segments;
}
