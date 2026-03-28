import {Node} from "prosemirror-model";
import {EditorState, Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet} from "prosemirror-view";
import {contentStyles} from "~/client/web/styles/styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    CalendarDateParserFormat,
    CalendarDateParserMatch,
    parseCalendarDates,
} from "~/shared/helpers/date/parse_calendar_dates.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";

export type ContentEditorDateDecorationMatch = {
    readonly from: number;
    readonly to: number;
    readonly date: string;
    readonly format: CalendarDateParserFormat;
    readonly originalText: string;
};

type ContentEditorDateDecorationState = {
    readonly decorations: DecorationSet;
    readonly matches: ReadonlyArray<ContentEditorDateDecorationMatch>;
    readonly isPointerTransaction: boolean;
};

const contentEditorDateDecorationPluginKey = new PluginKey<ContentEditorDateDecorationState>(
    "contentEditorDateDecoration",
);

/** Returns all date decoration matches for the current editor state. */
export function getContentEditorDateDecorationMatches(
    state: EditorState,
): ReadonlyArray<ContentEditorDateDecorationMatch> {
    return contentEditorDateDecorationPluginKey.getState(state)?.matches ?? [];
}

/**
 * Returns the date decoration match at the given ProseMirror position, if any.
 */
export function getContentEditorDateMatchAtPos(
    state: EditorState,
    pos: number,
): ContentEditorDateDecorationMatch | undefined {
    const matches = getContentEditorDateDecorationMatches(state);
    return matches.find(match => pos >= match.from && pos <= match.to);
}

/**
 * Represents a date match detected within a textblock, with offsets relative to
 * the start of the textblock's text content. The `createReducer` callback caches
 * these per node; the reducer adjusts offsets to document positions.
 */
type TextblockDateMatch = {
    readonly textStart: number;
    readonly textEnd: number;
    readonly match: CalendarDateParserMatch;
    readonly offsets: ReadonlyArray<{
        nodeStart: number;
        textStart: number;
        length: number;
    }>;
};

/**
 * Scans a textblock node for dates, returning offset-relative matches that can be
 * cached. The expensive regex work happens here and is cached by the incremental
 * reducer's WeakMap.
 */
function scanTextblockNode(node: Node): ReadonlyArray<TextblockDateMatch> | null {
    let textContent = "";
    // Store child offsets relative to the node (not the document) so the result is
    // position-independent and cacheable.
    const offsets: Array<{
        nodeStart: number;
        textStart: number;
        length: number;
    }> = [];

    node.forEach((child, childOffset) => {
        if (child.isText) {
            offsets.push({
                // nodeStart is relative to the textblock's content start (offset 0 = first child).
                // We'll add the document offset in the reducer.
                nodeStart: childOffset,
                textStart: textContent.length,
                length: assertExists(child.text).length,
            });

            textContent += assertExists(child.text);
        } else {
            textContent += " ";
        }
    });

    if (textContent.length === 0) return null;

    const textMatches = parseCalendarDates(textContent, new Date().getFullYear());
    if (textMatches.length === 0) return null;

    const results: Array<TextblockDateMatch> = [];

    for (const match of textMatches) {
        // Verify the match spans a contiguous text range (doesn't cross inline node
        // boundaries).
        let contiguous = false;
        for (const offset of offsets) {
            if (match.start >= offset.textStart && match.end <= offset.textStart + offset.length) {
                contiguous = true;
                break;
            }
        }

        if (!contiguous) continue;

        results.push({textStart: match.start, textEnd: match.end, match, offsets});
    }

    return results.length > 0 ? results : null;
}

/**
 * Converts a text offset to a position relative to the textblock content start.
 */
function textOffsetToNodeRelativePos(
    offsets: ReadonlyArray<{
        nodeStart: number;
        textStart: number;
        length: number;
    }>,
    textOffset: number,
): number | undefined {
    for (const offset of offsets) {
        if (textOffset >= offset.textStart && textOffset <= offset.textStart + offset.length) {
            return offset.nodeStart + (textOffset - offset.textStart);
        }
    }

    return undefined;
}

