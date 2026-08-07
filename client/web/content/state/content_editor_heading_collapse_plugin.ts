import {Node} from "prosemirror-model";
import {EditorState, Plugin, PluginKey, TextSelection} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {contentStyles} from "~/client/web/styles/styles.js";
import {
    ContentHeadingSection,
    getContentHeadingSections,
} from "~/shared/content/get_content_heading_sections.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";

type ContentEditorHeadingCollapseState = {
    /**
     * Positions of the top-level heading nodes whose sections are currently collapsed.
     * Positions are remapped as the doc changes.
     */
    readonly collapsedHeadingPositions: ReadonlySet<number>;

    /** Node decorations hiding the blocks of every collapsed section. */
    readonly decorations: DecorationSet;
};

const contentEditorHeadingCollapsePluginKey = new PluginKey<ContentEditorHeadingCollapseState>(
    "contentEditorHeadingCollapse",
);

type ContentEditorHeadingCollapseMeta =
    | {
          /**
           * Toggle the collapsed state of the section under the heading at `headingPos`.
           */
          readonly type: "Toggle";
          readonly headingPos: number;
      }
    | {
          /** Expand every collapsed section containing the doc position `pos`. */
          readonly type: "ExpandAt";
          readonly pos: number;
      };

/**
 * Plugin that lets the user collapse the section under a heading. Collapsing a
 * heading hides every block after it up to the next heading with the same or a
 * higher level (see `getContentHeadingSections()`).
 *
 * TODO(#heading-ids): Collapsed state is intentionally ephemeral. It lives in this
 * plugin's state so it resets on reload or navigation and isn't shared with
 * collaborators, and it identifies headings by position, so it can't survive a
 * round trip through a URL or the database. We traded persistence for speed of
 * implementation. The durable design is to add stable IDs to heading nodes in the
 * content schema: IDs would give collapse state an identity we could store
 * per-account (storing a collapsed flag on the heading attrs instead would write
 * one user's collapse into the shared document for every collaborator, which we
 * don't want). Build heading IDs when someone asks for persisted collapse state or
 * rename-proof heading links — the `Heading` variant of
 * `DocumentContentEditorInitialScroll` documents the same tradeoff for links.
 */
