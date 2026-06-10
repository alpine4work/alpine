import {Node} from "prosemirror-model";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {spellCheckLint} from "~/client/web/content/internal/spell_check_lint.js";
import {renderContentMentionToTextForClient} from "~/client/web/content/render_content_mention_to_text_for_client.js";
import {
    ContentSpellCheckLint,
    ContentSpellCheckLintCategory,
    ContentSpellCheckLintKey,
    ContentSpellCheckLintKind,
    ContentSpellCheckSuggestionKind,
    contentSpellCheckLintCategoryByKnownKind,
    generateContentSpellCheckLintKey,
} from "~/client/web/content/state/content_editor_spell_checker_configuration.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentInlineNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";

/**
 * Creates a ProseMirror incremental reducer that runs spell check on our content.
 * If you call the `spellCheckContent()` function returned by this function with
 * content that only has small edits we'll only re-run the spell check on parts of
 * the content that changed and return cached lints for the rest thanks to
 * ProseMirror's structural sharing.
 */
export function createSpellCheckContent({
    spaceId,
    getContentReferences,
}: {
    spaceId: SpaceId;
    getContentReferences: () => ContentReferences;
}): (content: Node) => Promise<Array<ContentSpellCheckLint>> {
    const spellCheckContent = createProsemirrorIncrementalReducer<
        Array<Promise<Array<ContentSpellCheckLint>>>
    >(node => {
        if (!node.isTextblock) return null;

        // Don't spell check content in code blocks
        if (node.type.name === "codeBlockLine") return null;

        let text: string = "";
        const content: Array<{pos: number; text: string; isTextNode: boolean}> = [];

        const addContent = (item: {pos: number; text: string; isTextNode: boolean}) => {
            // TODO(#spell-check): Don't spell check content immediately before/after
            // non-text-nodes (if there's no whitespace)
            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/3dazsm0832k9bspkf9g429p00g

            text += item.text;
            content.push(item);
        };

        let pos = 1;

        for (const childNode of node.content.content) {
            const childNodeType = childNode.type.name as ContentInlineNodeTypeName;

            switch (childNodeType) {
                case "text": {
                    // Don't spell check content in code marks
                    if (childNode.marks.some(mark => mark.type.name === "code")) {
                        addContent({pos, text: childNode.text!, isTextNode: false});
                    } else {
                        addContent({pos, text: childNode.text!, isTextNode: true});
                    }
                    break;
                }
                case "break": {
                    addContent({pos, text: "\n", isTextNode: false});
                    break;
                }
                case "mention": {
                    const mention: ContentMention = childNode.attrs.mention;

                    // Get a snapshot of the mention text. Both with a snapshot of references
                    // (`getReferences()`) and a snapshot of the mention text store. We don't listen to
                    // changes to either. We'll never report a spelling issue inside a mention so it
                    // doesn't matter if our mention text isn't up-to-date. We only care about the
                    // mention text since it might provide useful context for the spell checker as to
                    // what the words before/after mean.
                    //
                    // For example, we want the spell checker to "Hello, Caleb!" instead of "Hello, !"
                    // since the latter it may report an error for.
                    const mentionText = renderContentMentionToTextForClient(
                        store => store.getSnapshot(),
                        mention,
                        getContentReferences(),
                        {
                            accountRegistry: getAccountRegistry(spaceId),
                            searchEntityRegistry: getSearchEntityRegistry(spaceId),
                            fileRegistry: getFileRegistry(spaceId),
                        },
                    );

                    addContent({pos, text: mentionText, isTextNode: false});
                    break;
                }
                default:
                    throw exhaustive(childNodeType);
            }

            pos += childNode.nodeSize;
        }

        // Optimization: The textblock should have some non-ignored and non-whitespace
        // content for us to run our spellchecker.
        const hasNonIgnoredContent = content.some(
            item =>
                item.isTextNode && item.text.length > 0 && !/^\p{White_Space}+$/u.test(item.text),
        );
        if (!hasNonIgnoredContent) return null;

        const promise = actuallySpellCheckContent(text).then(lints =>
            // For each lint, find the source content
            filterMapArray(
                lints,
                ({
                    key,
                    index: targetStartIndex,
                    length: targetLength,
                    kind,
                    category,
                    suggestions,
                }) => {
                    const targetEndIndex = targetStartIndex + targetLength;

                    let iterationIndex = 0;
                    let from: number | null = null;

                    // TODO(#spell-check):
                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/w2razny8st2t5x9h29vp7hw3vm
                    // The indexing of the matching lint here isn't quite right. For example, if we
                    // have "`InboxTable` is InboxTable", the lint for `InboxTable` is ignored because
                    // it's code, but the lint for the second InboxTable (that is not in code), will be
                    // ignored as well. Why? Go through our content items to find the matching lint
                    for (let i = 0; i < content.length; i++) {
                        const item = assertExists(content[i]);

                        // If we're at the end of our content, add an additional index to our end to catch
                        // lints at the end of the document
                        const nextIterationIndex =
                            iterationIndex + item.text.length + (i === content.length - 1 ? 1 : 0);

                        // If the lint starts in this item then record `from` using the ProseMirror
                        // position.
                        if (
                            iterationIndex <= targetStartIndex &&
                            targetStartIndex < nextIterationIndex
                        ) {
                            from = item.pos + (targetStartIndex - iterationIndex);
                        }

                        // If the lint crosses a non-text node we ignore it. We only report lints in the
                        // content's own text.
                        if (from !== null && !item.isTextNode) {
                            return;
                        }

                        // If the lint ends in this item then record `to` using the ProseMirror position.
                        if (
                            from !== null &&
                            iterationIndex <= targetEndIndex &&
                            targetEndIndex < nextIterationIndex
                        ) {
                            const to = item.pos + (targetEndIndex - iterationIndex);

                            return {
                                key,
                                from,
                                to,
                                kind,
                                category,
                                suggestions,
                            };
                        }

                        iterationIndex = nextIterationIndex;
                    }
                },
            ),
        );

        // TODO(#spell-check): bold/italic formatting prevents spellcheck
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/fw5zjteqwa11twz9qn8fcac6vr
        return (promises, doc, offset) => {
            const actualPromise = promise.then(lints =>
                lints.map(lint => ({
                    // This key is used for caching lints in the spell checker plugin. Even though the
                    // lint itself has a key from the spell checker engine, we need a unique key per
                    // position in the document. We intentionally do not use the lint's original key
                    // here to avoid collisions.
                    key: generateContentSpellCheckLintKey(),
                    from: offset + lint.from,
                    to: offset + lint.to,
                    kind: lint.kind,
                    category: lint.category,
                    suggestions: lint.suggestions,
                })),
            );

            promises.push(actualPromise);

            return promises;
        };
    });

    return async (content: Node) => {
        const lints = await runAllPromises(spellCheckContent([], content));
        return lints.flat();
    };
}

