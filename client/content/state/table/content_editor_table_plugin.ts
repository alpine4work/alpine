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
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/state/add_unfocusable_button_behavior_to_element.js";
import {contentTableCellAround} from "~/client/content/state/table/content_table_client_util.js";
import {
    addContentTableRowAtIndex,
    moveContentTableColumn,
    moveContentTableRow,
    selectContentTableColumn,
    selectContentTableRow,
} from "~/client/content/state/table/content_table_commands.js";
import {fixContentTables} from "~/client/content/state/table/content_table_fix_tables.js";
import {getContentTableColumnResizeDraggingStateNewColumnWidths} from "~/client/content/state/table/helpers/get_content_table_column_resize_dragging_state_new_column_widths.js";
import {ContentEditorTableLayout} from "~/client/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {forceUpdateAllChildOverlayPositions} from "~/client/design/overlay_helpers.js";
import {ElementEventEmitter} from "~/client/helpers/element_event_emitter.js";
import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
import {plusIconSvg} from "~/client/icons/plus_icon_svg.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {
    fileClassName,
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
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";

const contentEditorTablePluginKey = new PluginKey<ContentEditorTablePluginState>(
    "contentEditorTable",
);

const optimisticContentEditorTableLayoutEventEmitter = new ElementEventEmitter<
    ContentEditorTableLayout & {scrollLeftPx?: number}
>("optimistictablelayout");

/**
 * Subscribe to optimistic table layouts for the provided `<table>` element.
 */
