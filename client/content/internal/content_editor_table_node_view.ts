/* eslint-disable @typescript-eslint/unbound-method */
import classNames from "classnames";
import {Node} from "prosemirror-model";
import {addColumnAfter} from "prosemirror-tables";
import {EditorView, NodeView} from "prosemirror-view";
import {
    columnContainerClassName,
    tableAlignClassName,
    tableClassName,
} from "~/shared/content/content_styles.js";

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
        this.dom.className = classNames(tableClassName, {
            [tableAlignClassName]: node.attrs.alignment !== "center",
        });
        this.dom.style.position = "relative";

        this.dom.setAttribute("data-scrollbar", "false");
        // Create column buttons container
        this.columnButtons = document.createElement("div");
        this.dom.appendChild(this.columnButtons);

        this.table = this.dom.appendChild(document.createElement("table"));

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

function addColumnAfterButton(
    columnButtons: HTMLDivElement,
    col: number,
    position: number,
    width: number,
    view: EditorView,
): void {
    // Create container for the column
    const columnContainer = document.createElement("div");
    columnContainer.className = columnContainerClassName;
    columnContainer.style.position = "absolute";
    columnContainer.style.left = `${position - width / 2}px`;
    columnContainer.style.width = `${width}px`;
    columnContainer.style.top = "0";
    columnContainer.style.bottom = "0";

    // Create hover area for the column
    const hoverArea = document.createElement("div");
    hoverArea.className = "column-hover-area";

    // Create button
    const button = document.createElement("button");
    button.className = "column-after-button";
    button.setAttribute("aria-label", "Add column after");
    button.style.left = "-4px";

    const tooltip = document.createElement("span");
    tooltip.className = "column-button-tooltip";
    tooltip.textContent = "Add column after";
    button.appendChild(tooltip);

    const icon = document.createElement("span");
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 256 256">
        <path fill="currentColor" d="M224.1 136.1l-72 72a8.1 8.1 0 0 1-11.3 0a8.2 8.2 0 0 1 0-11.4l58.4-58.4H40a8 8 0 0 1 0-16h159.2l-58.4-58.3a8.1 8.1 0 0 1 11.3-11.4l72 72a8.1 8.1 0 0 1 0 11.5Z"/>
    </svg>`;
    button.appendChild(icon);

    button.addEventListener("click", event => {
        event.stopPropagation();
        addColumnAfter(view.state, view.dispatch);
        // addRowAfter(view.state, view.dispatch);
    });

    columnContainer.appendChild(hoverArea);
    columnContainer.appendChild(button);
    columnButtons.appendChild(columnContainer);
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

    // Clear existing column buttons before adding new ones
    if (columnButtons) {
        columnButtons.innerHTML = "";
        columnButtons.className = "column-buttons-container";
    }

    for (let i = 0, col = 0; i < row.childCount; i++) {
        const {colspan, colwidth} = row.child(i).attrs as CellAttrs;
        for (let j = 0; j < colspan; j++, col++) {
            const hasWidth = overrideCol == col ? overrideValue : colwidth && colwidth[j];
            const cssWidth = hasWidth ? hasWidth + "px" : "";
            totalWidth += hasWidth || defaultCellMinWidth;
            if (!hasWidth) fixedWidth = false;

            if (columnButtons) {
                const buttonPosition = totalWidth - (hasWidth || defaultCellMinWidth) / 2;
                const columnWidth = hasWidth || defaultCellMinWidth;
                addColumnAfterButton(columnButtons, col, buttonPosition, columnWidth, view);
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
