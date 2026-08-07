import {Mark, Node} from "prosemirror-model";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    ContentBlockNodeTypeName,
    ContentInlineNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {
    FileNounCountState,
    printContentSingleLineTextSnippetForFileRow,
} from "~/shared/content/print_content_single_line_text_snippet_for_file_row.js";
import {
    RenderContentMentionToTextSearchEntity,
    renderContentMentionToText,
} from "~/shared/content/render_content_mention_to_text.js";
import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.open_source.js";
import {doesStringEndWithPunctuation} from "~/shared/helpers/string/does_string_end_with_punctuation.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.open_source.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Match different new-line formats. [Same newline regex that's in
 * `compromise`][1].
 *
 * [1]:
 *     https://github.com/spencermountain/compromise/blob/cb5068d01e4a2002e5baabd2e332e0f077a5997f/src/1-one/tokenize/methods/01-sentences/01-simple-split.js#L5
 */
const newLineRegExp = /(?:(?:\r?\n|\r)+)/g;

/**
 * Takes some content and prints it as a single line plain text snippet. This plain
 * text preview is used for inbox entry content previews and search result content
 * previews.
 *
 * `getContentSnippet()` can be used to extract some piece of content and this
 * function can be used for printing that content to a plain text preview.
 *
 * Doesn't take `ContentReferences` and instead takes individual
 * `getAccountIfExists` and `getSearchEntityIfExists` functions to load referenced
 * data. Since different callers need to provide content references in different
 * ways. For example, on the client we want to use `AccountRegistry` and
 * `SearchEntityRegistry` to make sure we're rendering up-to-date data whereas on
 * the server we don't have a normalized registry and may want to use the directly
 * available `AccountModel.initialData` or `SearchEntityModel.initialData`.
 *
 * On the client, generally you should call
 * `printContentSingleLineTextSnippetForClient()` which provides a more convenient
 * interface.
 */
export function printContentSingleLineTextSnippet(
    content: Node,
    {
        getAccountIfExists,
        getSearchEntityIfExists,
        getFileIfExists,
    }: {
        getAccountIfExists: (
            accountId: AccountId,
        ) => Omit<AccountModelWithoutSpaceData, "avatar"> | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
        getFileIfExists: (fileId: FileId) => {readonly contentType: FileContentType} | null;
    },
): string {
    const segments = printContentSingleLineTextSnippetPreservingMarks(content, {
        shouldPreserveMark: () => false,
        getAccountIfExists,
        getSearchEntityIfExists,
        getFileIfExists,
    });

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
 * function) but we preserve the styling for marks where `shouldPreserveMark()`
 * returns true. Used for showing search result content previews since we need to
 * highlight matched words.
 *
 * Doesn't take `ContentReferences` and instead takes individual
 * `getAccountIfExists` and `getSearchEntityIfExists` functions to load referenced
 * data. Since different callers need to provide content references in different
 * ways. For example, on the client we want to use `AccountRegistry` and
 * `SearchEntityRegistry` to make sure we're rendering up-to-date data whereas on
 * the server we don't have a normalized registry and may want to use the directly
 * available `AccountModel.initialData` or `SearchEntityModel.initialData`.
 */
