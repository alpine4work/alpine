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
import {
    selectContentTableColumn,
    selectContentTableRow,
} from "~/client/content/internal/table/content_table_commands.js";
import {fixContentTables} from "~/client/content/internal/table/content_table_fix_tables.js";
import {handleContentTableKeyDown} from "~/client/content/internal/table/content_table_input.js";
import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
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
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
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
            init: () => {
                return null;
            },
            apply: applyContentEditorTablePluginStateTransaction,
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
                return contentEditorTablePluginKey.getState(view.state)?.type ===
                    "DraggingCellSelection"
                    ? view.state.selection
                    : null;
            },

            decorations: state => {
                const pluginState = contentEditorTablePluginKey.getState(state);

                const decorations: Array<Decoration> = [];

                if (pluginState?.type !== "DraggingGrip") {
                    drawContentEditorTableCellSelection(elementCache, state, decorations);
                }

                if (
                    pluginState?.type === "Hovering" &&
                    !pluginState.hovering.isWaitingForMouseOverDelay
                ) {
                    drawContentEditorTablePluginHoveringStateDecorations(
                        elementCache,
                        state,
                        pluginState.hovering,
                        decorations,
                    );
                }

                return decorations.length !== 0
                    ? DecorationSet.create(state.doc, decorations)
                    : null;
            },
        },
        view: () => {
            let timeout: Timeout | null = null;

            return {
                update: view => {
                    if (timeout !== null) {
                        timeout.clear();
                        timeout = null;
                    }

                    const pluginState = contentEditorTablePluginKey.getState(view.state);

                    // We have a short delay before showing column resize handles or row grips so
                    // that if the user is quickly moving their mouse over the table they won't
                    // show up. The delay is fast enough that the user perceives the delay as
                    // instant if they're intentionally moving to the row grip or column resize
                    // handle.
                    if (
                        pluginState?.type === "Hovering" &&
                        pluginState.hovering.isWaitingForMouseOverDelay
                    ) {
                        const finishMouseOverDelayTime =
                            pluginState.hovering.mouseOverTime + perceivedAsInstantLimitMs;

                        timeout = createTimeout(() => {
                            dispatchContentEditorTablePluginAction({
                                type: "FinishHoveringMouseOverDelay",
                            })(view.state, view.dispatch);
                        }, finishMouseOverDelayTime - Date.now());
                    }
                },
            };
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
          readonly type: "ClearHovering";
      }
    | {
          readonly type: "FinishHoveringMouseOverDelay";
      }
    | {
          readonly type: "SetHoveringColumnResizeHandle";
          readonly mouseOverTime: number;
          readonly cellPos: number;
      }
    | {
          readonly type: "SetHoveringColumnResizeHandleDragging";
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
          readonly type: "SetHoveringColumnResizeHandleIsSnapping";
          readonly isSnapping: boolean;
      }
    | {
          readonly type: "SetHoveringRowGrip";
          readonly mouseOverTime: number;
          readonly cellPos: number;
      }
    | {
          readonly type: "SetHoveringColumnGrip";
          readonly mouseOverTime: number;
          readonly cellPos: number;
      }
    | {
          readonly type: "SetDraggingGrip";
      }
    | {
          readonly type: "ClearDraggingGrip";
      };

function dispatchContentEditorTablePluginAction(action: ContentEditorTablePluginAction): Command {
    return (state, dispatch) => {
        dispatch?.(state.tr.setMeta(contentEditorTablePluginKey, action));
        return true;
    };
}

type ContentEditorTablePluginState =
    | {
          readonly type: "DraggingCellSelection";
          readonly startCellPos: number;
      }
    | {
          readonly type: "Hovering";
          readonly hovering: ContentEditorTablePluginHoveringState;
      }
    | {
          readonly type: "DraggingGrip";
      }
    | null;

