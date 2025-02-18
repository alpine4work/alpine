/**
 * NOTE(rohitt-gupta, 2024-11-26): This file combines the table editing plugin
 * and column resizing plugin from `prosemirror-tables`. has been modified to
 * remove features we don't use and customize the user experience. You can find
 * the original files in the `prosemirror-tables` package at:
 *
 * - https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/index.ts
 * - https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/columnresizing.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// Comment from `prosemirror-tables` `src/index.ts` file:
//
// This file defines a plugin that handles the drawing of cell
// selections and the basic user interactions for creating and working
// with such selections. It also makes sure that, after each
// transaction, the shapes of tables are normalized to be rectangular
// and not contain overlapping cells.

import {Node, ResolvedPos} from "prosemirror-model";
import {Command, EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {updateContentTableColumnsOnResize} from "~/client/content/internal/table/content_editor_table_node_view.js";
import {contentTableCellAround} from "~/client/content/internal/table/content_table_client_util.js";
import {selectContentTableRow} from "~/client/content/internal/table/content_table_commands.js";
import {fixContentTables} from "~/client/content/internal/table/content_table_fix_tables.js";
import {handleContentTableKeyDown} from "~/client/content/internal/table/content_table_input.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/content/content_styles.js";
import {
    ContentTableCellSelection,
    normalizeContentTableCellSelection,
} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {
    inSameContentTable,
    pointsAtContentTableCell,
} from "~/shared/content/table/content_table_shared_util.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

const contentEditorTablePluginKey = new PluginKey<ContentEditorTablePluginState>(
    "contentEditorTable",
);

/**
 * Creates a [plugin](http://prosemirror.net/docs/ref/#state.Plugin)
 * that, when added to an editor, enables cell-selection, handles
 * cell-based copy/paste, and makes sure tables stay well-formed (each
 * row has the same width, and cells don't overlap).
 *
 * You should probably put this plugin near the end of your array of
 * plugins, since it handles mouse and arrow key events in tables
 * rather broadly, and other plugins, like the gap cursor or the
 * column-width dragging plugin, might want to get a turn first to
 * perform more specific behavior.
 *
 * This is a combination of `prosemirror-table`'s `tableEditing()` plugin and
 * `columnResizing()` plugin.
 *
 * How column resizing works: This plugin sets up event handlers for mouse
 * events related to column resizing. When the user clicks and drags on a
 * column border, the handleMouseDown function is called, which initiates the
 * column resizing process. As the user drags the mouse, the move function is
 * called repeatedly, updating the column width based on the mouse position.
 * When the user releases the mouse button, the finish function is called,
 * which commits the column width changes.
 */
export function contentEditorTablePlugin(): Plugin {
    const elementCache = createContentEditorTablePluginDecorationElementCache();

    const plugin = new Plugin<ContentEditorTablePluginState>({
        key: contentEditorTablePluginKey,
        state: {
            init() {
                return new ContentEditorTablePluginState(null, null);
            },
            apply(tr, prev) {
                return prev.apply(tr);
            },
        },
        appendTransaction: (transactions, oldState, state) => {
            return normalizeContentTableCellSelection(state, fixContentTables(state, oldState));
        },
        props: {
            handleDOMEvents: {
                mousemove: (view, event) => {
                    handleMouseMove(view, event);
                },
                mouseleave: view => {
                    handleMouseLeave(view);
                },
                mousedown: (view, event) => {
                    handleMouseDown(view, event);
                },
            },

            handleKeyDown: handleContentTableKeyDown,

            createSelectionBetween: view => {
                return contentEditorTablePluginKey.getState(view.state)
                    ?.draggingSelectionStartCellPos != null
                    ? view.state.selection
                    : null;
            },

            decorations: state => {
                const pluginState = contentEditorTablePluginKey.getState(state)!;

                let decorations = DecorationSet.empty;

                decorations = drawContentEditorTableCellSelection(state, decorations);

                if (pluginState.active !== null) {
                    decorations = drawContentEditorTablePluginActiveStateDecorations(
                        elementCache,
                        state,
                        pluginState.active,
                        decorations,
                    );
                }

                return decorations;
            },
        },
    });
    return plugin;
}

type ContentEditorTablePluginAction =
    | {
          readonly type: "ClearDraggingSelectionStartCellPos";
      }
    | {
          readonly type: "SetDraggingSelectionStartCellPos";
          readonly pos: number;
      }
    | {
          readonly type: "ClearActive";
      }
    | {
          readonly type: "SetActiveColumnResizeHandle";
          readonly cellPos: number;
      }
    | {
          readonly type: "SetActiveColumnResizeHandleDragging";
          readonly dragging: {
              readonly startX: number;
              readonly viewWithoutPaddingWidthPx: number;
              readonly oldTotalColumnWidthPx: number;
              readonly oldScrollLeftPx: number;
              readonly isSnapping: boolean;
              readonly state: ContentEditorTablePluginColumnResizeHandleDraggingState;
          } | null;
      }
    | {
          readonly type: "SetActiveColumnResizeHandleIsSnapping";
          readonly isSnapping: boolean;
      }
    | {
          readonly type: "SetActiveRowGrip";
          readonly cellPos: number;
      };

function dispatchContentEditorTablePluginAction(action: ContentEditorTablePluginAction): Command {
    return (state, dispatch) => {
        dispatch?.(state.tr.setMeta(contentEditorTablePluginKey, action));
        return true;
    };
}

type ContentEditorTablePluginActiveState =
    | {
          readonly type: "ColumnResizeHandle";
          readonly cellPos: number;
          readonly dragging: {
              readonly startX: number;
              readonly viewWithoutPaddingWidthPx: number;
              readonly oldTotalColumnWidthPx: number;
              readonly oldScrollLeftPx: number;
              readonly isSnapping: boolean;
              readonly state: ContentEditorTablePluginColumnResizeHandleDraggingState;
          } | null;
      }
    | {
          readonly type: "RowGrip";
          readonly cellPos: number;
          readonly dragging: null;
      };

type ContentEditorTablePluginColumnResizeHandleDraggingState = {
    readonly tablePos: number;
    readonly oldTable: Node;
    readonly oldTableMap: ContentTableMap;
    readonly columnIndex: number;
    readonly getTableElement: (view: EditorView) => HTMLTableElement | null;
};