export function subscribeToOptimisticContentEditableTableLayoutEvent(
    element: HTMLTableElement,
    listener: (layout: ContentEditorTableLayout & {scrollLeftPx?: number}) => void,
): () => void {
    return optimisticContentEditorTableLayoutEventEmitter.subscribe(element, listener);
}

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
    let currentView: EditorView | null = null;

    const elementCache = createContentEditorTablePluginDecorationElementCache(() => currentView);

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

            createSelectionBetween: view => {
                return contentEditorTablePluginKey.getState(view.state)?.type ===
                    "DraggingCellSelection"
                    ? view.state.selection
                    : null;
            },

            decorations: state => {
                const pluginState = contentEditorTablePluginKey.getState(state);

                const decorations: Array<Decoration> = [];

                if (pluginState?.type === "DraggingGrip" && pluginState.dropTarget !== null) {
                    drawContentEditorPluginDraggingGripDropTargetDecorations(
                        elementCache,
                        state,
                        pluginState.tablePos,
                        pluginState.dropTarget,
                        decorations,
                    );
                } else {
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
        view: view => {
            currentView = view;

            let timeout: Timeout | null = null;

            return {
                update: view => {
                    currentView = view;

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
                destroy: () => {
                    currentView = null;
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
              readonly routeLayout: RouteLayout;
              readonly tableWrapperWidthPx: number;
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
          readonly type: "SetHoveringAddRowBumper";
          readonly mouseOverTime: number;
          readonly cellPos: number;
      }
    | {
          readonly type: "ClearDraggingGrip";
      }
    | {
          readonly type: "SetDraggingGrip";
          readonly tablePos: number;
      }
    | {
          readonly type: "SetDraggingGripDropTarget";
          readonly dropTarget: ContentEditorTablePluginDraggingGripDropTargetState;
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
          readonly tablePos: number;
          readonly dropTarget: ContentEditorTablePluginDraggingGripDropTargetState | null;
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
              readonly routeLayout: RouteLayout;
              readonly tableWrapperWidthPx: number;
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
      }
    | {
          readonly type: "AddRowBumper";
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

type ContentEditorTablePluginDraggingGripDropTargetState =
    | {readonly type: "Row"; readonly rowIndex: number}
    | {readonly type: "Column"; readonly columnIndex: number};

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
                const {deleted, pos} = transaction.mapping.mapResult(state.tablePos);
                state = deleted ? null : {...state, tablePos: pos};
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
        case "SetHoveringAddRowBumper": {
            return {
                type: "Hovering",
                hovering: {
                    type: "AddRowBumper",
                    mouseOverTime: action.mouseOverTime,
                    // Don't delay showing this UI if we already have some other active UI.
                    isWaitingForMouseOverDelay: state?.type !== "Hovering",
                    cellPos: action.cellPos,
                    dragging: null,
                },
            };
        }
        case "ClearDraggingGrip": {
            if (state?.type !== "DraggingGrip") return state;
            return null;
        }
        case "SetDraggingGrip": {
            return {
                type: "DraggingGrip",
                tablePos: action.tablePos,
                dropTarget: null,
            };
        }
        case "SetDraggingGripDropTarget": {
            if (state?.type !== "DraggingGrip") return state;
            return {...state, dropTarget: action.dropTarget};
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

    let type: "ColumnResizeHandle" | "RowGrip" | "ColumnGrip" | "AddRowBumper" | null = null;
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
    } else if (
        pluginState &&
        targetElement.classList.contains(contentStyles.tableAddRowBumperClassName)
    ) {
        type = "AddRowBumper";
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

                    // Check that the cell is a part of the last row. We only render an add row
                    // button for the last row.
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

                        if (rowIndex === tableMap.height - 1) {
                            type = "AddRowBumper";
                        }
                    }

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

                        // Check that the cell is a part of the last row. We only render an add row
                        // button for the last row.
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

                            if (rowIndex === tableMap.height - 1) {
                                type = "AddRowBumper";
                            }
                        }

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
                case "AddRowBumper": {
                    dispatchContentEditorTablePluginAction({
                        type: "SetHoveringAddRowBumper",
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
        case "AddRowBumper": {
            // Press events for this element are handled by
            // `addUnfocusableButtonBehaviorToElement()`.
            return false;
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

    // NOTE: To prevent default mouse down behavior of table which dragging files(fileRowTable)
    // we use this check.
    if ((startEvent.target as HTMLElement).closest(`.${fileClassName}`)) {
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

function handleColumnResizeHandleMouseDown(
    view: EditorView & {getRouteLayout?: () => RouteLayout},
    event: MouseEvent,
): boolean {
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

        const tableWrapper2Element = tableElement.parentElement!.parentElement!;
        const tableWrapperElement = tableWrapper2Element.parentElement!;

        // Sanity check
        assert(tableWrapperElement.classList.contains(tableWrapperClassName));

        dispatchContentEditorTablePluginAction({
            type: "SetHoveringColumnResizeHandleDragging",
            dragging: {
                startX: event.clientX,
                // This property is added to `EditorView` in `<ContentEditor>`.
                routeLayout: assertExists(view.getRouteLayout)(),
                tableWrapperWidthPx: tableWrapperElement.clientWidth,
                oldScrollLeftPx: tableWrapper2Element.scrollLeft,
                isSnapping: !event.altKey,
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

        const newTableLayout = getContentTableColumnResizeDraggingStateNewColumnWidths(
            event.clientX,
            pluginState.hovering.dragging,
        );

        optimisticContentEditorTableLayoutEventEmitter.emit(tableElement, newTableLayout);

        // If you're dragging the edge of a table to make the table larger while you
        // also have a selected file inside the table then we need to make sure the
        // blue focus ring and toolbar floating above the image move with the image.
        // The blue focus ring and toolbar are rendered with `<Overlay>`s that target
        // the element. So manually force all overlays targeting elements inside the
        // table to update their positions.
        //
        // Task with a video reproducing the bug:
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0qhp54p6crnsfj63fhbfnmmrc0
        forceUpdateAllChildOverlayPositions(tableElement);
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

            const newTableLayout = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.hovering.dragging,
            );

            optimisticContentEditorTableLayoutEventEmitter.emit(tableElement, newTableLayout);

            // If you're dragging the edge of a table to make the table larger while you
            // also have a selected file inside the table then we need to make sure the
            // blue focus ring and toolbar floating above the image move with the image.
            // The blue focus ring and toolbar are rendered with `<Overlay>`s that target
            // the element. So manually force all overlays targeting elements inside the
            // table to update their positions.
            //
            // Task with a video reproducing the bug:
            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0qhp54p6crnsfj63fhbfnmmrc0
            forceUpdateAllChildOverlayPositions(tableElement);
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

            const newTableLayout = getContentTableColumnResizeDraggingStateNewColumnWidths(
                lastClientX,
                pluginState.hovering.dragging,
            );

            optimisticContentEditorTableLayoutEventEmitter.emit(tableElement, newTableLayout);

            // If you're dragging the edge of a table to make the table larger while you
            // also have a selected file inside the table then we need to make sure the
            // blue focus ring and toolbar floating above the image move with the image.
            // The blue focus ring and toolbar are rendered with `<Overlay>`s that target
            // the element. So manually force all overlays targeting elements inside the
            // table to update their positions.
            //
            // Task with a video reproducing the bug:
            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0qhp54p6crnsfj63fhbfnmmrc0
            forceUpdateAllChildOverlayPositions(tableElement);
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

function handleGripMouseDown(view: EditorView, initialEvent: MouseEvent): boolean {
    // Must have a cell selection to drag the cell selection.
    if (!(view.state.selection instanceof ContentTableCellSelection)) return false;

    const isRowSelection = view.state.selection.isRowSelection();
    const isColumnSelection = view.state.selection.isColumnSelection();

    const {tablePos: initialTablePos, tableRect} = view.state.selection;

    let element: globalThis.Node | null = view.domAtPos(initialTablePos).node;
    while (element && element.nodeName != "TABLE") element = element.parentNode;

    if (!element) return false;
    const tableElement = element as HTMLTableElement;
    const tableWrapper2Element = assertExists(tableElement.parentElement?.parentElement);

    const tableCellSelectionElement = tableElement.querySelector(
        `.${contentStyles.tableCellSelectionClassName}`,
    );
    if (!tableCellSelectionElement) return false;

    const initialTableCellSelectionRect = tableCellSelectionElement.getBoundingClientRect();

    const initialMouseXPx = initialEvent.clientX;
    const initialMouseYPx = initialEvent.clientY;
    let mouseXPx = initialMouseXPx;
    let mouseYPx = initialMouseYPx;

    let autoScrollDirectionX: number = 0;
    let autoScrollSpeedX: number = 0;
    let autoScrollInterval: Interval | null = null;

    dispatchContentEditorTablePluginAction({
        type: "SetDraggingGrip",
        tablePos: initialTablePos,
    })(view.state, view.dispatch);

    function move(event: MouseEvent): void {
        mouseXPx = event.clientX;
        mouseYPx = event.clientY;

        if (!event.which) {
            finish();
            return;
        }

        const pluginState = contentEditorTablePluginKey.getState(view.state);
        if (pluginState?.type !== "DraggingGrip") {
            finish();
            return;
        }

        // If the user has selected the full table, we allow grips to be clicked and
        // turn the cursor into a grabbing cursor as feedback for clicking, but
        // dragging does nothing.
        if (isRowSelection && isColumnSelection) return;

        // Wait until the user has moved more than 4px with their drag to actually
        // start the dragging state. This way if the user clicks on a grip to select
        // the column or row we don't immediately show the drag phantom.
        if (!hasAddedDragPhantomElement) {
            const distance = Math.sqrt(
                Math.abs(mouseXPx - initialMouseXPx) ** 2 +
                    Math.abs(mouseYPx - initialMouseYPx) ** 2,
            );

            if (distance < 4) {
                return;
            } else {
                addDragPhantomElement();
            }
        }

        if (dragPhantomElement !== null) {
            if (isColumnSelection) {
                dragPhantomElement.style.transform = `translateX(${mouseXPx - initialMouseXPx}px)`;
            } else {
                dragPhantomElement.style.transform = `translateY(${mouseYPx - initialMouseYPx}px)`;
            }
        }

        updateDropTarget();
        updateAutoScroll();
    }

    function updateDropTarget() {
        const pluginState = contentEditorTablePluginKey.getState(view.state);
        if (pluginState?.type !== "DraggingGrip") return;

        const dropTarget = getDropTarget();

        const isDropTargetEqual =
            pluginState.dropTarget !== null &&
            ((pluginState.dropTarget.type === "Row" &&
                dropTarget.type === "Row" &&
                pluginState.dropTarget.rowIndex === dropTarget.rowIndex) ||
                (pluginState.dropTarget.type === "Column" &&
                    dropTarget.type === "Column" &&
                    pluginState.dropTarget.columnIndex === dropTarget.columnIndex));

        if (!isDropTargetEqual) {
            dispatchContentEditorTablePluginAction({
                type: "SetDraggingGripDropTarget",
                dropTarget,
            })(view.state, view.dispatch);
        }
    }

    function updateAutoScroll() {
        const tableWrapper2Rect = tableWrapper2Element.getBoundingClientRect();
        const thresholdWidth = tableWrapper2Rect.width * 0.1;

        if (mouseXPx < tableWrapper2Rect.left + thresholdWidth) {
            autoScrollDirectionX = -1;

            // Speed calculation taken from `getScrollDirectionAndSpeed()`:
            // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/utilities/scroll/getScrollDirectionAndSpeed.ts#L37-L41
            autoScrollSpeedX =
                10 *
                Math.abs((tableWrapper2Rect.left + thresholdWidth - mouseXPx) / thresholdWidth);
        } else if (mouseXPx > tableWrapper2Rect.right - thresholdWidth) {
            autoScrollDirectionX = 1;

            // Speed calculation taken from `getScrollDirectionAndSpeed()`:
            // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/utilities/scroll/getScrollDirectionAndSpeed.ts#L48-L53
            autoScrollSpeedX =
                10 *
                Math.abs((tableWrapper2Rect.right - thresholdWidth - mouseXPx) / thresholdWidth);
        } else {
            autoScrollInterval?.clear();
            autoScrollInterval = null;
            return;
        }

        if (autoScrollInterval === null) {
            autoScrollInterval = createInterval(() => {
                const deltaX = autoScrollSpeedX * autoScrollDirectionX;

                tableWrapper2Element.scrollLeft += deltaX;

                updateDropTarget();

                // 5ms interval approach taken from `useAutoScroller()`:
                // https://github.com/clauderic/dnd-kit/blob/e2a1776d0de657669192d3cfd1558e91905b5fad/packages/core/src/hooks/utilities/useAutoScroller.ts#L61
            }, 5);
        }
    }

    // Finalizes the resizing process when the mouse is released
    function finish() {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        autoScrollInterval?.clear();
        autoScrollInterval = null;
        dragCoverElement.remove();

        const pluginState = contentEditorTablePluginKey.getState(view.state);
        if (pluginState?.type !== "DraggingGrip") return;

        dispatchContentEditorTablePluginAction({
            type: "ClearDraggingGrip",
        })(view.state, view.dispatch);

        // If the user has selected the full table, we allow grips to be clicked and
        // turn the cursor into a grabbing cursor as feedback for clicking, but
        // dragging does nothing.
        if (isRowSelection && isColumnSelection) return;

        if (!hasAddedDragPhantomElement) return;

        const dropTarget = getDropTarget();

        switch (dropTarget.type) {
            case "Row": {
                moveContentTableRow(
                    pluginState.tablePos,
                    tableRect.top,
                    tableRect.bottom,
                    dropTarget.rowIndex,
                )(view.state, view.dispatch);
                break;
            }
            case "Column": {
                moveContentTableColumn(
                    pluginState.tablePos,
                    tableRect.left,
                    tableRect.right,
                    dropTarget.columnIndex,
                )(view.state, view.dispatch);
                break;
            }
            default:
                throw exhaustive(dropTarget);
        }
    }

    function getDropTarget(): ContentEditorTablePluginDraggingGripDropTargetState {
        const measureResult = measure();
        const tableRect = tableElement.getBoundingClientRect();

        if (isColumnSelection) {
            let offsetPx = tableRect.left;

            let columnIndex = 0;
            for (; columnIndex < measureResult.columnWidthPxs.length; columnIndex++) {
                const columnWidthPx = measureResult.columnWidthPxs[columnIndex]!;

                if (mouseXPx < offsetPx + columnWidthPx / 2) {
                    break;
                }

                offsetPx += columnWidthPx;
            }

            return {type: "Column", columnIndex};
        } else {
            let offsetPx = tableRect.top;

            let rowIndex = 0;
            for (; rowIndex < measureResult.rowHeightPxs.length; rowIndex++) {
                const rowHeightPx = measureResult.rowHeightPxs[rowIndex]!;

                if (mouseYPx < offsetPx + rowHeightPx / 2) {
                    break;
                }

                offsetPx += rowHeightPx;
            }

            return {type: "Row", rowIndex};
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

    let hasAddedDragPhantomElement = false;
    let dragPhantomElement: HTMLDivElement | null = null;

    function addDragPhantomElement() {
        assert(!hasAddedDragPhantomElement);
        hasAddedDragPhantomElement = true;

        // If the user has selected the full table, we allow grips to be clicked and
        // turn the cursor into a grabbing cursor as feedback for clicking, but
        // dragging does nothing.
        if (isRowSelection && isColumnSelection) return;

        dragPhantomElement = document.createElement("div");
        dragCoverElement.appendChild(dragPhantomElement);

        dragPhantomElement.className = sprinkles({
            position: "absolute",
            pointerEvents: "none",
            display: "grid",
        });

        dragPhantomElement.style.width = `${initialTableCellSelectionRect.width}px`;
        dragPhantomElement.style.height = `${initialTableCellSelectionRect.height}px`;
        dragPhantomElement.style.left = `${initialTableCellSelectionRect.left}px`;
        dragPhantomElement.style.top = `${initialTableCellSelectionRect.top}px`;

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

        const measureResult = measure();

        dragPhantomElement.style.gridTemplateColumns = createArrayWithLength(
            tableRect.right - tableRect.left,
            i => `${measureResult.columnWidthPxs[tableRect.left + i]!}px`,
        ).join(" ");

        dragPhantomElement.style.gridTemplateRows = createArrayWithLength(
            tableRect.bottom - tableRect.top,
            i => `${measureResult.rowHeightPxs[tableRect.top + i]!}px`,
        ).join(" ");

        const dragPhantomCellClassName = sprinkles({
            backgroundColor: "grey-0-opacity-90",
        });

        const dragPhantomCellBoxShadow = `inset 1px 1px 0 0 ${colorSchemeVars["grey-10"]}, 0 1px 0 0 ${colorSchemeVars["grey-10"]}, 1px 0 0 0 ${colorSchemeVars["grey-10"]}`;
        const lastDragPhantomCellInRowBoxShadow = `inset 1px 1px 0 0 ${colorSchemeVars["grey-10"]}, 0 1px 0 0 ${colorSchemeVars["grey-10"]}, inset -1px 0 0 0 ${colorSchemeVars["grey-10"]}`;

        for (let rowIndex = tableRect.top; rowIndex < tableRect.bottom; rowIndex++) {
            for (let columnIndex = tableRect.left; columnIndex < tableRect.right; columnIndex++) {
                const dragPhantomCellElement = document.createElement("div");
                dragPhantomElement.appendChild(dragPhantomCellElement);

                dragPhantomCellElement.className = dragPhantomCellClassName;

                if (columnIndex === measureResult.columnWidthPxs.length - 1) {
                    dragPhantomCellElement.style.boxShadow = lastDragPhantomCellInRowBoxShadow;
                } else {
                    dragPhantomCellElement.style.boxShadow = dragPhantomCellBoxShadow;
                }
            }
        }
    }

    type MeasureResult = {
        readonly widthPx: number;
        readonly heightPx: number;
        readonly columnWidthPxs: ReadonlyArray<number>;
        readonly rowHeightPxs: ReadonlyArray<number>;
    };

    let lastMeasureResult: {state: EditorState; result: MeasureResult} | null = null;

    function measure(): MeasureResult {
        if (lastMeasureResult === null || lastMeasureResult.state !== view.state) {
            lastMeasureResult = {state: view.state, result: actuallyMeasure()};
        }
        return lastMeasureResult.result;
    }

    function actuallyMeasure(): MeasureResult {
        const tableRect = tableElement.getBoundingClientRect();

        const firstTableRowElement = assertExists(tableElement.querySelector("tr:first-of-type"));
        const tableBodyElement = assertExists(firstTableRowElement.parentElement);

        const columnWidthPxs: Array<number> = [];
        const rowHeightPxs: Array<number> = [];

        for (const tableBodyChildElement of tableBodyElement.childNodes) {
            if (
                tableBodyChildElement instanceof HTMLElement &&
                tableBodyChildElement.nodeName === "TR"
            ) {
                const tableCellRect = assertExists(
                    findMapIterable(tableBodyChildElement.childNodes, tableRowChildElement =>
                        tableRowChildElement instanceof HTMLElement &&
                        tableRowChildElement.nodeName === "TD"
                            ? tableRowChildElement
                            : undefined,
                    ),
                ).getBoundingClientRect();
                rowHeightPxs.push(tableCellRect.height);
            }
        }

        for (const firstTableRowChildElement of firstTableRowElement.childNodes) {
            if (
                firstTableRowChildElement instanceof HTMLElement &&
                firstTableRowChildElement.nodeName === "TD"
            ) {
                const tableCellRect = firstTableRowChildElement.getBoundingClientRect();
                columnWidthPxs.push(tableCellRect.width);
            }
        }

        return {
            widthPx: tableRect.width,
            heightPx: tableRect.height,
            columnWidthPxs,
            rowHeightPxs,
        };
    }

    window.addEventListener("mouseup", finish);
    window.addEventListener("mousemove", move);

    // Unfocus the content editor while resizing a column. So the browser cursor
    // and pointer toolbar don't render.
    view.dom.blur();

    initialEvent.preventDefault();
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

type ContentEditorTablePluginDecorationElementCache = ReturnType<
    typeof createContentEditorTablePluginDecorationElementCache
>;

function createContentEditorTablePluginDecorationElementCache(
    getViewIfExists: () => EditorView | null,
) {
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

    const draggingGripRowDropTargetElement = new Lazy<HTMLElement>(() => {
        const draggingGripRowDropTargetElement = document.createElement("div");
        draggingGripRowDropTargetElement.className =
            contentStyles.tableDraggingGripRowDropTargetClassName;
        return draggingGripRowDropTargetElement;
    });

    const draggingGripColumnDropTargetElement = new Lazy<HTMLElement>(() => {
        const draggingGripColumnDropTargetElement = document.createElement("div");
        draggingGripColumnDropTargetElement.className =
            contentStyles.tableDraggingGripColumnDropTargetClassName;
        return draggingGripColumnDropTargetElement;
    });

    const addRowBumperElement = new Lazy<HTMLElement>(() => {
        const addRowBumperElement = document.createElement("div");
        addRowBumperElement.className = contentStyles.tableAddRowBumperClassName;

        const addRowBumperStickyElement = document.createElement("div");
        addRowBumperElement.appendChild(addRowBumperStickyElement);
        addRowBumperStickyElement.className = contentStyles.tableAddRowBumperStickyClassName;

        const addRowBumperIconButtonElement = document.createElement("div");
        addRowBumperStickyElement.appendChild(addRowBumperIconButtonElement);
        addRowBumperIconButtonElement.className =
            contentStyles.tableAddRowBumperIconButtonClassName;
        addRowBumperIconButtonElement.innerHTML = plusIconSvg();

        addUnfocusableButtonBehaviorToElement(addRowBumperElement, {
            pressClassName: contentStyles.tableAddRowBumperPressedClassName,
            onPress: () => {
                const view = assertExists(getViewIfExists());
                const pluginState = contentEditorTablePluginKey.getState(view.state);
                if (pluginState?.type !== "Hovering") return;
                if (pluginState.hovering.type !== "AddRowBumper") return;

                const $cell = view.state.doc.resolve(pluginState.hovering.cellPos);

                let tablePos: number;
                let table: Node;
                let tableMap: ContentTableMap;

                if ($cell.parent.type.name === "table") {
                    tablePos = $cell.start();
                    table = $cell.node();
                    tableMap = ContentTableMap.get(table);
                } else {
                    assert($cell.parent.type.name === "tableRow");

                    tablePos = $cell.start(-1);
                    table = $cell.node(-1);
                    tableMap = ContentTableMap.get(table);
                }

                addContentTableRowAtIndex(tablePos, tableMap.height)(view.state, transaction => {
                    view.dispatch(
                        // Also clear hovering state since adding a row with the "add row button" means
                        // the mouse implicitly won't be at the end of the table anymore.
                        transaction.setMeta(contentEditorTablePluginKey, {type: "ClearHovering"}),
                    );
                });
            },
        });

        return addRowBumperElement;
    });

    return {
        cellSelectionElement,
        columnResizeHandleElement,
        rightEdgeColumnResizeHandleElement,
        rowGripElement,
        rowSelectionGripElement,
        columnGripElement,
        columnSelectionGripElement,
        draggingGripRowDropTargetElement,
        draggingGripColumnDropTargetElement,
        addRowBumperElement,
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
        case "AddRowBumper": {
            let tablePos: number;

            if ($cell.parent.type.name === "table") {
                tablePos = $cell.start();
            } else {
                assert($cell.parent.type.name === "tableRow");

                tablePos = $cell.start(-1);
            }

            decorations.push(
                Decoration.widget(tablePos, view => {
                    // HACK(calebmer): I've seen some cases where `view.domAtPos()` returns the
                    // previous node when we pass in `tablePos`?? `tablePos + 2` reliably gets us
                    // either the first `<td>`, the first `<tr>`, or `<tbody>`.
                    let element: globalThis.Node | null = view.domAtPos(tablePos + 2).node;
                    while (
                        element instanceof HTMLElement &&
                        !element.classList.contains(tableWrapperClassName)
                    ) {
                        element = element.parentElement;
                    }

                    assert(element instanceof HTMLElement);
                    const tableWrapperElement = element;

                    const addRowBumperElement = elementCache.addRowBumperElement.get();
                    const addRowBumperStickyElement =
                        addRowBumperElement.firstElementChild as HTMLElement;
                    addRowBumperStickyElement.style.maxWidth = `${tableWrapperElement.clientWidth}px`;
                    return addRowBumperElement;
                }),
            );
            break;
        }
        default:
            throw exhaustive(hovering);
    }
}

function drawContentEditorPluginDraggingGripDropTargetDecorations(
    elementCache: ContentEditorTablePluginDecorationElementCache,
    state: EditorState,
    tablePos: number,
    dropTarget: ContentEditorTablePluginDraggingGripDropTargetState,
    decorations: Array<Decoration>,
) {
    switch (dropTarget.type) {
        case "Row": {
            decorations.push(
                Decoration.widget(tablePos, () => {
                    const draggingGripRowDropTargetElement =
                        elementCache.draggingGripRowDropTargetElement.get();
                    draggingGripRowDropTargetElement.style.gridRow = `${dropTarget.rowIndex + 1}`;
                    return draggingGripRowDropTargetElement;
                }),
            );
            break;
        }
        case "Column": {
            decorations.push(
                Decoration.widget(tablePos, () => {
                    const draggingGripColumnDropTargetElement =
                        elementCache.draggingGripColumnDropTargetElement.get();
                    draggingGripColumnDropTargetElement.style.gridColumn = `${
                        dropTarget.columnIndex + 1
                    }`;
                    return draggingGripColumnDropTargetElement;
                }),
            );
            break;
        }
        default:
            throw exhaustive(dropTarget);
    }
}