export function contentEditorHeadingCollapsePlugin(): Plugin<ContentEditorHeadingCollapseState> {
    return new Plugin<ContentEditorHeadingCollapseState>({
        key: contentEditorHeadingCollapsePluginKey,

        state: {
            init() {
                return {collapsedHeadingPositions: emptySet, decorations: DecorationSet.empty};
            },
            // Performance: while nothing is collapsed this is a couple of cheap checks (the
            // empty-set early return below). While a section is collapsed, each transaction
            // does one `getContentHeadingSections()` pass — a single walk over the doc's
            // top-level children whose only per-heading work is slugifying its short text. We
            // deliberately don't use `createProsemirrorIncrementalReducer` here: it pays off
            // when the per-node work is expensive enough to cache (e.g. the date decoration
            // plugin's regex scans), but section ranges and slug dedup suffixes are global
            // properties that shift with almost any doc change, so caching per-node results
            // would save close to nothing.
            //
            // Collaboration behavior: remote steps flow through this same `apply()`, so
            // another account editing inside, before, or around a collapsed section remaps the
            // collapsed positions and recomputes the hidden ranges just like local edits do.
            apply(tr, oldState, _oldEditorState, newEditorState) {
                const meta: ContentEditorHeadingCollapseMeta | null =
                    tr.getMeta(contentEditorHeadingCollapsePluginKey) ?? null;
                const toggledHeadingPos = meta?.type === "Toggle" ? meta.headingPos : null;

                let collapsedHeadingPositions = oldState.collapsedHeadingPositions;

                // Remap collapsed heading positions through doc changes. Drop headings that were
                // deleted or replaced by another kind of node.
                if (tr.docChanged && collapsedHeadingPositions.size > 0) {
                    const remapped = new Set<number>();
                    for (const headingPos of collapsedHeadingPositions) {
                        const mapResult = tr.mapping.mapResult(headingPos);
                        if (mapResult.deleted) continue;
                        if (!isHeadingAt(newEditorState.doc, mapResult.pos)) continue;
                        remapped.add(mapResult.pos);
                    }
                    collapsedHeadingPositions = remapped;
                }

                if (toggledHeadingPos !== null) {
                    const toggled = new Set(collapsedHeadingPositions);
                    if (toggled.has(toggledHeadingPos)) {
                        toggled.delete(toggledHeadingPos);
                    } else if (isHeadingAt(newEditorState.doc, toggledHeadingPos)) {
                        toggled.add(toggledHeadingPos);
                    }
                    collapsedHeadingPositions = toggled;
                }

                if (collapsedHeadingPositions.size === 0) {
                    return {
                        collapsedHeadingPositions: emptySet,
                        decorations: DecorationSet.empty,
                    };
                }

                const sections = getContentHeadingSections(newEditorState.doc);

                // Expand a section automatically in two cases:
                //
                // - The selection moved inside its hidden content, so the user never types into
                //   invisible blocks. Only a selection _fully inside_ the section counts: a
                //   selection that merely spans the collapsed section (select all, shift clicking
                //   from before it to after it, ...) leaves it collapsed, and copying that
                //   selection still copies the hidden blocks since ProseMirror serializes the
                //   selected slice of the doc, not the visible DOM.
                // - An `ExpandAt` meta asked us to reveal a doc position, e.g. scrolling to a
                //   comment inside a collapsed section.
                const expandAtPos = meta?.type === "ExpandAt" ? meta.pos : null;
                const {from, to} = newEditorState.selection;
                let expanded: Set<number> | null = null;
                for (const section of sections) {
                    if (!collapsedHeadingPositions.has(section.headingPos)) continue;
                    // Don't immediately undo the collapse we're applying in this very transaction.
                    // `toggleContentEditorHeadingCollapsed()` moves the selection out of the section
                    // instead.
                    if (section.headingPos === toggledHeadingPos) continue;
                    const containsExpandAtPos =
                        expandAtPos !== null &&
                        expandAtPos >= section.sectionFrom &&
                        expandAtPos < section.sectionTo;
                    const containsSelection =
                        from >= section.sectionFrom &&
                        to <= section.sectionTo &&
                        to > section.sectionFrom;
                    if (containsExpandAtPos || containsSelection) {
                        expanded ??= new Set(collapsedHeadingPositions);
                        expanded.delete(section.headingPos);
                    }
                }

                // If there was a transaction that moved the selection into a collapsed section,
                // `expanded` will be non-null and will have the same collapsed headings as the old
                // state minus the heading that was toggled.
                if (expanded) collapsedHeadingPositions = expanded;

                if (
                    !tr.docChanged &&
                    collapsedHeadingPositions === oldState.collapsedHeadingPositions
                ) {
                    return oldState;
                }

                return {
                    collapsedHeadingPositions,
                    decorations: buildDecorations(
                        newEditorState.doc,
                        sections,
                        collapsedHeadingPositions,
                    ),
                };
            },
        },

        props: {
            decorations(state) {
                return (
                    contentEditorHeadingCollapsePluginKey.getState(state)?.decorations ??
                    DecorationSet.empty
                );
            },
        },
    });
}

/**
 * The positions of the top-level headings whose sections are currently collapsed.
 * Empty when the state doesn't have the heading collapse plugin.
 */
export function getCollapsedContentEditorHeadingPositions(state: EditorState): ReadonlySet<number> {
    return (
        contentEditorHeadingCollapsePluginKey.getState(state)?.collapsedHeadingPositions ?? emptySet
    );
}