type ContentSpellCheckActualLint = {
    readonly key: ContentSpellCheckLintKey;
    readonly index: number;
    readonly length: number;
    readonly kind: ContentSpellCheckLintKind;
    readonly category: ContentSpellCheckLintCategory;
    readonly suggestions: Array<{text: string; kind: ContentSpellCheckSuggestionKind}>;
};

export async function actuallySpellCheckContent(
    text: string,
): Promise<Array<ContentSpellCheckActualLint>> {
    const lints = await spellCheckLint(text);
    const result: Array<ContentSpellCheckActualLint> = [];
    const suggestionMap: Array<ContentSpellCheckSuggestionKind> = [
        "replace",
        "remove",
        "insertafter",
    ];

    for (const lint of lints) {
        const span = lint.span();
        const suggestions = lint.suggestions().map(suggestion => {
            let text = suggestion.get_replacement_text();

            // Make sure our suggestions use the proper quotation marks.
            //
            // TODO(#spell-check): Test! For example "That s" to "That's"
            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/3t0zbjhx36sscpd46aqzdz1e8c
            for (let i = 0; i < text.length; i++) {
                const char = text[i]!;

                // eslint-disable-next-line cyberworlds/string-quotes
                if (char === "'") {
                    const lastChar = text[i - 1]!;
                    if (/^\p{White_Space}$/u.test(lastChar)) {
                        text = text.slice(0, i) + "\u2018" + text.slice(i + 1);
                    } else {
                        text = text.slice(0, i) + "\u2019" + text.slice(i + 1);
                    }
                    // eslint-disable-next-line cyberworlds/string-quotes
                } else if (char === '"') {
                    const lastChar = text[i - 1]!;
                    if (/^\p{White_Space}$/u.test(lastChar)) {
                        text = text.slice(0, i) + "\u201C" + text.slice(i + 1);
                    } else {
                        text = text.slice(0, i) + "\u201D" + text.slice(i + 1);
                    }
                }
            }

            return {
                text,
                kind: assertExists(suggestionMap[suggestion.kind().valueOf()]),
            };
        });

        const kind = lint.lint_kind().toLowerCase();
        const category =
            cast<{[kind: string]: ContentSpellCheckLintCategory}>(
                contentSpellCheckLintCategoryByKnownKind,
            )[kind] ??
            // Default new lint category to formatting.
            "formatting";

        result.push({
            // We could use a Symbol here, but Firefox does not support symbols as WeakMap
            // keys. See: https://bugzilla.mozilla.org/show_bug.cgi?id=1710433
            key: generateContentSpellCheckLintKey(),
            index: span.start,
            length: span.end - span.start,
            kind,
            category,
            suggestions,
        });
    }

    return result;
}