function getContentEditorTablePluginColumnResizeHandleDraggingState(
    doc: Node,
    cellPos: number,
): ContentEditorTablePluginColumnResizeHandleDraggingState {
    const $cell = doc.resolve(cellPos);

    let tablePos: number;
    let table: Node;
    let tableMap: ContentTableMap;
    let columnIndex: number;

    if ($cell.parent.type.name === "table") {
        tablePos = $cell.start();
        table = $cell.node();
        tableMap = ContentTableMap.get(table);
        columnIndex = -1;
    } else {
        assert($cell.parent.type.name === "tableRow");

        tablePos = $cell.start(-1);
        table = $cell.node(-1);
        tableMap = ContentTableMap.get(table);
        columnIndex = tableMap.getColumnCount($cell.pos - tablePos);
    }

    let tableElement: HTMLTableElement | null = null;

    return {
        tablePos,
        oldTable: table,
        oldTableMap: tableMap,
        columnIndex,
        getTableElement: (view: EditorView) => {
            if (tableElement === null) {
                let element: globalThis.Node | null = view.domAtPos(tablePos).node;
                while (element && element.nodeName != "TABLE") element = element.parentNode;

                tableElement = element as HTMLTableElement | null;
            }

            return tableElement;
        },
    };
}

class ContentEditorTablePluginState {
    public readonly draggingSelectionStartCellPos: number | null;
    public readonly active: ContentEditorTablePluginActiveState | null;

    constructor(
        draggingSelectionStartCellPos: number | null,
        active: ContentEditorTablePluginActiveState | null,
    ) {
        this.draggingSelectionStartCellPos = draggingSelectionStartCellPos;
        this.active = active;
    }

    // Applies the transaction to update the resizing state
    apply(tr: Transaction): ContentEditorTablePluginState {
        let state: ContentEditorTablePluginState = this;

        if (tr.docChanged) {
            // Update dragging selection start position when the doc changes.
            if (tr.docChanged && state.draggingSelectionStartCellPos !== null) {
                const {deleted, pos} = tr.mapping.mapResult(state.draggingSelectionStartCellPos);

                state = new ContentEditorTablePluginState(deleted ? null : pos, state.active);
            }

            // Update active cell position when the doc changes.
            if (tr.docChanged && state.active !== null) {
                let cellPos: number | null = tr.mapping.map(state.active.cellPos, -1);
                if (!pointsAtContentTableCell(tr.doc.resolve(cellPos))) {
                    cellPos = null;
                }

                state = new ContentEditorTablePluginState(
                    state.draggingSelectionStartCellPos,
                    cellPos !== null ? {...state.active, cellPos: cellPos} : null,
                );
            }

            // Update dragging state when the doc changes.
            if (state.active?.type === "ColumnResizeHandle" && state.active.dragging) {
                state = new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, {
                    ...state.active,
                    dragging: {
                        ...state.active.dragging,
                        state: getContentEditorTablePluginColumnResizeHandleDraggingState(
                            tr.doc,
                            state.active.cellPos,
                        ),
                    },
                });
            }
        }

        const action: ContentEditorTablePluginAction | null | undefined = tr.getMeta(
            contentEditorTablePluginKey,
        );
        if (!action) return state;

        switch (action.type) {
            case "ClearDraggingSelectionStartCellPos": {
                return new ContentEditorTablePluginState(null, state.active);
            }
            case "SetDraggingSelectionStartCellPos": {
                return new ContentEditorTablePluginState(action.pos, state.active);
            }
            case "ClearActive": {
                return new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, null);
            }
            case "SetActiveColumnResizeHandle": {
                return new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, {
                    type: "ColumnResizeHandle",
                    cellPos: action.cellPos,
                    dragging: null,
                });
            }
            case "SetActiveColumnResizeHandleDragging": {
                if (state.active?.type !== "ColumnResizeHandle") return state;

                return new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, {
                    ...state.active,
                    dragging: action.dragging,
                });
            }
            case "SetActiveColumnResizeHandleIsSnapping": {
                if (state.active?.type !== "ColumnResizeHandle") return state;
                if (!state.active.dragging) return state;

                return new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, {
                    ...state.active,
                    dragging: {
                        ...state.active.dragging,
                        isSnapping: action.isSnapping,
                    },
                });
            }
            case "SetActiveRowGrip": {
                return new ContentEditorTablePluginState(state.draggingSelectionStartCellPos, {
                    type: "RowGrip",
                    cellPos: action.cellPos,
                    dragging: null,
                });
            }
            default:
                throw exhaustive(action);
        }
    }
}