function buildDecorations(
    doc: Node,
    matches: ReadonlyArray<ContentEditorDateDecorationMatch>,
    cursorPos: number,
    isPointerTransaction: boolean,
): DecorationSet {
    const decorations: Array<Decoration> = [];

    for (const match of matches) {
        const isActive = cursorPos > match.from && cursorPos < match.to;
        const isKeyboard = isActive && !isPointerTransaction;

        let className = contentStyles.dateDecorationClassName;
        if (isKeyboard) {
            className += ` ${contentStyles.dateDecorationActiveClassName}`;
        } else if (isActive) {
            className += ` ${contentStyles.dateDecorationActiveClassName}`;
        }

        decorations.push(Decoration.inline(match.from, match.to, {class: className}));

        if (isKeyboard) {
            // Resolve the textblock node containing this date to determine line height for
            // positioning the hint below.
            const $pos = doc.resolve(match.from);
            const parentNode = $pos.parent;
            const nodeName = parentNode.type.name;
            let hintTop: string;

            switch (nodeName) {
                case "heading1":
                    hintTop = "2.75rem";
                    break;
                case "heading2":
                    hintTop = "2.25rem";
                    break;
                case "heading3":
                    hintTop = "1.75rem";
                    break;
                default:
                    hintTop = "0.5rem";
                    break;
            }

            decorations.push(
                Decoration.widget(
                    match.from,
                    () => {
                        const wrapper = document.createElement("span");
                        wrapper.className = contentStyles.dateDecorationHintWrapperClassName;
                        // @ts-expect-error — ProseMirror reads this non-standard DOM
                        // property to skip the element in `coordsAtPos` calculations,
                        // preventing the hint widget from affecting cursor positioning.
                        wrapper.pmIgnoreForCoords = true;

                        const hint = document.createElement("span");
                        hint.className = contentStyles.dateDecorationHintClassName;
                        hint.textContent = "Press enter to edit";
                        hint.style.top = hintTop;

                        wrapper.appendChild(hint);
                        return wrapper;
                    },
                    {side: -1},
                ),
            );
        }
    }

    return DecorationSet.create(doc, decorations);
}

/**
 * ProseMirror plugin that detects dates in plain text and creates inline
 * decorations for them. Shows a dotted underline when the cursor is inside a date
 * range.
 *
 * Uses `createProsemirrorIncrementalReducer` to cache date detection results per
 * textblock node. When the document changes, only textblocks whose node reference
 * changed (due to ProseMirror's structural sharing) are rescanned.
 */
export function contentEditorDateDecorationPlugin(): Plugin {
    const scanMatches = createProsemirrorIncrementalReducer<
        Array<ContentEditorDateDecorationMatch>
    >(node => {
        if (!node.isTextblock) return null;

        const textblockMatches = scanTextblockNode(node);
        if (!textblockMatches) return null;

        return (matches, _doc, offset) => {
            // `offset` is the position of the textblock node itself. Content starts at
            // offset + 1.
            const contentStart = offset + 1;

            for (const tbMatch of textblockMatches) {
                const from = textOffsetToNodeRelativePos(tbMatch.offsets, tbMatch.textStart);
                const to = textOffsetToNodeRelativePos(tbMatch.offsets, tbMatch.textEnd);

                if (from === undefined || to === undefined) continue;

                matches.push({
                    from: contentStart + from,
                    to: contentStart + to,
                    date: tbMatch.match.date.toString(),
                    format: tbMatch.match.format,
                    originalText: tbMatch.match.originalText,
                });
            }

            return matches;
        };
    });

    return new Plugin<ContentEditorDateDecorationState>({
        key: contentEditorDateDecorationPluginKey,

        state: {
            init(_config, state) {
                const matches = scanMatches([], state.doc);
                return {
                    matches,
                    isPointerTransaction: false,
                    decorations: buildDecorations(state.doc, matches, state.selection.from, false),
                };
            },
            apply(tr, oldState, _oldEditorState, newEditorState) {
                const matches = tr.docChanged
                    ? scanMatches([], newEditorState.doc)
                    : oldState.matches;

                // Track whether this transaction was initiated by a pointer event. ProseMirror
                // sets this meta on mouse-initiated selection changes.
                const uiEvent = tr.getMeta("uiEvent");

                const isPointer =
                    uiEvent === "select" || uiEvent === "pointer"
                        ? true
                        : uiEvent === "key"
                          ? false
                          : oldState.isPointerTransaction;

                return {
                    matches,
                    isPointerTransaction: isPointer,
                    decorations: buildDecorations(
                        newEditorState.doc,
                        matches,
                        newEditorState.selection.from,
                        isPointer,
                    ),
                };
            },
        },

        props: {
            decorations(state) {
                return (
                    contentEditorDateDecorationPluginKey.getState(state)?.decorations ??
                    DecorationSet.empty
                );
            },
        },
    });
}
