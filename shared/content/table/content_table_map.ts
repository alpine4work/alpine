/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove features
 * we don't use and customize the user experience. You can find the original file
 * in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/tablemap.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Because working with row and column-spanning cells is not quite trivial, this
// code builds up a descriptive structure for a given table node. The structures
// are cached with the (persistent) table nodes as key, so that they only have to
// be recomputed when the content of the table changes.
//
// This does mean that they have to store table-relative, not document-relative
// positions. So code that uses them will typically compute the start position of
// the table and offset positions passed to or gotten from this structure by that
// amount.

import {Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

type ContentTableMapProblem = {
    type: "missing";
    row: number;
    n: number;
};

let readFromCache: (key: Node) => ContentTableMap | undefined;
let addToCache: (key: Node, value: ContentTableMap) => ContentTableMap;

// Prefer using a weak map to cache table maps. Fall back on a fixed-size cache if
// that's not supported.
if (typeof WeakMap != "undefined") {
    // eslint-disable-next-line
    let cache = new WeakMap<Node, ContentTableMap>();
    readFromCache = key => cache.get(key);
    addToCache = (key, value) => {
        cache.set(key, value);
        return value;
    };
} else {
    const cache: Array<Node | ContentTableMap> = [];
    const cacheSize = 10;
    let cachePos = 0;
    readFromCache = key => {
        for (let i = 0; i < cache.length; i += 2)
            if (cache[i] == key) return cache[i + 1] as ContentTableMap;
    };
    addToCache = (key, value) => {
        if (cachePos == cacheSize) cachePos = 0;
        cache[cachePos++] = key;
        return (cache[cachePos++] = value);
    };
}

export interface ContentTableMapRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * A table map describes the structure of a given table. To avoid recomputing them
 * all the time, they are cached per table node. To be able to do that, positions
 * saved in the map are relative to the start of the table, rather than the start
 * of the document.
 */
export class ContentTableMap {
    constructor(
        /**
         * The table associated with this map.
         */
        public readonly table: Node,

        /**
         * The number of columns
         */
        public readonly width: number,

        /**
         * The number of rows
         */
        public readonly height: number,

        /**
         * A width \* height array with the start position of the cell covering that part
         * of the table in each slot
         */
        public readonly map: ReadonlyArray<number>,

        /**
         * An optional array of problems (cell overlap or non-rectangular shape) for the
         * table, used by the table normalizer.
         */
        public readonly problems: ReadonlyArray<ContentTableMapProblem> | null,

        /**
         * The width of the table as a percent of the block width. Will never be less
         * than 1.
         */
        public readonly tableWidth: number,

        /**
         * The width of columns in the table in fractional units. Usually the same as
         * `node.attrs.columnWidths` but we make sure to always have the same number of
         * columns as the `width` property in this object.
         *
         * - If there are more items in `node.attrs.columnWidths` than there are columns
         *   then we truncate the array to the actual table column count.
         *
         * - If there are fewer items in `node.attrs.columnWidths` than there are columns
         *   then we add 1 (the default column width) to the end of the array until we
         *   reach the actual table column count.
         */
        public readonly columnWidths: ReadonlyArray<number>,

        /**
         * The sum of all `columnWidths`.
         */
        public readonly totalColumnWidth: number,
    ) {}

    // Find the dimensions of the cell at the given position.
    findCell(pos: number): ContentTableMapRect {
        for (let i = 0; i < this.map.length; i++) {
            const curPos = this.map[i];
            if (curPos != pos) continue;

            const left = i % this.width;
            const top = (i / this.width) | 0;
            let right = left + 1;
            let bottom = top + 1;

            for (let j = 1; right < this.width && this.map[i + j] == curPos; j++) {
                right++;
            }
            for (let j = 1; bottom < this.height && this.map[i + this.width * j] == curPos; j++) {
                bottom++;
            }

            return {left, top, right, bottom};
        }
        throw new RangeError(`No table cell with offset ${pos} found`);
    }

    // Find the left side of the cell at the given position.
    getColumnCount(pos: number): number {
        for (let i = 0; i < this.map.length; i++) {
            if (this.map[i] === pos) {
                return i % this.width;
            }
        }
        throw new RangeError(`No table cell with offset ${pos} found`);
    }

    // Find the top side of the row at the given position.
    getRowCount(pos: number): number {
        for (let i = 0; i < this.map.length; i++) {
            if (this.map[i] === pos) {
                return Math.floor(i / this.width);
            }
        }
        throw new RangeError(`No table row with offset ${pos} found`);
    }

    // Find the next cell in the given direction, starting from the cell at `pos`, if
    // any.
    nextCell(pos: number, axis: "horiz" | "vert", dir: number): null | number {
        const {left, right, top, bottom} = this.findCell(pos);
        if (axis == "horiz") {
            if (dir < 0 ? left == 0 : right == this.width) return null;
            return this.map[top * this.width + (dir < 0 ? left - 1 : right)]!;
        } else {
            if (dir < 0 ? top == 0 : bottom == this.height) return null;
            return this.map[left + this.width * (dir < 0 ? top - 1 : bottom)]!;
        }
    }

    // Get the rectangle spanning the two given cells.
    rectBetween(a: number, b: number): ContentTableMapRect {
        const {left: leftA, right: rightA, top: topA, bottom: bottomA} = this.findCell(a);
        const {left: leftB, right: rightB, top: topB, bottom: bottomB} = this.findCell(b);
        return {
            left: Math.min(leftA, leftB),
            top: Math.min(topA, topB),
            right: Math.max(rightA, rightB),
            bottom: Math.max(bottomA, bottomB),
        };
    }

    // Return the position of all cells that have the top left corner in the given
    // rectangle.
    cellsInRect(rect: ContentTableMapRect): Array<number> {
        const result: Array<number> = [];
        const seen: Record<number, boolean> = {};
        for (let row = rect.top; row < rect.bottom; row++) {
            for (let col = rect.left; col < rect.right; col++) {
                const index = row * this.width + col;
                const pos = this.map[index]!;

                if (seen[pos]) continue;
                seen[pos] = true;

                if (
                    (col == rect.left && col && this.map[index - 1] == pos) ||
                    (row == rect.top && row && this.map[index - this.width] == pos)
                ) {
                    continue;
                }
                result.push(pos);
            }
        }
        return result;
    }

    // Return the position at which the cell at the given row and column starts, or
    // would start, if a cell started there.
    /**
     * Returns the position of the cell at the given row and column. @param row - The
     * row index of the cell (<= height - 1)
     */
    positionAt(row: number, col: number): number {
        for (let i = 0, rowStart = 0; ; i++) {
            const rowEnd = rowStart + this.table.child(i).nodeSize;
            if (i == row) {
                let index = col + row * this.width;
                const rowEndIndex = (row + 1) * this.width;
                // Skip past cells from previous rows (via rowspan)
                while (index < rowEndIndex && this.map[index]! < rowStart) index++;
                return index == rowEndIndex ? rowEnd - 1 : this.map[index]!;
            }
            rowStart = rowEnd;
        }
    }

    // Find the table map for the given table node.
    static get(table: Node): ContentTableMap {
        return readFromCache(table) || addToCache(table, computeMap(table));
    }
}

// This findWidth function calculates the width (number of columns) of a table.
// However, there's a bug in its implementation.This findWidth function calculates
// the width (number of columns) of a table. However, there's a bug in its
// implementation.
function findWidth(table: Node): number {
    let width = 0;
    for (let row = 0; row < table.childCount; row++) {
        const rowNode = table.child(row);
        width = Math.max(width, rowNode.childCount);
    }
    return width;
}

function computeMap(table: Node): ContentTableMap {
    assert(table.type.name === "table");

    const width = findWidth(table);
    const height = table.childCount;

    const map = [];
    let mapPos = 0;
    for (let i = 0, e = width * height; i < e; i++) map[i] = 0;

    // TODO(calebmer): I think we can delete the problem code here entirely.
    // `fixTable()` used to look at the problems array (in `prosemirror-tables`) but
    // now seems to directly find missing cell issues itself. Additionally when
    // `prosemirror-tables` had `colspan` and `rowspan` there were more problems to
    // detect. I'm not sure if the problems array is doing anything for us here at this
    // point.
    let problems: Array<ContentTableMapProblem> | null = null;

    for (let row = 0, pos = 0; row < height; row++) {
        const rowNode = table.child(row);
        pos++;
        for (let i = 0; i < rowNode.childCount; i++) {
            map[mapPos] = pos;
            mapPos += 1;
            pos += rowNode.child(i).nodeSize;
        }
        const expectedPos = (row + 1) * width;
        let missing = 0;
        while (mapPos < expectedPos) if (map[mapPos++] == 0) missing++;
        if (missing) (problems || (problems = [])).push({type: "missing", row, n: missing});
        pos++;
    }

    const originalColumnWidths: ReadonlyArray<number> = table.attrs.columnWidths ?? [];
    let columnWidths: ReadonlyArray<number>;

    if (width < originalColumnWidths.length) {
        columnWidths = originalColumnWidths.slice(0, width);
    } else if (width > originalColumnWidths.length) {
        const newColumnWidths = [...originalColumnWidths];

        while (newColumnWidths.length < width) {
            newColumnWidths.push(1);
        }

        columnWidths = newColumnWidths;
    } else {
        columnWidths = originalColumnWidths;
    }

    let totalColumnWidth = 0;
    for (const columnWidth of columnWidths) totalColumnWidth += columnWidth;

    let tableWidth = table.attrs.tableWidth ?? 1;

    // If the table width is within one thousandth of 1 then set the table width to 1.
    if (tableWidth < 1.001) tableWidth = 1;

    const tableMap = new ContentTableMap(
        table,
        width,
        height,
        map,
        problems,
        tableWidth,
        columnWidths,
        totalColumnWidth,
    );

    return tableMap;
}