// Handles mouse movement to update the active column handle
function handleMouseMove(view: EditorView, event: MouseEvent): void {
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (!pluginState) return;
    if (pluginState?.draggingSelectionStartCellPos !== null) return;
    if (pluginState.active?.dragging) return;

    // If the user is pressing their mouse while moving over the resize handle then
    // we don't show the resize handle. e.g. If the user is clicking in a cell and
    // dragging to select cells.
    if (event.which) return;

    const targetElement = event.target as HTMLElement;

    let cellPos: number | null = null;
    if (
        pluginState.active !== null &&
        (targetElement.classList.contains(contentStyles.tableColumnResizeHandleClassName) ||
            targetElement.classList.contains(contentStyles.tableRowGrip2ClassName))
    ) {
        cellPos = pluginState.active.cellPos;
    } else {
        const spacingScale = getSpacingScaleWithoutListening();

        const halfColumnResizeHandleWidth =
            Math.floor(
                convertRemLengthToPx(contentStyles.tableColumnResizeHandleWidth, spacingScale) / 2,
            ) -
            // Subtract 1px to avoid subpixel rendering edge cases where we think we're
            // hovering over the resize handle but the DOM element doesn't actually cover
            // the pixel.
            1;

        const cellTargetElement = getContentTableCellElementAround(targetElement);
        if (cellTargetElement) {
            const {left, right} = cellTargetElement.getBoundingClientRect();
            if (event.clientX - left <= halfColumnResizeHandleWidth) {
                cellPos = getEdgeContentTableCell(view, event, "left", halfColumnResizeHandleWidth);
            } else if (right - event.clientX <= halfColumnResizeHandleWidth) {
                cellPos = getEdgeContentTableCell(
                    view,
                    event,
                    "right",
                    halfColumnResizeHandleWidth,
                );
            }
        } else {
            const tableTargetElement = getContentTableElementAround(targetElement);
            if (tableTargetElement) {
                const {left, right} = tableTargetElement.getBoundingClientRect();

                // This case occurs when the mouse is outside the table and approaching the
                // left edge.
                if (event.clientX <= left && left - event.clientX <= halfColumnResizeHandleWidth) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "left",
                        halfColumnResizeHandleWidth,
                    );
                }
                // This case occurs when the mouse is outside the table and approaching the
                // right edge.
                else if (
                    event.clientX >= right &&
                    event.clientX - right <= halfColumnResizeHandleWidth
                ) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "right",
                        halfColumnResizeHandleWidth,
                    );
                }
            }
        }
    }

    if (cellPos !== (pluginState.active?.cellPos ?? null)) {
        if (cellPos === null) {
            dispatchContentEditorTablePluginAction({type: "ClearActive"})(
                view.state,
                view.dispatch,
            );
        } else {
            const $cell = view.state.doc.resolve(cellPos);

            // If we're hovering the left edge of the table then the parent of `$cell` will
            // be `table` instead of `tableRow`.
            if ($cell.parent.type.name === "table") {
                dispatchContentEditorTablePluginAction({
                    type: "SetActiveRowGrip",
                    cellPos,
                })(view.state, view.dispatch);
            } else {
                assert($cell.parent.type.name === "tableRow");

                dispatchContentEditorTablePluginAction({
                    type: "SetActiveColumnResizeHandle",
                    cellPos,
                })(view.state, view.dispatch);
            }
        }
    }
}

// Handles mouse leave event to reset the active handle
function handleMouseLeave(view: EditorView): void {
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (pluginState && pluginState.active !== null && pluginState.active.dragging === null) {
        dispatchContentEditorTablePluginAction({type: "ClearActive"})(view.state, view.dispatch);
    }
}

// Initiates the column resizing process on mouse down
function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
    if (handleCellSelectionMouseDown(view, event)) return true;

    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (!pluginState || !pluginState.active || pluginState.active?.dragging) {
        return false;
    }

    switch (pluginState.active.type) {
        case "ColumnResizeHandle":
            return handleActiveColumnResizeHandleMouseDown(view, event);
        case "RowGrip":
            return handleActiveRowGripHandleMouseDown(view, event);
        default:
            throw exhaustive(pluginState.active);
    }
}

// Handle mouse down event for table, responsible for creating a cell selection
// when the user drags over a cell
//
// Originally, this function is from `prosemirror-tables`'s `src/input.ts`
// file.
function handleCellSelectionMouseDown(view: EditorView, startEvent: MouseEvent): boolean {
    if (startEvent.ctrlKey || startEvent.metaKey) return false;

    // if the user is resizing a column, don't create a cell selection
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (pluginState?.active) return false;

    const startDOMCell = getContentTableCellElementAround(startEvent.target as HTMLElement);
    let $anchor;
    if (startEvent.shiftKey && view.state.selection instanceof ContentTableCellSelection) {
        // Adding to an existing cell selection
        setCellSelection(view.state.selection.$anchorCell, startEvent);
        startEvent.preventDefault();
    } else if (
        startEvent.shiftKey &&
        startDOMCell &&
        ($anchor = contentTableCellAround(view.state.selection.$anchor)) != null &&
        cellUnderMouse(view, startEvent)?.pos != $anchor.pos
    ) {
        // Adding to a selection that starts in another cell (causing a
        // cell selection to be created).
        setCellSelection($anchor, startEvent);
        startEvent.preventDefault();
    } else if (!startDOMCell) {
        // Not in a cell, let the default behavior happen.
        return false;
    }

    // Create and dispatch a cell selection between the given anchor and
    // the position under the mouse.
    function setCellSelection($anchor: ResolvedPos, event: MouseEvent): void {
        let $head = cellUnderMouse(view, event);
        const starting =
            contentEditorTablePluginKey.getState(view.state)?.draggingSelectionStartCellPos == null;
        if (!$head || !inSameContentTable($anchor, $head)) {
            if (starting) $head = $anchor;
            else return;
        }

        const selection = new ContentTableCellSelection($anchor, $head);
        if (starting || !view.state.selection.eq(selection)) {
            // NOTE(calebmer): UX improvement, empty the DOM selection when we start our
            // cell selection. If we don't have this then in some cases the DOM selection
            // continues moving underneath our cursor as we drag.
            if (starting) window.getSelection()?.empty();

            dispatchContentEditorTablePluginAction({
                type: "SetDraggingSelectionStartCellPos",
                pos: $anchor.pos,
            })(view.state, transaction => {
                transaction.setSelection(selection);
                view.dispatch(transaction);
            });
        }
    }

    // Stop listening to mouse motion events.
    function stop(): void {
        document.removeEventListener("mouseup", stop);
        document.removeEventListener("dragstart", stop);
        document.removeEventListener("mousemove", move);
        if (
            contentEditorTablePluginKey.getState(view.state)?.draggingSelectionStartCellPos != null
        ) {
            dispatchContentEditorTablePluginAction({type: "ClearDraggingSelectionStartCellPos"})(
                view.state,
                view.dispatch,
            );
        }
    }

    function move(event: MouseEvent): void {
        const anchor = contentEditorTablePluginKey.getState(
            view.state,
        )?.draggingSelectionStartCellPos;
        let $anchor;
        if (anchor != null) {
            // Continuing an existing cross-cell selection
            $anchor = view.state.doc.resolve(anchor);
        } else if (getContentTableCellElementAround(event.target as HTMLElement) != startDOMCell) {
            // Moving out of the initial cell -- start a new cell selection
            $anchor = cellUnderMouse(view, startEvent);
            if (!$anchor) return stop();
        }
        if ($anchor) setCellSelection($anchor, event);
    }

    document.addEventListener("mouseup", stop);
    document.addEventListener("dragstart", stop);
    document.addEventListener("mousemove", move);

    return true;
}