type ContentEditorTablePluginHoveringState =
    | {
          readonly type: "ColumnResizeHandle";
          readonly mouseOverTime: number;
          readonly isWaitingForMouseOverDelay: boolean;
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
          readonly mouseOverTime: number;
          readonly isWaitingForMouseOverDelay: boolean;
          readonly cellPos: number;
          readonly dragging: null;
      }
    | {
          readonly type: "ColumnGrip";
          readonly mouseOverTime: number;
          readonly isWaitingForMouseOverDelay: boolean;
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

function applyContentEditorTablePluginStateTransaction(
    transaction: Transaction,
    state: ContentEditorTablePluginState,
): ContentEditorTablePluginState {
    if (transaction.docChanged && state !== null) {
        switch (state.type) {
            case "DraggingCellSelection": {
                const {deleted, pos} = transaction.mapping.mapResult(state.startCellPos);
                state = deleted ? null : {type: "DraggingCellSelection", startCellPos: pos};
                break;
            }
            case "Hovering": {
                let cellPos: number | null = transaction.mapping.map(state.hovering.cellPos, -1);
                if (!pointsAtContentTableCell(transaction.doc.resolve(cellPos))) {
                    cellPos = null;
                }

                if (cellPos === null) {
                    state = null;
                    break;
                }

                state = {
                    ...state,
                    hovering: {
                        ...state.hovering,
                        cellPos,
                    },
                };

                if (state.hovering.type === "ColumnResizeHandle" && state.hovering.dragging) {
                    state = {
                        ...state,
                        hovering: {
                            ...state.hovering,
                            dragging: {
                                ...state.hovering.dragging,
                                state: getContentEditorTablePluginColumnResizeHandleDraggingState(
                                    transaction.doc,
                                    state.hovering.cellPos,
                                ),
                            },
                        },
                    };
                }
                break;
            }
            case "DraggingGrip": {
                // Noop. No positions stored in this state.
                break;
            }
            default:
                throw exhaustive(state);
        }
    }

    const action: ContentEditorTablePluginAction | null | undefined = transaction.getMeta(
        contentEditorTablePluginKey,
    );
    if (action) {
        state = applyContentEditorTablePluginStateAction(action, state);
    }

    // Don't allow active row grips or column grips within a cell selection. We'll
    // already be rendering a conflicting "selection" grip.
    if (transaction.selection instanceof ContentTableCellSelection && state?.type === "Hovering") {
        if (state.hovering.type === "RowGrip") {
            const $cell = transaction.doc.resolve(state.hovering.cellPos);
            assert($cell.parent.type.name === "table");

            const tablePos = $cell.start();
            const table = $cell.node();
            const tableMap = ContentTableMap.get(table);
            const rowIndex = tableMap.getRowCount($cell.pos + 1 - tablePos);

            if (
                transaction.selection.isRowSelection() &&
                transaction.selection.tablePos === tablePos &&
                transaction.selection.tableRect.top <= rowIndex &&
                rowIndex < transaction.selection.tableRect.bottom
            ) {
                state = null;
            }
        } else if (state.hovering.type === "ColumnGrip") {
            const $cell = transaction.doc.resolve(state.hovering.cellPos);

            let tablePos: number;
            let table: Node;
            let tableMap: ContentTableMap;
            let columnIndex: number;

            if ($cell.parent.type.name === "table") {
                tablePos = $cell.start();
                table = $cell.node();
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos + 1 - tablePos);
            } else {
                assert($cell.parent.type.name === "tableRow");

                tablePos = $cell.start(-1);
                table = $cell.node(-1);
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos - tablePos) + 1;
            }

            if (
                transaction.selection.isColumnSelection() &&
                transaction.selection.tablePos === tablePos &&
                transaction.selection.tableRect.left <= columnIndex &&
                columnIndex < transaction.selection.tableRect.right
            ) {
                state = null;
            }
        }
    }

    return state;
}

function applyContentEditorTablePluginStateAction(
    action: ContentEditorTablePluginAction,
    state: ContentEditorTablePluginState,
): ContentEditorTablePluginState {
    switch (action.type) {
        case "ClearDraggingSelectionStartCellPos": {
            if (state?.type !== "DraggingCellSelection") return state;
            return null;
        }
        case "SetDraggingSelectionStartCellPos": {
            return {type: "DraggingCellSelection", startCellPos: action.pos};
        }
        case "ClearHovering": {
            if (state?.type !== "Hovering") return state;
            return null;
        }
        case "FinishHoveringMouseOverDelay": {
            if (state?.type !== "Hovering") return state;
            if (!state.hovering.isWaitingForMouseOverDelay) return state;

            return {
                ...state,
                hovering: {
                    ...state.hovering,
                    isWaitingForMouseOverDelay: false,
                },
            };
        }
        case "SetHoveringColumnResizeHandle": {
            return {
                type: "Hovering",
                hovering: {
                    type: "ColumnResizeHandle",
                    mouseOverTime: action.mouseOverTime,
                    // Don't delay showing this UI if we already have some other active UI.
                    isWaitingForMouseOverDelay: state?.type !== "Hovering",
                    cellPos: action.cellPos,
                    dragging: null,
                },
            };
        }
        case "SetHoveringColumnResizeHandleDragging": {
            if (state?.type !== "Hovering") return state;
            if (state.hovering?.type !== "ColumnResizeHandle") return state;

            return {
                ...state,
                hovering: {
                    ...state.hovering,
                    dragging: action.dragging,
                },
            };
        }
        case "SetHoveringColumnResizeHandleIsSnapping": {
            if (state?.type !== "Hovering") return state;
            if (state.hovering.type !== "ColumnResizeHandle") return state;
            if (state.hovering.dragging === null) return state;

            return {
                ...state,
                hovering: {
                    ...state.hovering,
                    dragging: {
                        ...state.hovering.dragging,
                        isSnapping: action.isSnapping,
                    },
                },
            };
        }
        case "SetHoveringRowGrip": {
            return {
                type: "Hovering",
                hovering: {
                    type: "RowGrip",
                    mouseOverTime: action.mouseOverTime,
                    // Don't delay showing this UI if we already have some other active UI.
                    isWaitingForMouseOverDelay: state?.type !== "Hovering",
                    cellPos: action.cellPos,
                    dragging: null,
                },
            };
        }
        case "SetHoveringColumnGrip": {
            return {
                type: "Hovering",
                hovering: {
                    type: "ColumnGrip",
                    mouseOverTime: action.mouseOverTime,
                    // Don't delay showing this UI if we already have some other active UI.
                    isWaitingForMouseOverDelay: state?.type !== "Hovering",
                    cellPos: action.cellPos,
                    dragging: null,
                },
            };
        }
        case "SetDraggingGrip": {
            return {type: "DraggingGrip"};
        }
        case "ClearDraggingGrip": {
            if (state?.type !== "DraggingGrip") return state;
            return null;
        }
        default:
            throw exhaustive(action);
    }
}

