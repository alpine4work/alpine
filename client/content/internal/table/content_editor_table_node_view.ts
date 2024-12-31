/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/tableview.ts
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

import {Node} from "prosemirror-model";
import {NodeViewConstructor} from "prosemirror-view";
import {getContentTableColumnWidths} from "~/client/content/internal/table/content_table_client_util.js";
import {subscribeToSpacingScaleChange} from "~/client/remix/spacing_scale_context.js";
import {tableWrapperClassName} from "~/shared/content/content_styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";

export function createContentEditorTableNodeView({
    subscribeToSelectionUpdate,
}: {
    subscribeToSelectionUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return node => {
        const tableWrapperElement = document.createElement("div");
        tableWrapperElement.className = tableWrapperClassName;
        tableWrapperElement.setAttribute("data-scrollbar", "false");

        const tableElement = tableWrapperElement.appendChild(document.createElement("table"));
        const colgroupElement = tableElement.appendChild(document.createElement("colgroup"));

        updateContentTableColumnsOnResize(node, colgroupElement);

        const tableBodyElement = tableElement.appendChild(document.createElement("tbody"));

        addActiveTableClass();

        // Subscribe to spacing scale changes. This also covers all platform changes so
        // we don't need to also subscribe to platform changes.
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(() => {
            updateContentTableColumnsOnResize(node, colgroupElement);
        });

        const unsubscribeFromSelectionUpdate = subscribeToSelectionUpdate(() => {
            // TODO(calebmer): Why do we need `requestAnimationFrame()` here?
            requestAnimationFrame(addActiveTableClass);
        });

        function addActiveTableClass() {
            console.log("addActiveTableClass");
        }

        return {
            dom: tableWrapperElement,
            contentDOM: tableBodyElement,

            update: newNode => {
                if (newNode.type != node.type) return false;
                node = newNode;
                updateContentTableColumnsOnResize(node, colgroupElement);
                return true;
            },
            ignoreMutation: record => {
                return (
                    record.type == "attributes" &&
                    (record.target == tableElement || colgroupElement.contains(record.target))
                );
            },
            destroy: () => {
                unsubscribeFromSpacingScaleChange();
                unsubscribeFromSelectionUpdate();
            },
        };
    };
}

export function updateContentTableColumnsOnResize(
    node: Node,
    colgroupElement: HTMLTableColElement,
    overrideColumnIndex?: number,
    overrideColumnWidthPx?: number,
): void {
    const tableMap = ContentTableMap.get(node);
    const columnWidths = getContentTableColumnWidths(node);

    const totalColumnWidth = columnWidths.reduce(
        (totalColumnWidth, columnWidth) => totalColumnWidth + columnWidth,
        0,
    );

    let nextColElement = colgroupElement.firstElementChild as HTMLTableColElement | null;

    for (let columnIndex = 0; columnIndex < tableMap.width; columnIndex++) {
        // NOCOMMIT: Add back override support
        // const width =
        //     overrideColumnIndex == columnIndex
        //         ? overrideColumnWidthPx
        //         : columnWidths?.[columnIndex];

        const columnWidth = columnWidths[columnIndex]!;
        const columnCssWidth = `${(columnWidth / totalColumnWidth) * 100}%`;

        // Create missing `<col>` elements
        if (!nextColElement) {
            const colElement = document.createElement("col");
            colElement.style.width = columnCssWidth;
            colgroupElement.appendChild(colElement);
        } else {
            if (nextColElement.style.width !== columnCssWidth) {
                nextColElement.style.width = columnCssWidth;
            }
            nextColElement = nextColElement.nextElementSibling as HTMLTableColElement | null;
        }
    }

    // Remove any extra `<col>` elements
    while (nextColElement) {
        const nextColElement2 = nextColElement.nextElementSibling as HTMLTableColElement | null;
        colgroupElement.removeChild(nextColElement);
        nextColElement = nextColElement2;
    }
}