// Find the cell under the mouse
function cellUnderMouse(view: EditorView, event: MouseEvent): ResolvedPos | null {
    const mousePos = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
    });
    if (!mousePos) return null;
    return mousePos ? contentTableCellAround(view.state.doc.resolve(mousePos.pos)) : null;
}

function handleActiveColumnResizeHandleMouseDown(view: EditorView, event: MouseEvent): boolean {
    {
        const pluginState = contentEditorTablePluginKey.getState(view.state);
        assert(pluginState?.active?.type === "ColumnResizeHandle");

        const draggingState = getContentEditorTablePluginColumnResizeHandleDraggingState(
            view.state.doc,
            pluginState.active.cellPos,
        );

        const tableElement = draggingState.getTableElement(view);
        if (!tableElement) return false;

        const viewComputedStyle = getComputedStyle(view.dom);

        dispatchContentEditorTablePluginAction({
            type: "SetActiveColumnResizeHandleDragging",
            dragging: {
                startX: event.clientX,
                viewWithoutPaddingWidthPx:
                    view.dom.clientWidth -
                    (parseFloat(viewComputedStyle.paddingLeft) +
                        parseFloat(viewComputedStyle.paddingRight)),
                oldTotalColumnWidthPx: tableElement.offsetWidth,
                oldScrollLeftPx: tableElement.parentElement!.parentElement!.scrollLeft,
                isSnapping: true,
                state: draggingState,
            },
        })(view.state, view.dispatch);
    }

    let lastClientX = event.clientX;

    // Updates the column width as the mouse is moved while dragging
    function move(event: MouseEvent): void {
        lastClientX = event.clientX;

        if (!event.which) {
            finish();
            return;
        }

        const pluginState = contentEditorTablePluginKey.getState(view.state);
        if (!pluginState?.active?.dragging) {
            finish();
            return;
        }

        const tableElement = pluginState.active.dragging.state.getTableElement(view);
        if (!tableElement) {
            finish();
            return;
        }

        const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
            event.clientX,
            pluginState.active.dragging,
        );

        updateContentTableColumnsOnResize(
            pluginState.active.dragging.state.oldTable,
            tableElement,
            newTableAndColumnWidths,
        );
    }

    // Finalizes the resizing process when the mouse is released
    function finish() {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("keyup", handleKeyUp, true);
        dragCoverElement.remove();

        const pluginState = contentEditorTablePluginKey.getState(view.state);
        if (!pluginState?.active?.dragging) return;

        const {tableWidth: newTableWidth, columnWidths: newColumnWidths} =
            getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.active.dragging,
            );

        const transaction = view.state.tr;

        if (newTableWidth === undefined) {
            transaction.setNodeAttribute(
                pluginState.active.dragging.state.tablePos - 1,
                "columnWidths",
                newColumnWidths,
            );
        } else {
            transaction.setNodeMarkup(pluginState.active.dragging.state.tablePos - 1, null, {
                ...pluginState.active.dragging.state.oldTable.attrs,
                tableWidth: newTableWidth,
                columnWidths: newColumnWidths,
            });
        }

        dispatchContentEditorTablePluginAction({
            type: "SetActiveColumnResizeHandleDragging",
            dragging: null,
        })(view.state, view.dispatch);
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Alt") {
            dispatchContentEditorTablePluginAction({
                type: "SetActiveColumnResizeHandleIsSnapping",
                isSnapping: false,
            })(view.state, view.dispatch);

            const pluginState = contentEditorTablePluginKey.getState(view.state);
            if (!pluginState?.active?.dragging) {
                finish();
                return;
            }

            const tableElement = pluginState.active.dragging.state.getTableElement(view);
            if (!tableElement) {
                finish();
                return;
            }

            const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.active.dragging,
            );

            updateContentTableColumnsOnResize(
                pluginState.active.dragging.state.oldTable,
                tableElement,
                newTableAndColumnWidths,
            );
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        if (event.key === "Alt") {
            dispatchContentEditorTablePluginAction({
                type: "SetActiveColumnResizeHandleIsSnapping",
                isSnapping: true,
            })(view.state, view.dispatch);

            const pluginState = contentEditorTablePluginKey.getState(view.state);
            if (!pluginState?.active?.dragging) {
                finish();
                return;
            }

            const tableElement = pluginState.active.dragging.state.getTableElement(view);
            if (!tableElement) {
                finish();
                return;
            }

            const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.active.dragging,
            );

            updateContentTableColumnsOnResize(
                pluginState.active.dragging.state.oldTable,
                tableElement,
                newTableAndColumnWidths,
            );
        }
    }

    // Block the DOM with a cover element so we don't trigger hover effects and the
    // cursor always stays the same.
    const dragCoverElement = document.createElement("div");

    dragCoverElement.className = sprinkles({
        position: "absolute",
        inset: "0",
        zIndex: "70",
        cursor: "col-resize",
    });

    document.body.appendChild(dragCoverElement);

    window.addEventListener("mouseup", finish);
    window.addEventListener("mousemove", move);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    // Unfocus the content editor while resizing a column. So the browser cursor
    // and pointer toolbar don't render.
    view.dom.blur();

    event.preventDefault();
    return true;
}

