/**
 * NOTE(rohitt-gupta, 2024-11-26): Forked from `prosemirror-tables` so we can
 * remove features we don't use and customize the user experience. We intend to
 * modify this file a lot so each modification may not be documented.
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
//
// This file defines a plugin that handles the drawing of cell
// selections and the basic user interactions for creating and working
// with such selections. It also makes sure that, after each
// transaction, the shapes of tables are normalized to be rectangular
// and not contain overlapping cells.

import {Plugin, PluginKey} from "prosemirror-state";
import {fixTables} from "~/client/content/internal/table/helpers/fixtables.js";
import {drawCellSelection, normalizeSelection} from "./content_table_cell_selection.js";

import {handleKeyDown, handleMouseDown, handlePaste, handleTripleClick} from "./helpers/input.js";

type TableEditingOptions = {
    allowTableNodeSelection?: boolean;
};

export const tableEditingKey = new PluginKey<number>("selectingCells");

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
 * @public
 */
export function contentTableEditingPlugin({
    allowTableNodeSelection = false,
}: TableEditingOptions = {}): Plugin {
    return new Plugin({
        key: tableEditingKey,

        // This piece of state is used to remember when a mouse-drag
        // cell-selection is happening, so that it can continue even as
        // transactions (which might move its anchor cell) come in.
        state: {
            init() {
                return null;
            },
            apply(tr, cur) {
                const set = tr.getMeta(tableEditingKey);
                if (set != null) return set == -1 ? null : set;
                if (cur == null || !tr.docChanged) return cur;
                const {deleted, pos} = tr.mapping.mapResult(cur);
                return deleted ? null : pos;
            },
        },

        props: {
            decorations: drawCellSelection,

            handleDOMEvents: {
                mousedown: handleMouseDown,
            },

            createSelectionBetween(view) {
                return tableEditingKey.getState(view.state) != null ? view.state.selection : null;
            },

            handleTripleClick,

            handleKeyDown,

            handlePaste,
        },

        appendTransaction(_, oldState, state) {
            return normalizeSelection(state, fixTables(state, oldState), allowTableNodeSelection);
        },
    });
}
