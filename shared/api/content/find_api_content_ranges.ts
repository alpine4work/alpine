import {normalizeApiContentInlineElementMarks} from "~/shared/api/content/normalize_api_content.js";
import {printApiReferenceKey} from "~/shared/api/specification/api_reference_key.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentPosition,
    ApiContentRange,
} from "~/shared/api/specification/types/api_content_position.js";
import {
    ApiContentBlockElementWithOptionalKeys,
    ApiContentWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContent,
    ApiContentBreakInlineElement,
    ApiContentCheckListBlockElement,
    ApiContentCodeBlockElement,
    ApiContentDividerBlockElement,
    ApiContentFileBlockElement,
    ApiContentFileFloatBlockElement,
    ApiContentFileGalleryBlockElementRow,
    ApiContentHeadingBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentMentionInlineElement,
    ApiContentOrderedListBlockElement,
    ApiContentParagraphBlockElement,
    ApiContentPreviewBlockElement,
    ApiContentQuoteBlockElement,
    ApiContentResponse,
    ApiContentTableBlockElement,
    ApiContentTableBlockElementCell,
    ApiContentTableBlockElementRow,
    ApiContentUnorderedListBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list.js";
import {Replace} from "~/shared/helpers/types/replace.js";

/**
 * Finds instances of the `needle` content within `haystack`. If there are multiple
 * instances of `needle` in the `haystack` then multiple ranges will be returned.
 * The ranges returned can be passed to the API to reference a certain range of
 * content.
 *
 * This function isn't perfect. From the agent's perspective it's trying to match
 * markdown strings but in reality we're trying to perform a semantic structured
 * content match. So there's some heuristics in here to match markdown strings that
 * look similar even when the structure is semantically different (for example the
 * markdown `bar` matches the markdown `<pre><code>foo bar</code></pre>` even
 * though the former's markdown is parsed as a `Paragraph` and the latter's
 * markdown is parsed as `Code`).
 *
 * The structure of `needle` must match `haystack`, so any elements must be the
 * same in addition to the text matching. Marks on `needle` must be a subset of
 * marks on `haystack`.
 *
 * This is an iterator so if you break early then we'll stop iterating through the
 * content tree at that point. Which is a useful optimization if you only care
 * about the first match, for instance.
 */
export function* findApiContentRanges(
    haystack: ApiContentResponse,
    needle: ApiContent,
): IterableIterator<ApiContentRange, undefined> {
    const needleStates: Array<{
        needleIterator: IterableIterator<Token, undefined>;
        needleToken: Token;
        start: ApiContentPosition;
        previousHaystackParents: LinkedList<TokenParent>;
        previousNeedleParents: LinkedList<TokenParent>;
    }> = [];

    let startNeedleState: {
        needleIterator: IterableIterator<Token, undefined>;
        needleToken: Token;
    };

    // Push initial needle state.
    {
        const newNeedleIterator = iterateApiContent(null, needle);
        const newNeedleStep = newNeedleIterator.next();

        // We report no matches for an empty needle.
        if (newNeedleStep.value === undefined) return;

        startNeedleState = {
            needleIterator: newNeedleIterator,
            needleToken: newNeedleStep.value,
        };
    }

    for (const haystackToken of iterateApiContent(null, haystack)) {
        let nextIndex = 0;
        while (nextIndex < needleStates.length) {
            const index = nextIndex;
            nextIndex++;
            const needleState = needleStates[index]!;
            const {needleIterator, needleToken, previousHaystackParents, previousNeedleParents} =
                needleState;

            let match: boolean;

            // Tokens must be in elements with matching structure.
            // `<paragraph("a"), paragraph("b")>` shouldn't match `<paragraph("ab")>`. We
            // detect if tokens are in elements with matching structure by comparing
            // referential identity of `parents`.
            if (!areTokensMatch(haystackToken, needleToken)) {
                match = false;
            } else {
                const hasPreviousHaystackParents = hasTokenParents(
                    0,
                    previousHaystackParents,
                    haystackToken.parents,
                );

                const hasPreviousNeedleParents = hasTokenParents(
                    0,
                    previousNeedleParents,
                    needleToken.parents,
                );

                if (hasPreviousHaystackParents[0] && hasPreviousNeedleParents[0]) {
                    match = true;
                } else if (hasPreviousHaystackParents[1] !== hasPreviousNeedleParents[1]) {
                    match = false;
                } else {
                    match = true;
                    needleState.previousHaystackParents = haystackToken.parents;
                    needleState.previousNeedleParents = needleToken.parents;
                }
            }

            if (!match) {
                // This in-progress needle state failed! Remove this needle state.
                needleStates.splice(index, 1);
                nextIndex = index;
            } else {
                const needleStep = needleIterator.next();

                // Hooray! We've reached the last token in our needle. Yield the matched range and
                // reset our state.
                if (needleStep.value !== undefined) {
                    needleState.needleToken = needleStep.value;
                } else {
                    // We've reached the end of this needle state. Let's remove it and yield a value.
                    needleStates.splice(index, 1);
                    nextIndex = index;

                    let end: ApiContentPosition;
                    switch (haystackToken.position.type) {
                        case "Inline": {
                            end = {
                                type: "Inline",
                                // We use the non-null assertion operator (`!`) because `haystack` is
                                // `ApiContentResponse` and so it must always include keys.
                                key: haystackToken.position.key!,
                                index: haystackToken.position.index + 1,
                            };
                            break;
                        }
                        case "Before": {
                            end = {
                                type: "After",
                                // We use the non-null assertion operator (`!`) because `haystack` is
                                // `ApiContentResponse` and so it must always include keys.
                                key: haystackToken.position.key!,
                            };
                            break;
                        }
                        default:
                            throw exhaustive(haystackToken.position);
                    }

                    yield {start: needleState.start, end};
                }
            }
        }

        // Check if the start needle matches the current haystack token. If it matches then
        // add to `needleStates` and create a new `startNeedleState`.
        {
            const {needleIterator, needleToken} = startNeedleState;

            if (areTokensMatch(haystackToken, needleToken)) {
                // Create a new `startNeedleState` now that we've consumed this one.
                {
                    const newNeedleIterator = iterateApiContent(null, needle);
                    const newNeedleStep = newNeedleIterator.next();

                    // We returned earlier if the needle is empty.
                    assert(newNeedleStep.value !== undefined);

                    startNeedleState = {
                        needleIterator: newNeedleIterator,
                        needleToken: newNeedleStep.value,
                    };
                }

                let start: ApiContentPosition;
                switch (haystackToken.position.type) {
                    case "Inline": {
                        start = {
                            type: "Inline",
                            // We use the non-null assertion operator (`!`) because `haystack` is
                            // `ApiContentResponse` and so it must always include keys.
                            key: haystackToken.position.key!,
                            index: haystackToken.position.index,
                        };
                        break;
                    }
                    case "Before": {
                        start = {
                            type: "Before",
                            // We use the non-null assertion operator (`!`) because `haystack` is
                            // `ApiContentResponse` and so it must always include keys.
                            key: haystackToken.position.key!,
                        };
                        break;
                    }
                    default:
                        throw exhaustive(haystackToken.position);
                }

                const needleStep = needleIterator.next();

                // Hooray! We've reached the last token in our needle. Yield the matched range and
                // reset our state.
                if (needleStep.value !== undefined) {
                    needleStates.push({
                        needleIterator,
                        needleToken: needleStep.value,
                        start,
                        previousHaystackParents: haystackToken.parents,
                        previousNeedleParents: needleToken.parents,
                    });
                } else {
                    let end: ApiContentPosition;
                    switch (haystackToken.position.type) {
                        case "Inline": {
                            end = {
                                type: "Inline",
                                // We use the non-null assertion operator (`!`) because `haystack` is
                                // `ApiContentResponse` and so it must always include keys.
                                key: haystackToken.position.key!,
                                index: haystackToken.position.index + 1,
                            };
                            break;
                        }
                        case "Before": {
                            end = {
                                type: "After",
                                // We use the non-null assertion operator (`!`) because `haystack` is
                                // `ApiContentResponse` and so it must always include keys.
                                key: haystackToken.position.key!,
                            };
                            break;
                        }
                        default:
                            throw exhaustive(haystackToken.position);
                    }

                    yield {start, end};
                }
            }
        }
    }
}

function hasTokenParents(
    depth: number,
    previousParents: LinkedList<TokenParent>,
    parents: LinkedList<TokenParent>,
): [boolean, number] {
    if (previousParents === null) {
        if (parents === null) return [true, depth];
        return [false, depth];
    }

    if (parents === null) return [false, depth];

    const result = hasTokenParents(depth + 1, previousParents.next, parents.next);
    if (result[0] === false) return result;

    if (previousParents.value !== parents.value) {
        result[0] = false;
        return result;
    } else {
        result[1] -= 1;
        return result;
    }
}

type TokenParent =
    | ApiContentParagraphBlockElement
    | ApiContentHeadingBlockElement
    | ApiContentQuoteBlockElement
    | ApiContentUnorderedListBlockElement
    | ApiContentOrderedListBlockElement
    | ApiContentCodeBlockElement
    | ApiContentFileFloatBlockElement
    | ApiContentTableBlockElement
    | TokenCheckListItemParent
    | TokenFileGalleryRowParent
    | TokenTableCellParent
    | TokenTableRowParent;

type TokenCheckListItemParent = {
    readonly type: "CheckListItem";
    readonly itemIndex: number;
    readonly listElement: ApiContentCheckListBlockElement;
};

type TokenFileGalleryRowParent = {
    readonly type: "FileGalleryRow";
    readonly row: ApiContentFileGalleryBlockElementRow | null;
};

type TokenTableCellParent = {
    readonly type: "TableCell";
    readonly cell: ApiContentTableBlockElementCell;
};

type TokenTableRowParent = {
    readonly type: "TableRow";
    readonly row: ApiContentTableBlockElementRow;
};

type Token = {
    parents: LinkedList<TokenParent>;
    position:
        | {type: "Inline"; key: ApiContentKey | undefined; index: number}
        | {type: "Before"; key: ApiContentKey | undefined};
    value: TokenValue;
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined;
};

type TokenValue =
    | string
    | ApiContentBreakInlineElement
    | ApiContentMentionInlineElement
    | ApiContentDividerBlockElement
    | ApiContentFileBlockElement
    | ApiContentPreviewBlockElement;

function areTokensMatch(haystackToken: Token, needleTokens: Token): boolean {
    // This is most likely to be different, put it first to short circuit early.
    if (!areTokenValuesEqual(haystackToken.value, needleTokens.value)) return false;

    // This is unlikely to be different but is cheap to compute, put it second.
    if (!areTokenParentListsMatch(haystackToken.parents, needleTokens.parents)) return false;

    // This is least likely to be different and also the most expensive to compute, put
    // it last.
    if (areTokenMarksMatch(haystackToken.marks, needleTokens.marks)) {
        return true;
    }

    // The marks on a break don't matter. Breaks are never rendered. Ignore mark
    // equality for breaks.
    if (typeof haystackToken.value !== "string" && haystackToken.value.type === "Break")
        return true;

    return false;
}

function areTokenMarksMatch(
    haystackMarks: ReadonlyArray<ApiContentInlineElementMark> | undefined,
    needleMarks: ReadonlyArray<ApiContentInlineElementMark> | undefined,
): boolean {
    const normalizedNeedleMarks = normalizeApiContentInlineElementMarks(needleMarks);
    if (normalizedNeedleMarks === undefined) return true;

    const normalizedHaystackMarks = normalizeApiContentInlineElementMarks(haystackMarks);
    if (normalizedHaystackMarks === undefined) return false;

    return normalizedNeedleMarks.every(needleMark =>
        normalizedHaystackMarks.some(haystackMark => isDeepEqual(haystackMark, needleMark)),
    );
}

function areTokenParentListsMatch(
    haystackParents: LinkedList<TokenParent>,
    needleParents: LinkedList<TokenParent>,
): boolean {
    if (haystackParents === null) {
        if (needleParents !== null) return false;
        return true;
    }

    // If the needle has no more parents but everything up to this point was a match,
    // then we consider the parent lists to be a match! This supports matching simply
    // `paragraph("bar")` with:
    //
    // ```
    // quoteBlock(paragraph("foo bar qux"))
    // ```
    //
    // `paragraph("bar")` isn't wrapped in a `quoteBlock()` but it matches content
    // inside the quote block.
    if (needleParents === null) return true;

    if (!areTokenParentsMatch(haystackParents.value, needleParents.value)) return false;

    return areTokenParentListsMatch(haystackParents.next, needleParents.next);
}

function areTokenParentsMatch(haystackParent: TokenParent, needleParent: TokenParent): boolean {
    switch (haystackParent.type) {
        case "Paragraph": {
            return needleParent.type === "Paragraph";
        }
        case "Heading": {
            return (
                needleParent.type === "Heading" ||
                // Allow plain paragraph text to match text within a heading. That way if the
                // haystack is the markdown `# Hello, world!` (parsed as a heading) then the
                // markdown `world!` (parsed as a paragraph) will match.
                needleParent.type === "Paragraph"
            );
        }
        case "Quote": {
            return needleParent.type === "Quote";
        }
        case "UnorderedList": {
            return needleParent.type === "UnorderedList";
        }
        case "OrderedList": {
            return needleParent.type === "OrderedList";
        }
        case "CheckListItem": {
            return (
                needleParent.type === "CheckListItem" &&
                haystackParent.listElement.items[haystackParent.itemIndex]!.checked ===
                    needleParent.listElement.items[needleParent.itemIndex]!.checked
            );
        }
        case "Code": {
            return (
                (needleParent.type === "Code" &&
                    haystackParent.language === needleParent.language) ||
                // Allow plain paragraph text to match text within a code block. That way if the
                // haystack is the markdown `<pre><code>Hello, world!</code></pre>` (parsed as a
                // code block) then the markdown `world!` (parsed as a paragraph) will match.
                //
                // This won't be perfect, for example `*world!*` will be parsed as the text
                // "world!" with an italic mark whereas `<pre><code>Hello, *world!*</code></pre>`
                // doesn't parse its content as markdown and so we just have the literal text
                // `*world!*`. But we think it's still a useful heuristic that'll be applied some
                // of the time to help out agents.
                needleParent.type === "Paragraph"
            );
        }
        case "FileFloat": {
            return (
                (needleParent.type === "FileFloat" && haystackParent.side === needleParent.side) ||
                // Allow a file in a file gallery row with one item to match a file float. This
                // allows `<img src="..."/>` to match
                // `<div style="float: left"><img src="..."/></div>`.
                (needleParent.type === "FileGalleryRow" &&
                    (needleParent.row === null || needleParent.row.items.length === 1))
            );
        }
        case "FileGalleryRow": {
            return needleParent.type === "FileGalleryRow";
        }
        case "Table": {
            return needleParent.type === "Table";
        }
        case "TableRow": {
            return needleParent.type === "TableRow";
        }
        case "TableCell": {
            return needleParent.type === "TableCell";
        }
        default:
            throw exhaustive(haystackParent);
    }
}

function areTokenValuesEqual(value1: TokenValue, value2: TokenValue): boolean {
    if (typeof value1 === "string") {
        if (typeof value2 !== "string") return false;
        return value1 === value2;
    }

    if (typeof value2 === "string") return false;

    switch (value1.type) {
        case "Break": {
            if (value2.type !== "Break") return false;
            return true;
        }
        case "Mention": {
            if (value2.type !== "Mention") return false;

            // If other keys are added to `ApiContentMentionInlineElement` in the future you
            // may need to add equality check for them here. TypeScript will error when a new
            // key is added forcing the developer to consider updating this equality logic.
            assertEqualTypes<
                keyof typeof value1,
                "type" | "reference" | "isAccountShortName" | "marks"
            >();

            return (
                printApiReferenceKey(value1.reference) === printApiReferenceKey(value2.reference) &&
                !!value1.isAccountShortName === !!value2.isAccountShortName
            );
        }
        case "Divider": {
            if (value2.type !== "Divider") return false;
            return true;
        }
        case "File": {
            if (value2.type !== "File") return false;
            return value1.id === value2.id;
        }
        case "Preview": {
            if (value2.type !== "Preview") return false;
            return (
                printApiReferenceKey(value1.reference) === printApiReferenceKey(value2.reference)
            );
        }
        default:
            throw exhaustive(value1);
    }
}

function* iterateApiContent(
    parents: LinkedList<TokenParent>,
    content: ApiContentWithOptionalKeys,
): IterableIterator<Token, undefined> {
    for (const element of content.elements) {
        yield* iterateApiContentBlockElement(parents, element);
    }
}

function* iterateApiContentBlockElement(
    parents: LinkedList<TokenParent>,
    element: ApiContentBlockElementWithOptionalKeys,
): IterableIterator<Token, undefined> {
    switch (element.type) {
        case "Paragraph": {
            yield* iterateApiContentInlineElements(
                {value: element, next: parents},
                element.key,
                element.elements,
            );
            break;
        }
        case "Heading": {
            yield* iterateApiContentInlineElements(
                {value: element, next: parents},
                element.key,
                element.elements,
            );
            break;
        }
        case "Quote": {
            const childParents = {value: element, next: parents};

            for (const childElement of element.elements) {
                yield* iterateApiContentBlockElement(childParents, childElement);
            }
            break;
        }
        case "UnorderedList":
        case "OrderedList": {
            const childParents = {value: element, next: parents};

            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childParents, childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(childParents, nestedElement);
                    }
                }
            }
            break;
        }
        case "CheckList": {
            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                const childParents: NonEmptyLinkedList<TokenParent> = {
                    value: {type: "CheckListItem", itemIndex, listElement: element},
                    next: parents,
                };

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childParents, childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(childParents, nestedElement);
                    }
                }
            }
            break;
        }
        case "Code": {
            let isFirstLine = true;

            const childParents = {value: element, next: parents};

            for (const line of element.lines) {
                // Add a break element as a token between lines. That way we can observe multiple
                // empty lines within a code block. Otherwise we'd only observe text and skip over
                // empty lines.
                if (isFirstLine) {
                    isFirstLine = false;
                } else {
                    yield {
                        parents: childParents,
                        position: {type: "Inline", key: line.key, index: 0},
                        value: {type: "Break"},
                        marks: undefined,
                    };
                }

                yield* iterateApiContentInlineElements(childParents, line.key, line.elements);
            }
            break;
        }
        case "Divider": {
            yield {
                parents: parents,
                position: {type: "Before", key: element.key},
                value: element,
                marks: undefined,
            };
            break;
        }
        case "File":
        case "Preview": {
            yield {
                // A file directly inlined in content is the same as a file in a one item file
                // gallery row.
                parents: {value: {type: "FileGalleryRow", row: null}, next: parents},
                position: {type: "Before", key: element.key},
                value: element,
                marks: element.marks,
            };
            break;
        }
        case "FileGallery": {
            for (const row of element.rows) {
                const childParents: LinkedList<TokenParent> = {
                    value: {type: "FileGalleryRow", row},
                    next: parents,
                };

                if (row.items.length === 1) {
                    const childElement = row.items[0]!.element;

                    yield {
                        parents: {value: {type: "FileGalleryRow", row}, next: parents},
                        position: {type: "Before", key: childElement.key},
                        value: childElement,
                        marks: childElement.marks,
                    };
                } else {
                    for (const {element: childElement} of row.items) {
                        yield {
                            parents: childParents,
                            position: {type: "Before", key: childElement.key},
                            value: childElement,
                            marks: childElement.marks,
                        };
                    }
                }
            }
            break;
        }
        case "FileFloat": {
            const childParents = {value: element, next: parents};

            yield {
                parents: childParents,
                position: {type: "Before", key: element.element.key},
                value: element.element,
                marks: element.element.marks,
            };
            break;
        }
        case "Table": {
            const tableParents: NonEmptyLinkedList<TokenParent> = {
                value: element,
                next: parents,
            };

            for (const row of element.rows) {
                const rowParents: NonEmptyLinkedList<TokenParent> = {
                    value: {type: "TableRow", row},
                    next: tableParents,
                };

                for (const cell of row.cells) {
                    const cellParents: NonEmptyLinkedList<TokenParent> = {
                        value: {type: "TableCell", cell},
                        next: rowParents,
                    };

                    for (const childElement of cell.elements) {
                        yield* iterateApiContentBlockElement(cellParents, childElement);
                    }
                }
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function* iterateApiContentInlineElements(
    parents: NonEmptyLinkedList<TokenParent>,
    key: ApiContentKey | undefined,
    elements: ReadonlyArray<ApiContentInlineElement>,
): IterableIterator<Token, undefined> {
    let index = 0;

    // We reuse the same `token` object for every character to avoid creating a lot of
    // garbage collector pressure from tiny objects.
    const token: Replace<Token, {position: Extract<Token["position"], {type: "Inline"}>}> = {
        parents,
        position: {type: "Inline", key, index},
        value: "",
        marks: undefined,
    };

    for (const element of elements) {
        switch (element.type) {
            case "Text": {
                for (let i = 0; i < element.text.length; i++) {
                    token.position.index = index;
                    token.value = element.text[i]!;
                    token.marks = element.marks;
                    yield token;
                    index++;
                }
                break;
            }
            case "Break":
            case "Mention": {
                token.position.index = index;
                token.value = element;
                token.marks = element.marks;
                yield token;
                index++;
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}