function handleActiveRowGripHandleMouseDown(view: EditorView, event: MouseEvent) {
    // Set initial state
    {
        const pluginState = contentEditorTablePluginKey.getState(view.state);
        assert(pluginState?.active?.type === "RowGrip");

        const $cell = view.state.doc.resolve(pluginState.active.cellPos);
        assert($cell.parent.type.name === "table");

        const tablePos = $cell.start();
        const table = $cell.node();
        const tableMap = ContentTableMap.get(table);
        const rowIndex = tableMap.getRowCount($cell.pos - tablePos);

        selectContentTableRow(tablePos, rowIndex)(view.state, view.dispatch);
    }

    function move(event: MouseEvent): void {
        if (!event.which) {
            finish();
            return;
        }

        // NOCOMMIT:
        // const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        // if (!pluginState?.active?.dragging) {
        //     finish();
        //     return;
        // }

        // const tableElement = pluginState.active.dragging.state.getTableElement(view);
        // if (!tableElement) {
        //     finish();
        //     return;
        // }

        // const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
        //     event.clientX,
        //     pluginState.active.dragging,
        // );

        // updateContentTableColumnsOnResize(
        //     pluginState.active.dragging.state.oldTable,
        //     tableElement,
        //     newTableAndColumnWidths,
        // );
    }

    // Finalizes the resizing process when the mouse is released
    function finish() {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        dragCoverElement.remove();

        // NOCOMMIT:
        // const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        // if (!pluginState?.active?.dragging) return;

        // const {tableWidth: newTableWidth, columnWidths: newColumnWidths} =
        //     getContentTableColumnResizeDraggingStateNewColumnWidths(
        //         lastClientX,
        //         pluginState.active.dragging,
        //     );

        // const transaction = view.state.tr;

        // if (newTableWidth === undefined) {
        //     transaction.setNodeAttribute(
        //         pluginState.active.dragging.state.tablePos - 1,
        //         "columnWidths",
        //         newColumnWidths,
        //     );
        // } else {
        //     transaction.setNodeMarkup(pluginState.active.dragging.state.tablePos - 1, null, {
        //         ...pluginState.active.dragging.state.oldTable.attrs,
        //         tableWidth: newTableWidth,
        //         columnWidths: newColumnWidths,
        //     });
        // }

        // view.dispatch(
        //     transaction.setMeta(
        //         contentTableColumnResizingPluginKey,
        //         cast<ContentTableColumnResizeAction>({
        //             type: "SetActiveColumnResizeHandleDragging",
        //             dragging: null,
        //         }),
        //     ),
        // );
    }

    // Block the DOM with a cover element so we don't trigger hover effects and the
    // cursor always stays the same.
    const dragCoverElement = document.createElement("div");

    dragCoverElement.className = sprinkles({
        position: "absolute",
        inset: "0",
        zIndex: "70",
        cursor: "grabbing",
    });

    document.body.appendChild(dragCoverElement);

    window.addEventListener("mouseup", finish);
    window.addEventListener("mousemove", move);

    // Unfocus the content editor while resizing a column. So the browser cursor
    // and pointer toolbar don't render.
    view.dom.blur();

    event.preventDefault();
    return true;
}

// Finds the table cell element around the given target
function getContentTableCellElementAround(target: HTMLElement | null): HTMLElement | null {
    while (target && target.nodeName !== "TD" && target.nodeName !== "TH") {
        target = target.classList.contains("ProseMirror") ? null : target.parentElement;
    }
    return target;
}

// Finds the table element around the given target
function getContentTableElementAround(target: HTMLElement | null): HTMLElement | null {
    if (
        target?.nodeName === "TABLE" &&
        target.parentElement?.classList.contains(tableWrapper3ClassName)
    ) {
        return target;
    }

    if (target?.classList.contains(tableWrapperClassName)) {
        for (const childNode of target.childNodes) {
            if (!(childNode instanceof HTMLElement)) continue;
            if (childNode.classList.contains(tableWrapper2ClassName)) {
                target = childNode;
            }
        }
    }

    if (target?.classList.contains(tableWrapper2ClassName)) {
        for (const childNode of target.childNodes) {
            if (!(childNode instanceof HTMLElement)) continue;
            if (childNode.classList.contains(tableWrapper3ClassName)) {
                target = childNode;
            }
        }
    }

    if (target?.classList.contains(tableWrapper3ClassName)) {
        for (const childNode of target.childNodes) {
            if (childNode.nodeName === "TABLE") {
                return childNode as HTMLElement;
            }
        }
    }

    if (target?.classList.contains(contentStyles.tableGripRowClassName)) {
        return target.closest("table");
    }

    return null;
}

// Determines the cell at the edge of the column being resized
function getEdgeContentTableCell(
    view: EditorView,
    event: MouseEvent,
    side: "left" | "right",
    handleWidth: number,
): number | null {
    // posAtCoords returns inconsistent positions when cursor is moving
    // across a collapsed table border. Use an offset to adjust the
    // target viewport coordinates away from the table border.
    const offset = side == "right" ? -handleWidth : handleWidth;
    const found = view.posAtCoords({
        left: event.clientX + offset,
        top: event.clientY,
    });
    if (!found) return null;
    const {pos, inside} = found;
    let $pos = view.state.doc.resolve(pos);

    // If `$pos` points to a `table` instead of a `tableCell` then try using the
    // `inside` position instead. This fixes a bug where when hovering over the 1px
    // between table rows `pos` points into the table. When changing this you need
    // to test:
    //
    // 1. Hovering over the blue part of the resize handle then slowly moving down
    //    through the row border (resize handle should be visible the entire time)
    //
    // 2. Hovering over the transparent part of the resize handle then slowly
    //    moving down through the row border (resize handle should be visible the
    //    entire time)
    if ($pos.parent.type.name === "table" && inside !== -1)
        $pos = view.state.doc.resolve(inside + 1);

    const $cell = contentTableCellAround($pos);
    if (!$cell) return null;
    if (side == "right") return $cell.pos;
    const map = ContentTableMap.get($cell.node(-1));
    const start = $cell.start(-1);
    const index = map.map.indexOf($cell.pos - start);
    if (index % map.width !== 0) {
        return start + map.map[index - 1]!;
    } else {
        return start + map.map[index]! - 1;
    }
}

/**
 * Computes the absolute pixel width of each column in a table. Implements the
 * same algorithm CSS grid will use to layout our table in the DOM.
 *
 * `totalColumnWidth` must be the sum of all `columnWidths`. Most of the time
 * you'll have precomputed this value so pass it in so we don't have to compute
 * it again.
 */
