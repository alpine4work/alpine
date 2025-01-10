import {useEffect} from "react";

export function useTrailingNewlineSelectionTrimmer() {
    useEffect(() => {
        const handleSelectionChange = () => {
            const selection = document.getSelection();
            console.log(selection);
            if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;

            const position = selection.anchorNode.compareDocumentPosition(selection.focusNode);
            const isAnchorNodeEnd = position & Node.DOCUMENT_POSITION_PRECEDING;

            const startNode = isAnchorNodeEnd ? selection.focusNode : selection.anchorNode;
            const startOffset = isAnchorNodeEnd ? selection.focusOffset : selection.anchorOffset;
            const endNode = isAnchorNodeEnd ? selection.anchorNode : selection.focusNode;
            const endOffset = isAnchorNodeEnd ? selection.anchorOffset : selection.focusOffset;

            if (!(endNode instanceof Text) && endOffset === 0) {
                const previousText = findPreviousText(endNode);

                console.log("CHANGE!", previousText);

                if (previousText !== null) {
                    // There's a convenient method for modifying the focus node `extend()` but to
                    // modify the anchor node we need to use `setBaseAndExtent()`.
                    if (isAnchorNodeEnd) {
                        selection.setBaseAndExtent(
                            previousText,
                            previousText.data.length,
                            startNode,
                            startOffset,
                        );
                    } else {
                        selection.extend(previousText, previousText.data.length);
                    }
                }
            }
        };

        document.addEventListener("selectionchange", handleSelectionChange, true);
        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange, true);
        };
    }, []);
}

function findPreviousText(startNode: Node): Text | null {
    let node: Node | null = startNode;

    while (node !== null && node.previousSibling === null) {
        node = node.parentNode;
    }
    if (node !== null) {
        node = node.previousSibling;
    }

    while (node !== null) {
        if (node instanceof Text) return node;

        if (node.lastChild !== null) {
            node = node.lastChild;
        } else {
            while (node !== null && node.previousSibling === null) {
                node = node.parentNode;
            }
            if (node !== null) {
                node = node.previousSibling;
            }
        }
    }

    return null;
}