/**
 * Collapse or expand the section under the heading at `headingPos`.
 */
export function toggleContentEditorHeadingCollapsed(view: EditorView, headingPos: number): void {
    const {state} = view;
    const headingNode = state.doc.nodeAt(headingPos);
    assert(
        headingNode !== null && headingNode.type.name === "heading",
        "Expected a heading node at the toggled position.",
    );

    const meta: ContentEditorHeadingCollapseMeta = {type: "Toggle", headingPos};
    const tr = state.tr.setMeta(contentEditorHeadingCollapsePluginKey, meta);

    // When collapsing a section around the selection, move the selection to the end of
    // the heading so the user doesn't keep typing into invisible content. Same
    // containment rule as the plugin's automatic expansion: a selection that merely
    // spans the collapsed section stays where it is.
    if (!isContentEditorHeadingCollapsed(state, headingPos)) {
        const section = getContentHeadingSections(state.doc).find(
            section => section.headingPos === headingPos,
        );
        const {from, to} = state.selection;
        if (
            section &&
            from >= section.sectionFrom &&
            to <= section.sectionTo &&
            to > section.sectionFrom
        ) {
            tr.setSelection(TextSelection.create(state.doc, headingPos + headingNode.nodeSize - 1));
        }
    }

    view.dispatch(tr);
}

/**
 * Expand every collapsed section containing the doc position `pos`, e.g. to reveal
 * a comment mark inside a collapsed section before scrolling to it. Dispatches
 * nothing when `pos` isn't inside a collapsed section.
 */
export function expandContentEditorHeadingSectionsAtPos(view: EditorView, pos: number): void {
    const {state} = view;
    const collapsedHeadingPositions = getCollapsedContentEditorHeadingPositions(state);
    if (collapsedHeadingPositions.size === 0) return;

    const isPosHidden = getContentHeadingSections(state.doc).some(
        section =>
            collapsedHeadingPositions.has(section.headingPos) &&
            pos >= section.sectionFrom &&
            pos < section.sectionTo,
    );
    if (!isPosHidden) return;

    const meta: ContentEditorHeadingCollapseMeta = {type: "ExpandAt", pos};
    view.dispatch(state.tr.setMeta(contentEditorHeadingCollapsePluginKey, meta));
}

function isHeadingAt(doc: Node, pos: number): boolean {
    return doc.nodeAt(pos)?.type.name === "heading";
}

function buildDecorations(
    doc: Node,
    sections: ReadonlyArray<ContentHeadingSection>,
    collapsedHeadingPositions: ReadonlySet<number>,
): DecorationSet {
    const collapsedSections = sections.filter(section =>
        collapsedHeadingPositions.has(section.headingPos),
    );
    if (collapsedSections.length === 0) return DecorationSet.empty;

    const decorations: Array<Decoration> = [];

    // Mark collapsed headings so styles and tests can tell them apart from expanded
    // ones.
    for (const section of collapsedSections) {
        decorations.push(
            Decoration.node(section.headingPos, section.headingPos + section.headingNode.nodeSize, {
                "data-collapsed": "true",
            }),
        );
    }

    // Hide every top-level block inside a collapsed section. Sections can nest so a
    // block may be covered by several collapsed sections; one decoration is enough.
    doc.forEach((child, offset) => {
        const isHidden = collapsedSections.some(
            section => offset >= section.sectionFrom && offset < section.sectionTo,
        );
        if (isHidden) {
            decorations.push(
                Decoration.node(offset, offset + child.nodeSize, {
                    class: contentStyles.headingSectionCollapsedHiddenClassName,
                }),
            );
        }
    });

    return DecorationSet.create(doc, decorations);
}

/**
 * Is the section under the heading at `headingPos` currently collapsed?
 */
function isContentEditorHeadingCollapsed(state: EditorState, headingPos: number): boolean {
    return getCollapsedContentEditorHeadingPositions(state).has(headingPos);
}