// NOTE(calebmer): Normally, since this has 4 arguments, I'd write this with a
// named argument object. But since this code will be called in a hot path
// (every frame) using positional arguments to avoid an extra object
// allocation.
export function resolveContentTableColumnWidthPx(
    totalColumnWidth: number,
    columnWidths: ReadonlyArray<number>,
    totalColumnWidthPx: number,
    columnMinWidthPx: number,
): Array<number> {
    let hasNextPass = true;
    let currentPassTotalColumnWidth = totalColumnWidth;
    let currentPassTotalColumnWidthPx = totalColumnWidthPx;
    let nextPassTotalColumnWidth: number;
    let nextPassTotalColumnWidthPx: number;

    const columnCount = columnWidths.length;
    const columnWidthPxs: Array<number | undefined> = Array(columnCount);

    while (hasNextPass) {
        hasNextPass = false;
        nextPassTotalColumnWidth = 0;
        nextPassTotalColumnWidthPx = currentPassTotalColumnWidthPx;

        for (let i = 0; i < columnCount; i++) {
            if (columnWidthPxs[i] !== undefined) continue;

            const columnWidth = columnWidths[i]!;

            const columnWidthPx =
                (columnWidth / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;

            if (columnWidthPx < columnMinWidthPx) {
                hasNextPass = true;
                nextPassTotalColumnWidthPx -= columnMinWidthPx;
                columnWidthPxs[i] = columnMinWidthPx;
            } else {
                nextPassTotalColumnWidth += columnWidth;
            }
        }

        currentPassTotalColumnWidth = nextPassTotalColumnWidth;
        currentPassTotalColumnWidthPx = nextPassTotalColumnWidthPx;
    }

    for (let i = 0; i < columnCount; i++) {
        if (columnWidthPxs[i] !== undefined) continue;

        columnWidthPxs[i] =
            (columnWidths[i]! / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;
    }

    return columnWidthPxs as Array<number>;
}

/**
 * Calculates the new width of the column being dragged.
 *
 * We implement the following UX principles for column resizing. These UX
 * principles should lead to a consistent, easy to understand, experience for
 * users building tables:
 *
 * 1. A column should only resize when a user drags the drag handle. It should
 *    not resize when the user types content. Instead content should wrap onto
 *    a new line as the user types.
 *
 * 2. Dragging a column drag handle should only change the size of the
 *    column(s) adjacent to the drag handle.
 *
 * 3. Dragging an interior column drag handle shouldn't change the width of the
 *    table.
 *
 * 4. Dragging an edge column drag handle (left or right) can change the width
 *    of the table.
 *
 * Some ideas for another day:
 *
 * - It's a little surprising that dragging in the middle of two min width
 *   columns does nothing. That's because of our resize principle to only
 *   change the size of columns adjacent to the drag handle. Maybe we should
 *   consider loosening principle 3. Allowing the table to resize if it already
 *   has a width greater than 1 seems fine. We want to keep tables with a width
 *   of 1 as much as possible since tables with a width of 1 won't overflow on
 *   mobile.
 *
 * - Allow columns to snap to the same width as other columns. This allows
 *   users to easily build well designed tables that have consistent spacing
 *   across multiple columns. Or add a "set width" feature that lets the user
 *   set the column width as a percent.
 */
export function getContentTableColumnResizeDraggingStateNewColumnWidths(
    currentX: number,
    {
        startX,
        viewWithoutPaddingWidthPx,
        oldTotalColumnWidthPx: actualOldTotalColumnWidthPx,
        oldScrollLeftPx,
        isSnapping,
        state: {
            columnIndex: column1Index,
            oldTableMap: {columnWidths: oldColumnWidths, totalColumnWidth: oldTotalColumnWidth},
        },
    }: {
        startX: number;
        viewWithoutPaddingWidthPx: number;
        oldTotalColumnWidthPx: number;
        oldScrollLeftPx: number;
        isSnapping: boolean;
        state: {
            columnIndex: number;
            oldTableMap: {
                columnWidths: ReadonlyArray<number>;
                totalColumnWidth: number;
            };
        };
    },
): {
    tableWidth?: number;
    columnWidths: ReadonlyArray<number>;
    scrollLeftPx?: number;
} {
    const offsetPx = currentX - startX;

    const platform = getPlatformWithoutListening();
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const columnMinWidthPx = contentStyles.tableColumnMinWidthRem * remPx;
    const columnMaxWidthPx = contentStyles.tableColumnMaxWidthRem * remPx;

    const blockWidthPx = Math.min(
        viewWithoutPaddingWidthPx,
        contentStyles.blockMaxWidthRem[platform] * remPx,
    );

    const minTotalColumnWidthPx = Math.max(
        columnMinWidthPx * oldColumnWidths.length,
        // Don't shrink smaller than the editor's block width.
        blockWidthPx,
    );

    const maxTotalColumnWidthPx = columnMaxWidthPx * oldColumnWidths.length;

    const oldTotalColumnWidthPx = clamp(
        minTotalColumnWidthPx,
        actualOldTotalColumnWidthPx,
        maxTotalColumnWidthPx,
    );

    // By default, round column width to the nearest snap increment. If the user is
    // holding alt then we'll let the user perform a precise pixel by pixel resize.
    //
    // By defaulting to snapping to a standard column width increment, we help the
    // user create beautiful, orderly, tables.
    const snapColumnWidthPx = (columnWidthPx: number) => {
        if (!isSnapping) return columnWidthPx;

        const columnWidthSnapIncrementPx =
            blockWidthPx / contentStyles.tableColumnWidthBlockWidthSnapFactor;

        return Math.round(columnWidthPx / columnWidthSnapIncrementPx) * columnWidthSnapIncrementPx;
    };

    // For the best UX, as the user drags the column resize handle should perfectly
    // follow the user's mouse while they drag. If the table width is less than the
    // view width then the table is centered in the view. Dragging a column to
    // resize the column 1px ends up moving the column right 0.5px and left 0.5px
    // while the table width is less than the view width since we need to keep the
    // table centered.
    //
    // This function speeds up the column width change while the table width is
    // less than the view width by 2x so the column width moves perfectly with the
    // mouse even while the table is centered.
    const getAdditionalColumnWidthPxIfChangingTableWidth = (offsetPx: number) => {
        if (offsetPx > 0) {
            const doubledOffsetPx = Math.max(
                0,
                (viewWithoutPaddingWidthPx - oldTotalColumnWidthPx) / 2,
            );

            return (
                Math.min(offsetPx, doubledOffsetPx) * 2 + Math.max(0, offsetPx - doubledOffsetPx)
            );
        } else {
            const doubledOffsetPx = Math.max(0, oldTotalColumnWidthPx - viewWithoutPaddingWidthPx);

            return (
                Math.max(offsetPx, -doubledOffsetPx) + Math.min(0, offsetPx + doubledOffsetPx) * 2
            );
        }
    };

    // There are two branches to this function:
    //
    // 1. If we're dragging a resize handle on the edge of the table
    // 2. If we're dragging a resize handle inside the table (between two columns)
    //
    // Dragging a resize handle inside the table (branch 2) is not allowed to
    // change the table's width. Only dragging a resize handle at the edge of the
    // table may resize the table width.
    //
    // While dragging a resize handle we'll only change the column widths adjacent
    // to that resize handle.
    if (column1Index < 0 || column1Index >= oldColumnWidths.length - 1) {
        const isLeftResize = column1Index < 0;
        const columnIndex = isLeftResize ? 0 : oldColumnWidths.length - 1;
        const oldColumnWidth = oldColumnWidths[columnIndex]!;
        const oldColumnWidthPx = oldTotalColumnWidthPx * (oldColumnWidth / oldTotalColumnWidth);

        let newColumnWidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(
                oldColumnWidthPx +
                    getAdditionalColumnWidthPxIfChangingTableWidth(
                        (isLeftResize ? -1 : 1) * offsetPx,
                    ),
            ),
            columnMaxWidthPx,
        );

        const expectedNewTotalColumnWidthPx =
            oldTotalColumnWidthPx - (oldColumnWidthPx - newColumnWidthPx);

        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // If the new column width violates total column width min/max bounds then we
        // need to adjust the new column width back down to what'll work with our total
        // column width min/max bounds.
        newColumnWidthPx += newTotalColumnWidthPx - expectedNewTotalColumnWidthPx;

        const newColumnWidths: Array<number | null> = [];
        let newOtherTotalColumnWidth = 0;

        // Our `oldColumnWidths` array may not accurately represent what's in the DOM
        // if some of our columns are running up against their min width. So run the
        // same calculation used by CSS grid to determine the actual column widths.
        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            oldTotalColumnWidth,
            oldColumnWidths,
            oldTotalColumnWidthPx,
            columnMinWidthPx,
        );

        for (
            let otherColumnIndex = 0;
            otherColumnIndex < oldColumnWidths.length;
            otherColumnIndex++
        ) {
            if (otherColumnIndex === columnIndex) {
                newColumnWidths.push(null);
                continue;
            }

            const oldOtherColumnWidth =
                (oldColumnWidthPxs[otherColumnIndex]! / oldTotalColumnWidthPx) *
                oldTotalColumnWidth;

            newColumnWidths.push(oldOtherColumnWidth);
            newOtherTotalColumnWidth += oldOtherColumnWidth;
        }

        // We have the following equality:
        //
        // ```ts
        // newColumnWidthPx / newTotalColumnWidthPx ===
        //     newColumnWidth / (newColumnWidth + newOtherTotalColumnWidth)
        // ```
        //
        // All variables in the equality are known except for `newColumnWidth`.
        // We can use [algebra to solve for `newColumnWidth`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+c+in+a+%2F+b+%3D+c+%2F+%28c+%2B+d%29
        const newColumnWidth = -(
            (newColumnWidthPx * newOtherTotalColumnWidth) /
            (newColumnWidthPx - newTotalColumnWidthPx)
        );

        newColumnWidths[columnIndex] = newColumnWidth;

        // Compute the old table width on the fly since the `tableWidth` attr in
        // ProseMirror may not accurately reflect what's in the DOM.
        const oldTableWidth = Math.max(1, oldTotalColumnWidthPx / blockWidthPx);

        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths as Array<number>,
            scrollLeftPx: isLeftResize
                ? oldScrollLeftPx
                : oldScrollLeftPx + (newColumnWidthPx - oldColumnWidthPx),
        };
    } else if (
        oldColumnWidths.length <= contentStyles.tableMaxColumnCountForMaintainingBlockWidth
    ) {
        // If the number of columns are less than equal to 4 then make sure the
        // interior column resizer is affecting only the columns adjacent to the resize
        // handle and not the table width
        const column2Index = column1Index + 1;
        const oldColumn2Width = oldColumnWidths[column2Index]!;

        const oldColumn1Width = oldColumnWidths[column1Index]!;
        const oldColumn1WidthPx = oldTotalColumnWidthPx * (oldColumn1Width / oldTotalColumnWidth);

        // Make sure the new column 1 width is in our min/max bounds.
        let newColumn1WidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(oldColumn1WidthPx + offsetPx),
            columnMaxWidthPx,
        );

        let newColumn1Width = (newColumn1WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
        let newColumn2Width = oldColumn1Width + oldColumn2Width - newColumn1Width;
        let newColumn2WidthPx = (newColumn2Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;

        // Make sure the new column 2 width is in our min/max bounds.
        if (newColumn2WidthPx < columnMinWidthPx) {
            newColumn2WidthPx = columnMinWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
            newColumn1WidthPx = (newColumn1Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;
        } else if (newColumn2WidthPx > columnMaxWidthPx) {
            newColumn2WidthPx = columnMaxWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
            newColumn1WidthPx = (newColumn1Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;
        }

        const newColumnWidths: Array<number> = [];

        for (let columnIndex = 0; columnIndex < oldColumnWidths.length; columnIndex++) {
            if (columnIndex === column1Index) newColumnWidths.push(newColumn1Width);
            else if (columnIndex === column2Index) newColumnWidths.push(newColumn2Width);
            else newColumnWidths.push(oldColumnWidths[columnIndex]!);
        }

        return {
            columnWidths: newColumnWidths,
            scrollLeftPx: oldScrollLeftPx,
        };
    } else {
        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            oldTotalColumnWidth,
            oldColumnWidths,
            oldTotalColumnWidthPx,
            columnMinWidthPx,
        );

        const oldColumnWidth = oldColumnWidths[column1Index]!;
        const oldColumnWidthPx = oldColumnWidthPxs[column1Index]!;

        // Calculate new width based on drag offset
        let newColumnWidthPx = clamp(
            columnMinWidthPx,
            snapColumnWidthPx(
                oldColumnWidthPx + getAdditionalColumnWidthPxIfChangingTableWidth(offsetPx),
            ),
            columnMaxWidthPx,
        );

        const expectedNewTotalColumnWidthPx =
            oldTotalColumnWidthPx + (newColumnWidthPx - oldColumnWidthPx);

        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // If the new column width violates total column width min/max bounds then we
        // need to adjust the new column width back down to what'll work with our total
        // column width min/max bounds.
        newColumnWidthPx += newTotalColumnWidthPx - expectedNewTotalColumnWidthPx;

        // Calculate new relative width for the resized column:
        //
        // We have the following equality, where `newTotalColumnWidth` is the new
        // total column width and it is being calculated from the old total column
        // width, the old width of the column being resized, and the new width of
        // the column being resized:
        //
        // ```
        // newTotalColumnWidth = oldTotalColumnWidth - oldColumnWidth + newColumnWidth
        // ```
        //
        // We also have the following equality, where `newColumnWidth` is the new
        // width of the column being resized: Here we are comparing the ratio of
        // the relatives values to the ratio of the pixels values.
        //
        // ```
        // newColumnWidth / newTotalColumnWidth = newColumnWidthPx / newTotalColumnWidthPx
        // ```
        //
        // If we simplify this using 1st equality we get:
        //
        // ```
        // newColumnWidth / (oldTotalColumnWidth - oldColumnWidth + newColumnWidth) = newColumnWidthPx / newTotalColumnWidthPx
        // ```
        //
        // which can be written as: a / (b - c + a) = d / f
        //
        // All variables in the equality are known except for `newColumnWidth`.
        // We can use [algebra to solve for `newColumnWidth`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+for+a++a+%2F+%28b+-+c+%2B+a%29+%3D+d+%2F+f
        const newColumnWidth =
            (newColumnWidthPx * (oldColumnWidth - oldTotalColumnWidth)) /
            (newColumnWidthPx - newTotalColumnWidthPx);

        // Keep other columns unchanged
        const newColumnWidths: Array<number> = [...oldColumnWidths];
        newColumnWidths[column1Index] = newColumnWidth;

        // Update table width
        const oldTableWidth = Math.max(1, oldTotalColumnWidthPx / blockWidthPx);
        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        let oldTotalColumnWidthPxBeforeColumn = 0;
        for (let i = 0; i < column1Index; i++)
            oldTotalColumnWidthPxBeforeColumn += oldColumnWidthPxs[i]!;

        const newColumnScrollRightPx =
            oldTotalColumnWidthPxBeforeColumn + newColumnWidthPx - oldScrollLeftPx;

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths,
            scrollLeftPx:
                oldScrollLeftPx +
                Math.floor(Math.max(0, newColumnScrollRightPx - (viewWithoutPaddingWidthPx - 1))),
        };
    }
}

