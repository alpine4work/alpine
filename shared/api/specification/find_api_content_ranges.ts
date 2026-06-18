// IMPORTANT: Tests for this file live in
// `shared/api/content/find_api_content_ranges.test.ts`. So they can depend on our
// internal content format to API content format conversion code (and importantly
// `ApiContentKeyEncoder`).

import {normalizeApiContentInlineElementMarks} from "~/shared/api/markdown/normalize_api_content.js";
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
    ApiContentHeadingBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentMentionInlineElement,
    ApiContentOrderedListBlockElement,
    ApiContentParagraphBlockElement,
    ApiContentQuoteBlockElement,
    ApiContentResponse,
    ApiContentUnorderedListBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list.js";

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
 * The structure of `needle` must exactly match `haystack`, so any elements or
 * marks must be the same in addition to the text matching.
 *
 * Matches will never overlap.
 *
 * This is an iterator so if you break early then we'll stop iterating through the
 * content tree at that point. Which is a useful optimization if you only care
 * about the first match, for instance.
 */
export function* findApiContentRanges(
    haystack: ApiContentResponse,
    needle: ApiContent,
): IterableIterator<ApiContentRange, undefined> {
    let needleIterator = iterateApiContent(null, needle);
    let needleStep = needleIterator.next();

    let rangeState: {
        start: ApiContentPosition;
        previousHaystackParents: NonEmptyLinkedList<TokenParent>;
        previousNeedleParents: NonEmptyLinkedList<TokenParent>;
    } | null = null;

    // We report no matches for an empty needle.
    if (needleStep.value === undefined) return;

    for (const haystackToken of iterateApiContent(null, haystack)) {
        const needleToken = needleStep.value;

        let match: boolean;

        // Tokens must be in elements with matching structure.
        // `<paragraph("a"), paragraph("b")>` shouldn't match `<paragraph("ab")>`. We
        // detect if tokens are in elements with matching structure by comparing
        // referential identity of `parents`.
        if (!areTokensMatch(haystackToken, needleToken)) {
            match = false;
        } else if (rangeState === null) {
            match = true;
        } else {
            const hasPreviousHaystackParents =
                rangeState.previousHaystackParents === haystackToken.parents;
            const hasPreviousNeedleParents =
                rangeState.previousNeedleParents === needleToken.parents;

            if (hasPreviousHaystackParents && hasPreviousNeedleParents) {
                match = true;
            } else if (hasPreviousHaystackParents || hasPreviousNeedleParents) {
                match = false;
            } else {
                match = true;
                rangeState.previousHaystackParents = haystackToken.parents;
                rangeState.previousNeedleParents = needleToken.parents;
            }
        }

        if (!match) {
            // This match failed! Reset our state.
            if (rangeState !== null) {
                needleIterator = iterateApiContent(null, needle);
                needleStep = needleIterator.next();
                rangeState = null;

                // We report no matches for an empty needle.
                if (needleStep.value === undefined) return;
            }
        } else {
            // Ooh! The token is a match, let's see start a new range.
            if (rangeState === null) {
                // We use the non-null assertion operator (`!`) because `haystack` is
                // `ApiContentResponse` and so it must always include keys.
                rangeState = {
                    start: {key: haystackToken.key!, index: haystackToken.index},
                    previousHaystackParents: haystackToken.parents,
                    previousNeedleParents: needleToken.parents,
                };
            }

            needleStep = needleIterator.next();

            // Hooray! We've reached the last token in our needle. Yield the matched range and
            // reset our state.
            if (needleStep.value === undefined) {
                yield {
                    start: rangeState.start,
                    // We use the non-null assertion operator (`!`) because `haystack` is
                    // `ApiContentResponse` and so it must always include keys.
                    end: {key: haystackToken.key!, index: haystackToken.index + 1},
                };

                needleIterator = iterateApiContent(null, needle);
                needleStep = needleIterator.next();
                rangeState = null;

                // We report no matches for an empty needle.
                if (needleStep.value === undefined) return;
            }
        }
    }
}

type TokenParent =
    | ApiContentParagraphBlockElement
    | ApiContentHeadingBlockElement
    | ApiContentQuoteBlockElement
    | ApiContentUnorderedListBlockElement
    | ApiContentOrderedListBlockElement
    | {
          readonly type: "CheckListItem";
          readonly itemIndex: number;
          readonly listElement: ApiContentCheckListBlockElement;
      }
    | ApiContentCodeBlockElement;

type Token = {
    parents: NonEmptyLinkedList<TokenParent>;
    key: ApiContentKey | undefined;
    index: number;
    value: TokenValue;
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined;
};

type TokenValue = string | ApiContentBreakInlineElement | ApiContentMentionInlineElement;

function areTokensMatch(haystackToken: Token, needleTokens: Token): boolean {
    // This is most likely to be different, put it first to short circuit early.
    if (!areTokenValuesEqual(haystackToken.value, needleTokens.value)) return false;

    // This is unlikely to be different but is cheap to compute, put it second.
    if (!areTokenParentListsMatch(haystackToken.parents, needleTokens.parents)) return false;

    // This is least likely to be different and also the most expensive to compute, put
    // it last.
    if (
        isDeepEqual(
            normalizeApiContentInlineElementMarks(haystackToken.marks),
            normalizeApiContentInlineElementMarks(needleTokens.marks),
        )
    ) {
        return true;
    }

    // The marks on a break don't matter. Breaks are never rendered. Ignore mark
    // equality for breaks.
    if (typeof haystackToken.value !== "string" && haystackToken.value.type === "Break")
        return true;

    return false;
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
                        key: line.key,
                        index: 0,
                        value: {type: "Break"},
                        marks: undefined,
                    };
                }

                yield* iterateApiContentInlineElements(childParents, line.key, line.elements);
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
    const token: Token = {
        parents,
        key,
        index,
        value: "",
        marks: undefined,
    };

    for (const element of elements) {
        switch (element.type) {
            case "Text": {
                for (let i = 0; i < element.text.length; i++) {
                    token.index = index;
                    token.value = element.text[i]!;
                    token.marks = element.marks;
                    yield token;
                    index++;
                }
                break;
            }
            case "Break":
            case "Mention": {
                token.index = index;
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