export function printContentSingleLineTextSnippetPreservingMarks(
    content: Node,
    options: {
        shouldPreserveMark: (mark: Mark) => boolean;
        getAccountIfExists: (
            accountId: AccountId,
        ) => Omit<AccountModelWithoutSpaceData, "avatar"> | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
        getFileIfExists: (fileId: FileId) => {readonly contentType: FileContentType} | null;
    },
): Array<{marks: ReadonlyArray<Mark>; text: string}> {
    const {shouldPreserveMark, getFileIfExists} = options;

    const segments: Array<{marks: ReadonlyArray<Mark>; text: string}> = [];
    let breakPunctuation: {marks: ReadonlyArray<Mark>; text: string} | null = null;
    let preservedMarks: ReadonlyArray<Mark> = emptyArray;
    const orderListItemNumberByNode = new Map<Node, number>();
    let fileNounNumberState: FileNounCountState = null;
    let isTrimmingStart = false;

    const print = (text: string) => {
        if (isTrimmingStart) text = text.trimStart();
        if (text.length === 0) return;
        isTrimmingStart = false;

        // Reset file noun number whenever we print non-file text. File noun number should
        // only be shared for adjacent files of the same type.
        fileNounNumberState = null;

        // Break punctuation is used to separate content which otherwise would have
        // rendered on separate lines. For example, we put a period after a heading then
        // print the paragraph which follows.
        if (breakPunctuation !== null) {
            const lastSegment = segments[segments.length - 1];

            if (lastSegment) {
                const actualPreservedMarks = preservedMarks;

                preservedMarks =
                    lastSegment.marks.length === preservedMarks.length &&
                    lastSegment.marks.every(mark => mark.isInSet(preservedMarks))
                        ? actualPreservedMarks
                        : emptyArray;

                // If a sentence is already ended with punctuation, we don't want to add our break
                // punctuation. If a sentence is ended with punctuation, then a quote character
                // that also counts.
                if (doesStringEndWithPunctuation(lastSegment.text)) {
                    actuallyPrint(" ");
                } else {
                    // Add any marks from the break punctuation to `preservedMarks` which gets cleared
                    // below.
                    if (breakPunctuation.marks.length > 0) {
                        const newPreservedMarks = [...preservedMarks];

                        for (const mark of breakPunctuation.marks) {
                            if (shouldPreserveMark(mark) && !mark.isInSet(preservedMarks)) {
                                newPreservedMarks.push(mark);
                            }
                        }

                        preservedMarks = newPreservedMarks;
                    }

                    actuallyPrint(`${breakPunctuation.text} `);
                }

                preservedMarks = actualPreservedMarks;
            }

            breakPunctuation = null;
        }

        actuallyPrint(text);
    };

    const actuallyPrint = (text: string) => {
        const lastSegment = segments[segments.length - 1];

        if (
            !lastSegment ||
            !lastSegment.marks.every(mark => mark.isInSet(preservedMarks)) ||
            !preservedMarks.every(mark => mark.isInSet(lastSegment.marks))
        ) {
            segments.push({marks: preservedMarks, text});
        } else {
            lastSegment.text += text;
        }
    };

    const printBlockNode = (parentNode: Node, node: Node) => {
        const typeName = node.type.name as ContentBlockNodeTypeName | "title" | "fileRowTable";

        switch (typeName) {
            case "paragraph": {
                for (const childNode of node.content.content) {
                    printInlineNode(childNode);
                }

                breakPunctuation = {marks: emptyArray, text: "."};
                break;
            }
            case "title":
            case "heading": {
                for (const childNode of node.content.content) {
                    printInlineNode(
                        childNode,
                        // Pretend that children of `heading` have the `bold` mark.
                        [node.type.schema.mark("bold")],
                    );
                }

                // Use a colon after headings to introduce the following content. Headings
                // typically aren't quite proper sentences. Often they're nouns describing the
                // following section. Colons are similarly used to introduce the content which
                // follows so let's use that.
                breakPunctuation = {marks: [node.type.schema.mark("bold")], text: ":"};
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
                    for (const grandChildNode of childNode.content.content) {
                        isTrimmingStart = true;

                        printInlineNode(
                            grandChildNode,
                            // Pretend that children of `codeBlock` have the `code` mark.
                            [node.type.schema.mark("code")],
                        );

                        isTrimmingStart = false;
                    }
                    breakPunctuation = {marks: emptyArray, text: ""};
                }
                break;
            }
            // Divider doesn't have a good single-line text representation.
            case "divider": {
                break;
            }
            // Don't print a single-line text representation of floating files since we likely
            // won't print in the location a user would expect.
            case "fileFloat": {
                break;
            }
            case "fileRow":
            case "fileRowTable": {
                const fileIds = Array.from(
                    node.content.content,
                    (childNode): FileId | FileEntityId | null => childNode.attrs.fileId,
                );

                const fileRow = printContentSingleLineTextSnippetForFileRow(
                    fileIds,
                    getFileIfExists,
                    fileNounNumberState,
                );

                for (const text of fileRow.parts) {
                    print(text);
                    breakPunctuation = {marks: emptyArray, text: "."};
                }

                fileNounNumberState = fileRow.nextState;
                break;
            }
            case "table": {
                for (const childRowNode of node.content.content) {
                    for (const childCellNode of childRowNode.content.content) {
                        for (const childNode of childCellNode.content.content) {
                            printBlockNode(node, childNode);
                        }
                    }
                }
                break;
            }
            default:
                throw exhaustive(typeName);
        }
    };

    const printInlineNode = (node: Node, extraMarks: ReadonlyArray<Mark> = emptyArray) => {
        const typeName = node.type.name as ContentInlineNodeTypeName;

        preservedMarks = Array.from(
            filterIterable(concatIterables(node.marks, extraMarks), shouldPreserveMark),
        );

        switch (typeName) {
            case "text": {
                let isFirstLine = true;

                // `paragraph` text shouldn't contain newlines (instead if should have `break`s)
                // but it is possible to sneak them in with `state.tr.insertText("\n")`. If
                // `whitespace: "pre"` is set on the ProseMirror node type then newlines will be
                // allowed. For example ProseMirror recommends building code blocks with
                // `whitespace: "pre"`.
                for (const lineText of node.text!.split(newLineRegExp)) {
                    if (!isFirstLine) breakPunctuation = {marks: emptyArray, text: ""};
                    isFirstLine = false;

                    print(lineText);
                }
                break;
            }
            case "break": {
                // A break doesn't always separate ideas. Sometimes its contribution is purely
                // visual. We still want a space between the content it breaks apart but no other
                // punctuation.
                breakPunctuation = {marks: emptyArray, text: ""};
                break;
            }
            case "mention": {
                const mention: ContentMention = node.attrs.mention;

                const mentionText = renderContentMentionToText(mention, options);
                print(mentionText);
                break;
            }
            default:
                throw exhaustive(typeName);
        }

        preservedMarks = emptyArray;
    };

    for (const node of content.content.content) {
        printBlockNode(content, node);
    }

    return segments;
}
