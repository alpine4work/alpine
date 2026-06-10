import {Node} from "prosemirror-model";
import {EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import {
    ContentSpellCheckLint,
    ContentSpellCheckLintKey,
} from "~/client/web/content/state/content_editor_spell_checker_configuration.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

type ContentEditorSpellCheckerPluginState = {
    readonly lints: ReadonlyArray<ContentSpellCheckLint>;
    readonly hideLintUntilSelectionLeaves: {
        readonly key: ContentSpellCheckLintKey;
        readonly hasDocChanged: boolean;
    } | null;
};

const contentEditorSpellCheckerPluginKey = new PluginKey<ContentEditorSpellCheckerPluginState>(
    "contentEditorSpellChecker",
);

// TODO(#spell-check): Test!
// https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2qvqf4ff4bp38m29vmdrfyjcq8

export function contentEditorSpellCheckerPlugin() {
    const decorationElementByLintKey = new WeakMap<ContentSpellCheckLintKey, HTMLElement>();

    return new Plugin<ContentEditorSpellCheckerPluginState>({
        key: contentEditorSpellCheckerPluginKey,
        state: {
            init: () => ({hideLintUntilSelectionLeaves: null, lints: emptyArray}),
            apply: (transaction, pluginState, oldState, newState) => {
                const newLints: Array<ContentSpellCheckLint> | undefined = transaction.getMeta(
                    contentEditorSpellCheckerPluginKey,
                );
                if (newLints !== undefined) {
                    // If the user is actively typing and the selection is inside one of the new lints
                    // then hide that lint until the selection leaves the lint. Since the user is
                    // actively typing in this range so of course there will be errors.
                    //
                    // Some cases to consider. `|` represents the cursor for an empty selection and
                    // `[]` represent the start/end of a non-empty selection:
                    //
                    // - `hello worl|` we want to hide the lint on `worl` since the user is typing
                    // - `hello [worl]` we don't want to hide the lint on `worl`
                    // - If we've already spellchecked `hello wor` so there's a red squiggly on `wor`
                    //   and the user then adds an `l` putting us on `hello worl|` we want to keep the
                    //   red squiggly until the user has a correct word
                    const hideLint = newState.selection.empty
                        ? newLints.find(newLint => {
                              // Ignore empty lint...
                              if (newLint.from === newLint.to) return false;

                              if (
                                  !isRangeContained(
                                      newLint.from,
                                      newLint.to,
                                      newState.selection.from,
                                      newState.selection.to,
                                  )
                              ) {
                                  return false;
                              }

                              // We don't want to hide a currently visible lint. So if this new lint that
                              // contains the selection overlaps an old lint then don't hide this new lint.
                              if (
                                  pluginState.lints.some(
                                      oldLint =>
                                          // Ignore empty lint...
                                          oldLint.from !== oldLint.to &&
                                          // Ignore hidden lint...
                                          oldLint.key !==
                                              pluginState.hideLintUntilSelectionLeaves?.key &&
                                          // If old lint intersects with new lint.
                                          //
                                          // The lints must share a single character and not just be touching (why we
                                          // subtract 1 from `to`). For example if `oldLint` is `[foo]bar` and `newLint` is
                                          // `foo[bar]` we don't consider those to be intersecting.
                                          areRangesOverlapping(
                                              newLint.from,
                                              newLint.to - 1,
                                              oldLint.from,
                                              oldLint.to - 1,
                                          ),
                                  )
                              ) {
                                  return false;
                              }

                              return true;
                          })
                        : undefined;

                    return {
                        lints: newLints,
                        hideLintUntilSelectionLeaves: hideLint
                            ? {key: hideLint.key, hasDocChanged: false}
                            : null,
                    };
                }

                // Map lints to their new positions.
                if (transaction.docChanged) {
                    pluginState = {
                        hideLintUntilSelectionLeaves:
                            pluginState.hideLintUntilSelectionLeaves?.hasDocChanged === false
                                ? {...pluginState.hideLintUntilSelectionLeaves, hasDocChanged: true}
                                : pluginState.hideLintUntilSelectionLeaves,
                        lints: filterMapArray(
                            pluginState.lints,
                            (lint): ContentSpellCheckLint | undefined => {
                                const from = transaction.mapping.map(lint.from, 1);
                                const to = transaction.mapping.map(lint.to, -1);

                                // If the lint range is now empty, it's because the content was deleted during the
                                // lint.
                                if (from === to) return;

                                return {
                                    key: lint.key,
                                    from,
                                    to,
                                    category: lint.category,
                                    kind: lint.kind,
                                    suggestions: lint.suggestions,
                                };
                            },
                        ),
                    };
                }

                // If the selection leaves the hidden lint range then clear the hidden lint so it
                // shows up. We hide the lint under the selection while the user is typing since of
                // course there will be temporary errors.
                //
                // If the doc has changed after we hid the lint then don't clear the lint until we
                // get new lints! This fixes cases like `Hello|.` when you type space (`Hello |.`)
                // so you have a lint that there's a space before the period then when you type `w`
                // (`Hello w|.`) the lint becomes visible because selection has moved to the right
                // of `w` and isn't covering the lint anymore. So we keep the lint hidden after the
                // document changes until a new lint runs, the new spell check will either still
                // have the lint (in which case it'll appear for the user) or the lint was fixed in
                // the new spell check run (in which case the lint will never have been visible to
                // the user).
                if (pluginState.hideLintUntilSelectionLeaves?.hasDocChanged === false) {
                    const lint = pluginState.lints.find(
                        lint => lint.key === pluginState.hideLintUntilSelectionLeaves!.key,
                    );

                    if (
                        !lint ||
                        !isRangeContained(
                            lint.from,
                            lint.to,
                            newState.selection.from,
                            newState.selection.to,
                        )
                    ) {
                        pluginState = {
                            lints: pluginState.lints,
                            hideLintUntilSelectionLeaves: null,
                        };
                    }
                }

                return pluginState;
            },
        },
        props: {
            decorations: state => {
                const {hideLintUntilSelectionLeaves, lints} =
                    contentEditorSpellCheckerPluginKey.getState(state)!;
                if (lints.length === 0) return DecorationSet.empty;

                // The same node reference can appear in multiple positions in a ProseMirror
                // document. For example, when pasting content into a table selection we repeat
                // that content across all table cells.
                const lintsByPosByTextblockNode = new DefaultMap<
                    Node,
                    DefaultMap<number, Array<ContentSpellCheckLint>>
                >(() => new DefaultMap(() => []));

                for (const lint of lints) {
                    // Skip the hidden lint...
                    if (lint.key === hideLintUntilSelectionLeaves?.key) continue;

                    const $from = state.doc.resolve(lint.from);

                    let textblockDepth = $from.depth;
                    let textblockNode = $from.node(textblockDepth);

                    while (!textblockNode?.isTextblock && textblockDepth >= 0) {
                        textblockDepth--;
                        textblockNode = $from.node(textblockDepth);
                    }

                    if (!textblockNode) continue;

                    // TODO(#spell-check): Don't render lints in code blocks
                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/b1zgg6kj6r95te8n97ngbmkg6m

                    const textblockPos = $from.start(textblockDepth);

                    lintsByPosByTextblockNode
                        .getOrSetDefault(textblockNode)
                        .getOrSetDefault(textblockPos)
                        .push(lint);
                }

                const decorations: Array<Decoration> = [];

                for (const [textblockNode, lintsByPos] of lintsByPosByTextblockNode) {
                    for (const [textblockPos, textblockLints] of lintsByPos) {
                        for (let i = 0; i < textblockLints.length; i++) {
                            const lint = textblockLints[i]!;

                            decorations.push(
                                Decoration.widget(
                                    textblockPos + textblockNode.nodeSize - 2,
                                    view =>
                                        getOrSetDefaultMapValue(
                                            decorationElementByLintKey,
                                            lint.key,
                                            () => {
                                                const {node: textblockElement} =
                                                    view.domAtPos(textblockPos);
                                                const fromDom = view.domAtPos(lint.from);
                                                const toDom = view.domAtPos(lint.to);

                                                assert(textblockElement instanceof HTMLElement);

                                                // In development environments, make sure our textblock element has
                                                // `position: relative` otherwise our `position: absolute` spellcheck lints won't
                                                // be positioned properly.
                                                if (process.env.NODE_ENV === "development") {
                                                    assert(
                                                        getComputedStyle(textblockElement)
                                                            .position === "relative",
                                                        "Textblock element must have `position: relative` so spell check lints are positioned properly",
                                                    );
                                                }

                                                // TODO(#spell-check): `fileFloat` needs to update positions I think. Maybe use a
                                                // `ResizeObserver` to generically handle changes?
                                                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/fxdw9nnf37gs76cf63c39gjym8

                                                const textblockRect =
                                                    textblockElement.getBoundingClientRect();

                                                const range = document.createRange();
                                                range.setStart(fromDom.node, fromDom.offset);
                                                range.setEnd(toDom.node, toDom.offset);

                                                // TODO(#spell-check) Positions when a mention has text BEFORE it are not right
                                                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/a2rt03qqb7ncn7ca7d456aqfb0
                                                const rangeRects = range.getClientRects();

                                                const element = document.createElement("span");
                                                element.className =
                                                    contentStyles.spellCheckClassName;

                                                for (const rangeRect of rangeRects) {
                                                    const rectElement =
                                                        document.createElement("span");
                                                    element.appendChild(rectElement);

                                                    switch (lint.category) {
                                                        case "grammar":
                                                            rectElement.className = `${contentStyles.spellCheckSquiggleClassName} ${contentStyles.spellCheckGrammarSquiggleClassName}`;
                                                            break;
                                                        case "spelling":
                                                            rectElement.className = `${contentStyles.spellCheckSquiggleClassName} ${contentStyles.spellCheckSpellingSquiggleClassName}`;
                                                            break;
                                                        case "formatting":
                                                            rectElement.className = `${contentStyles.spellCheckSquiggleClassName} ${contentStyles.spellCheckFormattingSquiggleClassName}`;
                                                            break;
                                                        default:
                                                            throw exhaustive(lint.category);
                                                    }

                                                    rectElement.style.width = `${rangeRect.width}px`;
                                                    rectElement.style.left = `${
                                                        rangeRect.left - textblockRect.left
                                                    }px`;

                                                    // Perfectly align the squiggle inside the selection box. First we position based
                                                    // on the text box (which is different from how Chrome renders selections) then
                                                    // adjust so the bottom of our squiggle is up against the bottom of the selection
                                                    // highlight in Chrome.
                                                    const top =
                                                        rangeRect.bottom - textblockRect.top;
                                                    rectElement.style.top = `calc(${top}px + ${contentStyles.inlineBackgroundPadding.bottom} - ${contentStyles.spellCheckSquiggleHeightRem}rem)`;
                                                }

                                                // Expando property ProseMirror checks (we added this property in a
                                                // `prosemirror-view` patch). This element is absolutely positioned so
                                                // ProseMirror has a bad time if it tries to use the element to figure out
                                                // pixel position assuming it's a `display: inline` element that's not
                                                // absolutely positioned.
                                                //
                                                // @ts-expect-error
                                                element.pmIgnoreForCoords = true;

                                                return element;
                                            },
                                        ),
                                    // Ensure the widget is placed "before" the cursor position so typing works at the
                                    // end of content after a mention.
                                    {side: -1},
                                ),
                            );
                        }
                    }
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}

export function getContentEditorSpellCheckerLints(
    state: EditorState,
): ReadonlyArray<ContentSpellCheckLint> {
    return contentEditorSpellCheckerPluginKey.getState(state)?.lints ?? emptyArray;
}

export function setContentEditorSpellCheckerLints(
    transaction: Transaction,
    lints: ReadonlyArray<ContentSpellCheckLint>,
): Transaction {
    return transaction.setMeta(contentEditorSpellCheckerPluginKey, lints);
}
