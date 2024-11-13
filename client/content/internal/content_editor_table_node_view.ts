import {Node as ProseMirrorNode} from "prosemirror-model";
import {NodeView} from "prosemirror-view";
import {tableWrapperClassName} from "~/shared/content/content_styles.js";

// Handles two width modes:
// Fixed width mode (all columns have explicit widths):
// table.style.width = `${totalWidth}px`;

// Flexible width mode (some columns auto-sized):
// table.style.minWidth = `${totalWidth}px`;
/**
 * Updates the columns of a table node.
 * updateColumns function (the complex part):
 * Manages column widths and table layout
 * Takes a table node and updates the <colgroup> element with <col> elements
 *
 * - Processes each cell in the first row:
Handles colspan
 * Manages column widths (either explicit or minimum)
 * Creates/updates <col> elements with appropriate styles
 *
 * @param node - The ProseMirror node to update the columns for.
 * @param colgroup - The colgroup element to update the columns for.
 * @param table - The table element to update the columns for.
 * @param cellMinWidth - The minimum width of a cell in pixels.
 * @param overrideCol - The column to override the width for.
 * @param overrideValue - The value to override the width with.
 */
function updateColumns(
    node: ProseMirrorNode,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    cellMinWidth: number,
    overrideCol?: number,
    overrideValue?: number,
) {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild;
    const row = node.firstChild;

    if (row !== null) {
        for (let i = 0, col = 0; i < row.childCount; i += 1) {
            const {colspan, colwidth} = row.child(i).attrs;

            for (let j = 0; j < colspan; j += 1, col += 1) {
                const hasWidth = overrideCol === col ? overrideValue : colwidth && colwidth[j];
                const cssWidth = hasWidth ? `${hasWidth}px` : "";
                totalWidth += hasWidth || cellMinWidth;
                if (!hasWidth) fixedWidth = false;
                if (!nextDOM) {
                    const colElement = document.createElement("col");
                    const [propertyKey, propertyValue] = getColStyleDeclaration(
                        cellMinWidth,
                        hasWidth,
                    );
                    colElement.style.setProperty(propertyKey, propertyValue);
                    colgroup.appendChild(colElement);
                } else {
                    if ((nextDOM as HTMLTableColElement).style.width !== cssWidth) {
                        const [propertyKey, propertyValue] = getColStyleDeclaration(
                            cellMinWidth,
                            hasWidth,
                        );
                        (nextDOM as HTMLTableColElement).style.setProperty(
                            propertyKey,
                            propertyValue,
                        );
                    }
                    nextDOM = nextDOM.nextSibling;
                }
            }
        }
    }

    while (nextDOM) {
        const after = nextDOM.nextSibling;
        nextDOM.parentNode?.removeChild(nextDOM);
        nextDOM = after;
    }

    if (fixedWidth) {
        table.style.width = `${totalWidth}px`;
        table.style.minWidth = "";
    } else {
        table.style.width = "";
        table.style.minWidth = `${totalWidth}px`;
    }
}

/**
 * Creates a NodeView for a table node.
 * Creates and manages the HTML structure for tables in the editor
 * Structure: div.tableWrapper > table > (colgroup + tbody)
 * Handles updates when table content changes
 * Ignores certain DOM mutations to prevent infinite loops
 *
 * @param node - The ProseMirror node to create a view for.
 * @param cellMinWidth - The minimum width of a cell in pixels.
 * @returns A NodeView for the table node.
 */
export function createTableNodeView(node: ProseMirrorNode, cellMinWidth: number): NodeView {
    // Create DOM structure
    const dom = document.createElement("div");
    dom.className = tableWrapperClassName;
    dom.dataset.scrollbar = "false";

    const table = document.createElement("table");
    dom.appendChild(table);

    const colgroup = document.createElement("colgroup");
    table.appendChild(colgroup);

    const contentDOM = document.createElement("tbody");
    table.appendChild(contentDOM);

    // Initial column update
    updateColumns(node, colgroup, table, cellMinWidth);

    return {
        dom,
        contentDOM,
        update: (newNode: ProseMirrorNode) => {
            if (newNode.type !== node.type) return false;
            updateColumns(newNode, colgroup, table, cellMinWidth);
            return true;
        },
        ignoreMutation: (mutation: MutationRecord | {type: "selection"; target: Element}) => {
            return (
                mutation.type === "attributes" &&
                (mutation.target === table || colgroup.contains(mutation.target))
            );
        },
    };
}

export function getColStyleDeclaration(
    minWidth: number,
    width: number | undefined,
): [string, string] {
    if (width) {
        // apply the stored width unless it is below the configured minimum cell width
        return ["width", `${Math.max(width, minWidth)}px`];
    }

    // set the minimum with on the column if it has no stored width
    return ["min-width", `${minWidth}px`];
}
