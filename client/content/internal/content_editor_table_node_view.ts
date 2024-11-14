/* eslint-disable @typescript-eslint/unbound-method */
import {Node} from "prosemirror-model";
import {addColumnAfter} from "prosemirror-tables";
import {EditorView, NodeView} from "prosemirror-view";
import {tableClassName} from "~/shared/content/content_styles.js";

export interface CellAttrs {
    colspan: number;
    rowspan: number;
    colwidth: Array<number> | null;
}

/**
 * @public
 */
export class TableView implements NodeView {
    public dom: HTMLDivElement;
    public table: HTMLTableElement;
    public colgroup: HTMLTableColElement;
    public contentDOM: HTMLTableSectionElement;
    private columnButtons: HTMLDivElement;

    constructor(public node: Node, public defaultCellMinWidth: number, public view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = tableClassName;
        this.dom.style.position = "relative";
        this.dom.style.overflow = "visible";

        // Create column buttons container
        this.columnButtons = document.createElement("div");
        this.dom.appendChild(this.columnButtons);

        this.table = this.dom.appendChild(document.createElement("table"));
        this.table.style.setProperty("--default-cell-min-width", `${defaultCellMinWidth}px`);
        this.colgroup = this.table.appendChild(document.createElement("colgroup"));

        updateColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            defaultCellMinWidth,
            view,
            undefined,
            undefined,
            this.columnButtons,
        );
        this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    }

    update(node: Node): boolean {
        if (node.type != this.node.type) return false;
        this.node = node;
        updateColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            this.defaultCellMinWidth,
            this.view,
            undefined,
            undefined,
            this.columnButtons,
        );
        return true;
    }

    ignoreMutation(record: MutationRecord): boolean {
        return (
            record.type == "attributes" &&
            (record.target == this.table || this.colgroup.contains(record.target))
        );
    }
}

/**
 * @public
 */
export function updateColumnsOnResize(
    node: Node,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    defaultCellMinWidth: number,
    view: EditorView,
    overrideCol?: number,
    overrideValue?: number,
    columnButtons?: HTMLDivElement,
): void {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild as HTMLElement;
    const row = node.firstChild;
    if (!row) return;

    for (let i = 0, col = 0; i < row.childCount; i++) {
        const {colspan, colwidth} = row.child(i).attrs as CellAttrs;
        for (let j = 0; j < colspan; j++, col++) {
            const hasWidth = overrideCol == col ? overrideValue : colwidth && colwidth[j];
            const cssWidth = hasWidth ? hasWidth + "px" : "";
            totalWidth += hasWidth || defaultCellMinWidth;
            if (!hasWidth) fixedWidth = false;

            // Create column button
            if (columnButtons) {
                columnButtons.className = "column-buttons-container";

                const button = document.createElement("button");
                button.className = "column-button";
                button.setAttribute("aria-label", `Column ${col + 1} options`);

                // Position the button relative to column width
                button.style.left = `${totalWidth - (hasWidth || defaultCellMinWidth) / 2}px`;

                button.addEventListener("click", event => {
                    event.stopPropagation();
                    const columnIndex = col;
                    console.log(`Column ${columnIndex + 1} clicked`);
                    addColumnAfter(view.state, view.dispatch);
                });

                columnButtons.appendChild(button);
            }

            if (!nextDOM) {
                const col = document.createElement("col");
                col.style.width = cssWidth;
                colgroup.appendChild(col);
            } else {
                if (nextDOM.style.width != cssWidth) {
                    nextDOM.style.width = cssWidth;
                }
                nextDOM = nextDOM.nextSibling as HTMLElement;
            }
        }
    }

    while (nextDOM) {
        const after = nextDOM.nextSibling;
        nextDOM.parentNode?.removeChild(nextDOM);
        nextDOM = after as HTMLElement;
    }

    if (fixedWidth) {
        table.style.width = totalWidth + "px";
        table.style.minWidth = "";
    } else {
        table.style.width = "";
        table.style.minWidth = totalWidth + "px";
    }
}