// Handles mouse movement to update the active column handle
function handleMouseMove(view: EditorView, event: MouseEvent): void {
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if ((pluginState && pluginState.type !== "Hovering") || pluginState?.hovering.dragging) return;

    // If the user is pressing their mouse while moving over the resize handle then
    // we don't show the resize handle. e.g. If the user is clicking in a cell and
    // dragging to select cells.
    if (event.which) return;

    const targetElement = event.target as HTMLElement;

    let type: "ColumnResizeHandle" | "RowGrip" | "ColumnGrip" | null = null;
    let cellPos: number | null = null;
    if (
        pluginState &&
        targetElement.classList.contains(contentStyles.tableColumnResizeHandleClassName)
    ) {
        type = "ColumnResizeHandle";
        cellPos = pluginState.hovering.cellPos;
    } else if (
        pluginState &&
        targetElement.classList.contains(contentStyles.tableRowGripClassName)
    ) {
        type = "RowGrip";
        cellPos = pluginState.hovering.cellPos;
    } else if (
        pluginState &&
        targetElement.classList.contains(contentStyles.tableColumnGripClassName)
    ) {
        type = "ColumnGrip";
        cellPos = pluginState.hovering.cellPos;
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
            const {top, bottom, left, right} = cellTargetElement.getBoundingClientRect();

            const tryVertical = (): boolean => {
                if (event.clientX - left <= halfColumnResizeHandleWidth) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "left",
                        halfColumnResizeHandleWidth,
                    );

                    if (cellPos !== null) {
                        const $cell = view.state.doc.resolve(cellPos);
                        type =
                            // If we're hovering the left edge of the table then the parent of `$cell` will
                            // be `table` instead of `tableRow`.
                            $cell.parent.type.name === "table" ? "RowGrip" : "ColumnResizeHandle";
                    }
                    return true;
                } else if (right - event.clientX <= halfColumnResizeHandleWidth) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "right",
                        halfColumnResizeHandleWidth,
                    );

                    if (cellPos !== null) {
                        const $cell = view.state.doc.resolve(cellPos);
                        type =
                            // If we're hovering the left edge of the table then the parent of `$cell` will
                            // be `table` instead of `tableRow`.
                            $cell.parent.type.name === "table" ? "RowGrip" : "ColumnResizeHandle";
                    }
                    return true;
                } else {
                    return false;
                }
            };

            const tryHorizontal = (): boolean => {
                if (event.clientY - top <= halfColumnResizeHandleWidth) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "top",
                        halfColumnResizeHandleWidth,
                    );

                    // Check that the cell is a part of the first row. We only render a column grip
                    // for the first row.
                    if (cellPos !== null) {
                        const $cell = view.state.doc.resolve(cellPos);

                        let tablePos: number;
                        let table: Node;
                        let tableMap: ContentTableMap;
                        let rowIndex: number;

                        if ($cell.parent.type.name === "table") {
                            tablePos = $cell.start();
                            table = $cell.node();
                            tableMap = ContentTableMap.get(table);
                            rowIndex = tableMap.getRowCount($cell.pos + 1 - tablePos);
                        } else {
                            assert($cell.parent.type.name === "tableRow");

                            tablePos = $cell.start(-1);
                            table = $cell.node(-1);
                            tableMap = ContentTableMap.get(table);
                            rowIndex = tableMap.getRowCount($cell.pos - tablePos);
                        }

                        if (rowIndex === 0) {
                            type = "ColumnGrip";
                        }
                    }

                    return true;
                } else if (bottom - event.clientY <= halfColumnResizeHandleWidth) {
                    cellPos = getEdgeContentTableCell(
                        view,
                        event,
                        "bottom",
                        halfColumnResizeHandleWidth,
                    );
                    return true;
                } else {
                    return false;
                }
            };

            // If the user was hovering over a column grip then try to maintain the
            // horizontal column grip before switching to checking for vertical row grips
            // or column resize handles.
            if (pluginState?.hovering.type === "ColumnGrip") {
                if (!tryHorizontal()) {
                    tryVertical();
                }
            } else {
                if (!tryVertical()) {
                    tryHorizontal();
                }
            }
        } else {
            const tableTargetElement = getContentTableElementAround(targetElement);
            if (tableTargetElement) {
                const {top, bottom, left, right} = tableTargetElement.getBoundingClientRect();

                const tryVertical = (): boolean => {
                    // This case occurs when the mouse is outside the table and approaching the
                    // left edge.
                    if (
                        event.clientX <= left &&
                        left - event.clientX <= halfColumnResizeHandleWidth
                    ) {
                        cellPos = getEdgeContentTableCell(
                            view,
                            event,
                            "left",
                            halfColumnResizeHandleWidth,
                        );

                        if (cellPos !== null) {
                            const $cell = view.state.doc.resolve(cellPos);
                            type =
                                // If we're hovering the left edge of the table then the parent of `$cell` will
                                // be `table` instead of `tableRow`.
                                $cell.parent.type.name === "table"
                                    ? "RowGrip"
                                    : "ColumnResizeHandle";
                        }
                        return true;
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

                        if (cellPos !== null) {
                            const $cell = view.state.doc.resolve(cellPos);
                            type =
                                // If we're hovering the left edge of the table then the parent of `$cell` will
                                // be `table` instead of `tableRow`.
                                $cell.parent.type.name === "table"
                                    ? "RowGrip"
                                    : "ColumnResizeHandle";
                        }
                        return true;
                    } else {
                        return false;
                    }
                };

                const tryHorizontal = (): boolean => {
                    // This case occurs when the mouse is outside the table and approaching the
                    // top edge.
                    if (
                        event.clientY <= top &&
                        top - event.clientY <= halfColumnResizeHandleWidth
                    ) {
                        cellPos = getEdgeContentTableCell(
                            view,
                            event,
                            "top",
                            halfColumnResizeHandleWidth,
                        );

                        // Check that the cell is a part of the first row. We only render a column grip
                        // for the first row.
                        if (cellPos !== null) {
                            const $cell = view.state.doc.resolve(cellPos);

                            let tablePos: number;
                            let table: Node;
                            let tableMap: ContentTableMap;
                            let rowIndex: number;

                            if ($cell.parent.type.name === "table") {
                                tablePos = $cell.start();
                                table = $cell.node();
                                tableMap = ContentTableMap.get(table);
                                rowIndex = tableMap.getRowCount($cell.pos + 1 - tablePos);
                            } else {
                                assert($cell.parent.type.name === "tableRow");

                                tablePos = $cell.start(-1);
                                table = $cell.node(-1);
                                tableMap = ContentTableMap.get(table);
                                rowIndex = tableMap.getRowCount($cell.pos - tablePos);
                            }

                            if (rowIndex === 0) {
                                type = "ColumnGrip";
                            }
                        }

                        return true;
                    }
                    // This case occurs when the mouse is outside the table and approaching the
                    // bottom edge.
                    else if (
                        event.clientY >= bottom &&
                        event.clientY - bottom <= halfColumnResizeHandleWidth
                    ) {
                        cellPos = getEdgeContentTableCell(
                            view,
                            event,
                            "bottom",
                            halfColumnResizeHandleWidth,
                        );
                        return true;
                    } else {
                        return false;
                    }
                };

                // If the user was hovering over a column grip then try to maintain the
                // horizontal column grip before switching to checking for vertical row grips
                // or column resize handles.
                if (pluginState?.hovering.type === "ColumnGrip") {
                    if (!tryHorizontal()) {
                        tryVertical();
                    }
                } else {
                    if (!tryVertical()) {
                        tryHorizontal();
                    }
                }
            }
        }
    }

    if (
        type !== (pluginState?.hovering.type ?? null) ||
        cellPos !== (pluginState?.hovering.cellPos ?? null)
    ) {
        if (cellPos === null) {
            dispatchContentEditorTablePluginAction({type: "ClearHovering"})(
                view.state,
                view.dispatch,
            );
        } else {
            switch (type) {
                case null: {
                    dispatchContentEditorTablePluginAction({type: "ClearHovering"})(
                        view.state,
                        view.dispatch,
                    );
                    break;
                }
                case "ColumnResizeHandle": {
                    dispatchContentEditorTablePluginAction({
                        type: "SetHoveringColumnResizeHandle",
                        mouseOverTime: Date.now(),
                        cellPos,
                    })(view.state, view.dispatch);
                    break;
                }
                case "RowGrip": {
                    dispatchContentEditorTablePluginAction({
                        type: "SetHoveringRowGrip",
                        mouseOverTime: Date.now(),
                        cellPos,
                    })(view.state, view.dispatch);
                    break;
                }
                case "ColumnGrip": {
                    dispatchContentEditorTablePluginAction({
                        type: "SetHoveringColumnGrip",
                        mouseOverTime: Date.now(),
                        cellPos,
                    })(view.state, view.dispatch);
                    break;
                }
                default:
                    throw exhaustive(type);
            }
        }
    }
}