type ContentEditorTablePluginDecorationElementCache = ReturnType<
    typeof createContentEditorTablePluginDecorationElementCache
>;

function createContentEditorTablePluginDecorationElementCache() {
    const columnResizeHandleElement = new Lazy<HTMLElement>(() => {
        const columnResizeHandleElement = document.createElement("div");
        columnResizeHandleElement.className = contentStyles.tableColumnResizeHandleClassName;
        return columnResizeHandleElement;
    });

    const rightEdgeColumnResizeHandleElement = new Lazy<HTMLElement>(() => {
        const columnResizeHandleElement = document.createElement("div");
        columnResizeHandleElement.className = `${contentStyles.tableColumnResizeHandleClassName} ${contentStyles.tableRightEdgeColumnResizeHandleClassName}`;
        return columnResizeHandleElement;
    });

    const rowGripElementByRowIndex = new LazyMap<number, HTMLElement>(rowIndex => {
        const rowGripElement = document.createElement("div");
        rowGripElement.className = contentStyles.tableRowGrip2ClassName;
        rowGripElement.style.gridRow = `${rowIndex + 1} / ${rowIndex + 2}`;
        rowGripElement.innerHTML = dotsSixVerticalIconSvg();
        return rowGripElement;
    });

    return {
        columnResizeHandleElement,
        rightEdgeColumnResizeHandleElement,
        rowGripElementByRowIndex,
    };
}

