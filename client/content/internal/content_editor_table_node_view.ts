import {Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {tableClassName} from "~/shared/content/content_styles.js";
import {type ContentEditorCellAttrs} from "~/shared/content/table/content_table_utils.js";

export class ContentEditorTableNodeView implements NodeView {
    public dom: HTMLDivElement;
    public table: HTMLTableElement;
    public colgroup: HTMLTableColElement;
    public contentDOM: HTMLTableSectionElement;

    constructor(public node: Node, public defaultCellMinWidth: number, public view: EditorView) {
        this.dom = document.createElement("div");
        this.dom.className = tableClassName;
        this.dom.setAttribute("data-scrollbar", "false");
        this.table = this.dom.appendChild(document.createElement("table"));
        this.colgroup = this.table.appendChild(document.createElement("colgroup"));
        contentEditorUpdateTableColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            defaultCellMinWidth,
            view,
            undefined,
            undefined,
        );
        this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    }

    update(node: Node): boolean {
        if (node.type != this.node.type) return false;
        this.node = node;
        contentEditorUpdateTableColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            this.defaultCellMinWidth,
            this.view,
            undefined,
            undefined,
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

export function contentEditorUpdateTableColumnsOnResize(
    node: Node,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    defaultCellMinWidth: number,
    view: EditorView,
    overrideCol?: number,
    overrideValue?: number,
): void {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild as HTMLElement;
    const row = node.firstChild;
    if (!row) return;

    for (let i = 0, col = 0; i < row.childCount; i++) {
        const {colspan, colwidth} = row.child(i).attrs as ContentEditorCellAttrs;
        for (let j = 0; j < colspan; j++, col++) {
            const hasWidth = overrideCol == col ? overrideValue : colwidth && colwidth[j];
            const cssWidth = hasWidth ? hasWidth + "px" : "";
            totalWidth += hasWidth || defaultCellMinWidth;
            if (!hasWidth) fixedWidth = false;
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