// Handles mouse leave event to reset the active handle
function handleMouseLeave(view: EditorView): void {
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (pluginState?.type === "Hovering" && !pluginState.hovering.dragging) {
        dispatchContentEditorTablePluginAction({type: "ClearHovering"})(view.state, view.dispatch);
    }
}

// Initiates the column resizing process on mouse down
function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
    // Ignore right clicks.
    if (event.button !== 0) return false;

    if (handleDraggingCellSelectionMouseDown(view, event)) return true;

    const targetElement = event.target as HTMLElement;

    if (targetElement.classList.contains(contentStyles.tableRowSelectionGripClassName)) {
        return handleGripMouseDown(view, event);
    } else if (targetElement.classList.contains(contentStyles.tableColumnSelectionGripClassName)) {
        return handleGripMouseDown(view, event);
    }

    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (
        pluginState?.type !== "Hovering" ||
        pluginState.hovering.dragging ||
        pluginState.hovering.isWaitingForMouseOverDelay
    ) {
        return false;
    }

    switch (pluginState.hovering.type) {
        case "ColumnResizeHandle": {
            return handleColumnResizeHandleMouseDown(view, event);
        }
        case "RowGrip": {
            const $cell = view.state.doc.resolve(pluginState.hovering.cellPos);
            assert($cell.parent.type.name === "table");

            const tablePos = $cell.start();
            const table = $cell.node();
            const tableMap = ContentTableMap.get(table);
            const rowIndex = tableMap.getRowCount($cell.pos + 1 - tablePos);

            selectContentTableRow(tablePos, rowIndex)(view.state, view.dispatch);

            return handleGripMouseDown(view, event);
        }
        case "ColumnGrip": {
            const $cell = view.state.doc.resolve(pluginState.hovering.cellPos);

            let tablePos: number;
            let table: Node;
            let tableMap: ContentTableMap;
            let columnIndex: number;

            if ($cell.parent.type.name === "table") {
                tablePos = $cell.start();
                table = $cell.node();
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos + 1 - tablePos);
            } else {
                assert($cell.parent.type.name === "tableRow");

                tablePos = $cell.start(-1);
                table = $cell.node(-1);
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos - tablePos) + 1;
            }

            selectContentTableColumn(tablePos, columnIndex)(view.state, view.dispatch);

            return handleGripMouseDown(view, event);
        }
        default:
            throw exhaustive(pluginState.hovering);
    }
}