function drawContentEditorTableCellSelection(
    state: EditorState,
    decorations: DecorationSet,
): DecorationSet {
    if (!(state.selection instanceof ContentTableCellSelection)) return decorations;

    const cells: Array<Decoration> = [];
    state.selection.forEachCell((node, pos) => {
        cells.push(
            Decoration.node(pos, pos + node.nodeSize, {
                class: contentStyles.tableSelectedCellClassName,
            }),
        );
    });

    return decorations.add(state.doc, cells);
}

// Handles the decorations for the column resize handle
function drawContentEditorTablePluginActiveStateDecorations(
    elementCache: ContentEditorTablePluginDecorationElementCache,
    state: EditorState,
    active: ContentEditorTablePluginActiveState,
    decorations: DecorationSet,
): DecorationSet {
    const $cell = state.doc.resolve(active.cellPos);

    switch (active.type) {
        case "RowGrip": {
            assert($cell.parent.type.name === "table");

            const tablePos = $cell.start();
            const table = $cell.node();
            const tableMap = ContentTableMap.get(table);
            const rowIndex = tableMap.getRowCount($cell.pos - tablePos);

            return decorations.add(state.doc, [
                Decoration.widget(tablePos, () => {
                    return elementCache.rowGripElementByRowIndex.get(rowIndex);
                }),
            ]);
        }
        case "ColumnResizeHandle": {
            assert($cell.parent.type.name === "tableRow");

            const tablePos = $cell.start(-1);
            const table = $cell.node(-1);
            const tableMap = ContentTableMap.get(table);
            const columnIndex = tableMap.getColumnCount($cell.pos - tablePos);

            return decorations.add(state.doc, [
                Decoration.widget(tablePos, () => {
                    const columnResizeHandleElement =
                        columnIndex === tableMap.width - 1
                            ? elementCache.rightEdgeColumnResizeHandleElement.get()
                            : elementCache.columnResizeHandleElement.get();

                    columnResizeHandleElement.style.gridColumn = `${columnIndex + 2}`;

                    return columnResizeHandleElement;
                }),
            ]);
        }
        default:
            throw exhaustive(active);
    }
}