// Handle mouse down event for table, responsible for creating a cell selection
// when the user drags over a cell
//
// Originally, this function is from `prosemirror-tables`'s `src/input.ts`
// file.
function handleDraggingCellSelectionMouseDown(view: EditorView, startEvent: MouseEvent): boolean {
    if (startEvent.ctrlKey || startEvent.metaKey) return false;

    // if the user is resizing a column, don't create a cell selection
    const pluginState = contentEditorTablePluginKey.getState(view.state);
    if (pluginState && pluginState?.type !== "DraggingCellSelection") return false;

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
            contentEditorTablePluginKey.getState(view.state)?.type !== "DraggingCellSelection";
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
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("dragstart", handleDragStart);
        if (contentEditorTablePluginKey.getState(view.state)?.type === "DraggingCellSelection") {
            dispatchContentEditorTablePluginAction({type: "ClearDraggingSelectionStartCellPos"})(
                view.state,
                view.dispatch,
            );
        }
    }

    function handleMouseMove(event: MouseEvent): void {
        const pluginState = contentEditorTablePluginKey.getState(view.state);
        const anchor =
            pluginState?.type === "DraggingCellSelection" ? pluginState.startCellPos : null;
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

    function handleDragStart(event: Event) {
        // Don't allow browser drag-and-drop if there's currently a cell selection.
        // We've observed sometimes dragging in a selected cell will trigger browser
        // drag-and-drop instead of picking a new cell selection.
        if (view.state.selection instanceof ContentTableCellSelection) {
            event.preventDefault();
        } else {
            stop();
        }
    }

    function handleMouseUp() {
        stop();
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("mouseup", handleMouseUp);

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

function handleColumnResizeHandleMouseDown(view: EditorView, event: MouseEvent): boolean {
    {
        const pluginState = contentEditorTablePluginKey.getState(view.state);
        assert(
            pluginState?.type === "Hovering" && pluginState.hovering.type === "ColumnResizeHandle",
        );

        const draggingState = getContentEditorTablePluginColumnResizeHandleDraggingState(
            view.state.doc,
            pluginState.hovering.cellPos,
        );

        const tableElement = draggingState.getTableElement(view);
        if (!tableElement) return false;

        const viewComputedStyle = getComputedStyle(view.dom);

        dispatchContentEditorTablePluginAction({
            type: "SetHoveringColumnResizeHandleDragging",
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
        if (pluginState?.type !== "Hovering" || !pluginState.hovering.dragging) {
            finish();
            return;
        }

        const tableElement = pluginState.hovering.dragging.state.getTableElement(view);
        if (!tableElement) {
            finish();
            return;
        }

        const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
            event.clientX,
            pluginState.hovering.dragging,
        );

        updateContentTableColumnsOnResize(
            pluginState.hovering.dragging.state.oldTable,
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
        const draggingState =
            pluginState?.type === "Hovering" ? pluginState?.hovering?.dragging : null;
        if (!draggingState) return;

        const {tableWidth: newTableWidth, columnWidths: newColumnWidths} =
            getContentTableColumnResizeDraggingStateNewColumnWidths(lastClientX, draggingState);

        dispatchContentEditorTablePluginAction({
            type: "SetHoveringColumnResizeHandleDragging",
            dragging: null,
        })(view.state, transaction => {
            if (newTableWidth === undefined) {
                transaction.setNodeAttribute(
                    draggingState.state.tablePos - 1,
                    "columnWidths",
                    newColumnWidths,
                );
            } else {
                transaction.setNodeMarkup(draggingState.state.tablePos - 1, null, {
                    ...draggingState.state.oldTable.attrs,
                    tableWidth: newTableWidth,
                    columnWidths: newColumnWidths,
                });
            }

            view.dispatch(transaction);
        });
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Alt") {
            dispatchContentEditorTablePluginAction({
                type: "SetHoveringColumnResizeHandleIsSnapping",
                isSnapping: false,
            })(view.state, view.dispatch);

            const pluginState = contentEditorTablePluginKey.getState(view.state);
            if (pluginState?.type !== "Hovering" || !pluginState.hovering.dragging) {
                finish();
                return;
            }

            const tableElement = pluginState.hovering.dragging.state.getTableElement(view);
            if (!tableElement) {
                finish();
                return;
            }

            const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.hovering.dragging,
            );

            updateContentTableColumnsOnResize(
                pluginState.hovering.dragging.state.oldTable,
                tableElement,
                newTableAndColumnWidths,
            );
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        if (event.key === "Alt") {
            dispatchContentEditorTablePluginAction({
                type: "SetHoveringColumnResizeHandleIsSnapping",
                isSnapping: true,
            })(view.state, view.dispatch);

            const pluginState = contentEditorTablePluginKey.getState(view.state);
            if (pluginState?.type !== "Hovering" || !pluginState.hovering.dragging) {
                finish();
                return;
            }

            const tableElement = pluginState.hovering.dragging.state.getTableElement(view);
            if (!tableElement) {
                finish();
                return;
            }

            const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.hovering.dragging,
            );

            updateContentTableColumnsOnResize(
                pluginState.hovering.dragging.state.oldTable,
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

function handleGripMouseDown(view: EditorView, event: MouseEvent): boolean {
    // Must have a cell selection to drag the cell selection.
    if (!(view.state.selection instanceof ContentTableCellSelection)) return false;

    const isRowSelection = view.state.selection.isRowSelection();
    const isColumnSelection = view.state.selection.isColumnSelection();

    const {tablePos, tableMap, tableRect} = view.state.selection;

    let element: globalThis.Node | null = view.domAtPos(tablePos).node;
    while (element && element.nodeName != "TABLE") element = element.parentNode;

    const tableElement = element as HTMLTableElement | null;
    if (!tableElement) return false;

    const tableCellSelectionElement = tableElement.querySelector(
        `.${contentStyles.tableCellSelectionClassName}`,
    );
    if (!tableCellSelectionElement) return false;

    const tableCellSelectionRect = tableCellSelectionElement.getBoundingClientRect();

    const startX = event.clientX;
    const startY = event.clientY;

    function move(event: MouseEvent): void {
        if (!event.which) {
            finish();
            return;
        }

        // Wait until the user has moved more than 4px with their drag to actually
        // start the dragging state. This way if the user clicks on a grip to select
        // the column or row we don't immediately show the drag phantom.
        if (
            !isDragging &&
            Math.sqrt(
                Math.abs(event.clientX - startX) ** 2 + Math.abs(event.clientY - startY) ** 2,
            ) >= 4
        ) {
            startDragging();
        }

        if (dragPhantomElement !== null) {
            if (isColumnSelection) {
                dragPhantomElement.style.transform = `translateX(${event.clientX - startX}px)`;
            } else {
                dragPhantomElement.style.transform = `translateY(${event.clientY - startY}px)`;
            }
        }
    }

    // Finalizes the resizing process when the mouse is released
    function finish() {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        dragCoverElement.remove();

        if (isDragging) {
            dispatchContentEditorTablePluginAction({type: "ClearDraggingGrip"})(
                view.state,
                view.dispatch,
            );
        }
    }

    // Block the DOM with a cover element so we don't trigger hover effects and the
    // cursor always stays the same.
    const dragCoverElement = document.createElement("div");
    document.body.appendChild(dragCoverElement);

    dragCoverElement.className = sprinkles({
        position: "absolute",
        inset: "0",
        zIndex: "70",
        cursor: "grabbing",
    });

    let isDragging = false;
    let dragPhantomElement: HTMLDivElement | null = null;

    function startDragging() {
        assert(!isDragging);
        isDragging = true;

        dispatchContentEditorTablePluginAction({
            type: "SetDraggingGrip",
        })(view.state, view.dispatch);

        if (isRowSelection && isColumnSelection) return;

        dragPhantomElement = document.createElement("div");
        dragCoverElement.appendChild(dragPhantomElement);

        dragPhantomElement.className = sprinkles({
            position: "absolute",
            pointerEvents: "none",
            display: "grid",
        });

        dragPhantomElement.style.width = `${tableCellSelectionRect.width}px`;
        dragPhantomElement.style.height = `${tableCellSelectionRect.height}px`;
        dragPhantomElement.style.left = `${tableCellSelectionRect.left}px`;
        dragPhantomElement.style.top = `${tableCellSelectionRect.top}px`;

        const dragPhantomBorderElement = document.createElement("div");
        dragPhantomElement.appendChild(dragPhantomBorderElement);

        dragPhantomBorderElement.className = sprinkles({
            zIndex: "10",
            position: "absolute",
            inset: "0",
            border: "theme-40-const",
            borderWidth: "thick",
        });

        const dragPhantomGripElement = document.createElement("div");
        dragPhantomElement.appendChild(dragPhantomGripElement);

        if (isColumnSelection) {
            dragPhantomGripElement.className = contentStyles.tableColumnGripBaseClassName;
            dragPhantomGripElement.style.width = "100%";
            dragPhantomGripElement.innerHTML = dotsSixIconSvg();
        } else {
            dragPhantomGripElement.className = contentStyles.tableRowGripBaseClassName;
            dragPhantomGripElement.style.height = "100%";
            dragPhantomGripElement.innerHTML = dotsSixVerticalIconSvg();
        }

        const columnWidthPxs = [];
        const rowHeightPxs = [];

        let columnIndex = tableRect.left;
        let rowIndex = tableRect.top;

        while (columnIndex < tableRect.right || rowIndex < tableRect.bottom) {
            const actualColumnIndex = Math.min(columnIndex, tableRect.right - 1);
            const actualRowIndex = Math.min(rowIndex, tableRect.bottom - 1);

            const tableCellElement = assertExists(
                tableElement!.querySelector(
                    `tr:nth-of-type(${actualRowIndex + 1}) td:nth-of-type(${
                        actualColumnIndex + 1
                    })`,
                ),
            );
            const tableCellRect = tableCellElement.getBoundingClientRect();

            columnWidthPxs[actualColumnIndex - tableRect.left] =
                tableCellRect.width - (actualColumnIndex === tableMap.width - 1 ? 1 : 0);
            rowHeightPxs[actualRowIndex - tableRect.top] = tableCellRect.height;

            columnIndex = Math.min(columnIndex + 1, tableRect.right);
            rowIndex = Math.min(rowIndex + 1, tableRect.bottom);
        }

        dragPhantomElement.style.gridTemplateColumns = columnWidthPxs
            .map(columnWidthPx => `${columnWidthPx}px`)
            .join(" ");

        dragPhantomElement.style.gridTemplateRows = rowHeightPxs
            .map(rowHeightPx => `${rowHeightPx}px`)
            .join(" ");

        const dragPhantomCellClassName = sprinkles({
            backgroundColor: "grey-0-opacity-80",
        });

        const dragPhantomCellBoxShadow = `inset 1px 1px 0 0 ${colorSchemeVars["grey-10"]}, 0 1px 0 0 ${colorSchemeVars["grey-10"]}, 1px 0 0 0 ${colorSchemeVars["grey-10"]}`;

        for (let i = 0; i < columnWidthPxs.length * rowHeightPxs.length; i++) {
            const dragPhantomCellElement = document.createElement("div");
            dragPhantomElement.appendChild(dragPhantomCellElement);

            dragPhantomCellElement.className = dragPhantomCellClassName;
            dragPhantomCellElement.style.boxShadow = dragPhantomCellBoxShadow;
        }
    }

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

    return null;
}

// Determines the cell at the edge of the column being resized
function getEdgeContentTableCell(
    view: EditorView,
    event: MouseEvent,
    side: "left" | "right" | "top" | "bottom",
    handleWidth: number,
): number | null {
    // posAtCoords returns inconsistent positions when cursor is moving
    // across a collapsed table border. Use an offset to adjust the
    // target viewport coordinates away from the table border.
    const found = view.posAtCoords({
        left: event.clientX + (side === "right" ? -handleWidth : side === "left" ? handleWidth : 0),
        top: event.clientY + (side === "top" ? handleWidth : side === "bottom" ? -handleWidth : 0),
    });
    if (!found) return null;

    const {pos} = found;
    const $pos = view.state.doc.resolve(pos);
    const $cell = contentTableCellAround($pos);
    if (!$cell) return null;

    if (side === "right") return $cell.pos;

    const tablePos = $cell.start(-1);
    const table = $cell.node(-1);
    const tableMap = ContentTableMap.get(table);
    const index = tableMap.map.indexOf($cell.pos - tablePos);

    if (index % tableMap.width !== 0) {
        return tablePos + tableMap.map[index - 1]!;
    } else {
        return tablePos + tableMap.map[index]! - 1;
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
    const cellSelectionElement = new Lazy<HTMLElement>(() => {
        const cellSelectionElement = document.createElement("div");
        cellSelectionElement.className = contentStyles.tableCellSelectionClassName;
        return cellSelectionElement;
    });

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

    const rowGripElement = new Lazy<HTMLElement>(() => {
        const rowGripElement = document.createElement("div");
        rowGripElement.className = `${contentStyles.tableRowGripBaseClassName} ${contentStyles.tableRowGripClassName}`;
        rowGripElement.innerHTML = dotsSixVerticalIconSvg();
        return rowGripElement;
    });

    const rowSelectionGripElement = new Lazy<HTMLElement>(() => {
        const rowSelectionGripElement = document.createElement("div");
        rowSelectionGripElement.className = `${contentStyles.tableRowGripBaseClassName} ${contentStyles.tableRowSelectionGripClassName}`;
        rowSelectionGripElement.innerHTML = dotsSixVerticalIconSvg();
        return rowSelectionGripElement;
    });

    const columnGripElement = new Lazy<HTMLElement>(() => {
        const columnGripElement = document.createElement("div");
        columnGripElement.className = `${contentStyles.tableColumnGripBaseClassName} ${contentStyles.tableColumnGripClassName}`;
        columnGripElement.innerHTML = dotsSixIconSvg();
        return columnGripElement;
    });

    const columnSelectionGripElement = new Lazy<HTMLElement>(() => {
        const columnSelectionGripElement = document.createElement("div");
        columnSelectionGripElement.className = `${contentStyles.tableColumnGripBaseClassName} ${contentStyles.tableColumnSelectionGripClassName}`;
        columnSelectionGripElement.innerHTML = dotsSixIconSvg();
        return columnSelectionGripElement;
    });

    return {
        cellSelectionElement,
        columnResizeHandleElement,
        rightEdgeColumnResizeHandleElement,
        rowGripElement,
        rowSelectionGripElement,
        columnGripElement,
        columnSelectionGripElement,
    };
}

function drawContentEditorTableCellSelection(
    elementCache: ContentEditorTablePluginDecorationElementCache,
    state: EditorState,
    decorations: Array<Decoration>,
) {
    if (!(state.selection instanceof ContentTableCellSelection)) return;

    const {tablePos, tableMap, tableRect} = state.selection;

    decorations.push(
        Decoration.widget(tablePos, () => {
            const cellSelectionElement = elementCache.cellSelectionElement.get();

            cellSelectionElement.style.gridRow = `${tableRect.top + 1} / ${tableRect.bottom + 1}`;
            cellSelectionElement.style.gridColumn = `${tableRect.left + 1} / ${
                tableRect.right + 1
            }`;

            if (tableRect.right === tableMap.width) {
                cellSelectionElement.classList.add(
                    contentStyles.tableRightEdgeCellSelectionClassName,
                );
            } else {
                cellSelectionElement.classList.remove(
                    contentStyles.tableRightEdgeCellSelectionClassName,
                );
            }

            return cellSelectionElement;
        }),
    );

    if (state.selection.isRowSelection()) {
        decorations.push(
            Decoration.widget(tablePos, () => {
                const rowSelectionGripElement = elementCache.rowSelectionGripElement.get();

                rowSelectionGripElement.style.gridRow = `${tableRect.top + 1} / ${
                    tableRect.bottom + 1
                }`;

                return rowSelectionGripElement;
            }),
        );
    }

    if (state.selection.isColumnSelection()) {
        decorations.push(
            Decoration.widget(tablePos, () => {
                const columnSelectionGripElement = elementCache.columnSelectionGripElement.get();

                columnSelectionGripElement.style.gridColumn = `${tableRect.left + 1} / ${
                    tableRect.right + 1
                }`;

                if (tableRect.right === tableMap.width) {
                    columnSelectionGripElement.classList.add(
                        contentStyles.tableRightEdgeColumnGripBaseClassName,
                    );
                } else {
                    columnSelectionGripElement.classList.remove(
                        contentStyles.tableRightEdgeColumnGripBaseClassName,
                    );
                }

                return columnSelectionGripElement;
            }),
        );
    }
}

// Handles the decorations for the column resize handle
function drawContentEditorTablePluginHoveringStateDecorations(
    elementCache: ContentEditorTablePluginDecorationElementCache,
    state: EditorState,
    hovering: ContentEditorTablePluginHoveringState,
    decorations: Array<Decoration>,
) {
    const $cell = state.doc.resolve(hovering.cellPos);

    switch (hovering.type) {
        case "ColumnResizeHandle": {
            assert($cell.parent.type.name === "tableRow");

            const tablePos = $cell.start(-1);
            const table = $cell.node(-1);
            const tableMap = ContentTableMap.get(table);
            const columnIndex = tableMap.getColumnCount($cell.pos - tablePos);

            decorations.push(
                Decoration.widget(tablePos, () => {
                    const columnResizeHandleElement =
                        columnIndex === tableMap.width - 1
                            ? elementCache.rightEdgeColumnResizeHandleElement.get()
                            : elementCache.columnResizeHandleElement.get();

                    columnResizeHandleElement.style.gridColumn = `${columnIndex + 2}`;

                    return columnResizeHandleElement;
                }),
            );
            break;
        }
        case "RowGrip": {
            assert($cell.parent.type.name === "table");

            const tablePos = $cell.start();
            const table = $cell.node();
            const tableMap = ContentTableMap.get(table);
            const rowIndex = tableMap.getRowCount($cell.pos + 1 - tablePos);

            decorations.push(
                Decoration.widget(tablePos, () => {
                    const rowGripElement = elementCache.rowGripElement.get();
                    rowGripElement.style.gridRow = `${rowIndex + 1} / ${rowIndex + 2}`;
                    return rowGripElement;
                }),
            );
            break;
        }
        case "ColumnGrip": {
            let tablePos: number;
            let table: Node;
            let tableMap: ContentTableMap;
            let columnIndex: number;

            if ($cell.parent.type.name === "table") {
                tablePos = $cell.start();
                table = $cell.node();
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos + 1 - tablePos);
            } else {
                assert($cell.parent.type.name === "tableRow");

                tablePos = $cell.start(-1);
                table = $cell.node(-1);
                tableMap = ContentTableMap.get(table);
                columnIndex = tableMap.getColumnCount($cell.pos - tablePos) + 1;
            }

            decorations.push(
                Decoration.widget(tablePos, () => {
                    const columnGripElement = elementCache.columnGripElement.get();
                    columnGripElement.style.gridColumn = `${columnIndex + 1} / ${columnIndex + 2}`;
                    return columnGripElement;
                }),
            );
            break;
        }
        default:
            throw exhaustive(hovering);
    }
}
