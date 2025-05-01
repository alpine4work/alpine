import {ResolvedPos} from "prosemirror-model";

export function getContentCodeBlockLineAdjacentIndentationSpaceCount($pos: ResolvedPos): number {
    const parentNode = $pos.node($pos.depth - 1);
    const nodeIndex = $pos.index($pos.depth - 1);

    let previousNodeIndentationSpaceCount = 0;
    let nextNodeIndentationSpaceCount = 0;

    for (let previousNodeIndex = nodeIndex - 1; previousNodeIndex >= 0; previousNodeIndex--) {
        previousNodeIndentationSpaceCount = 0;

        const previousNode = parentNode.child(previousNodeIndex);

        for (let childNodeIndex = 0; childNodeIndex < previousNode.childCount; childNodeIndex++) {
            const childNode = previousNode.child(childNodeIndex);
            if (!childNode.isText) break;

            const match = childNode.text!.match(/^ +/);
            if (!match) break;

            previousNodeIndentationSpaceCount += match[0].length;
            if (match[0].length < childNode.text!.length) break;
        }

        // If the entire line was white space, try another node.
        if (previousNodeIndentationSpaceCount === previousNode.content.size) continue;

        break;
    }

    for (
        let nextNodeIndex = nodeIndex + 1;
        nextNodeIndex < parentNode.childCount;
        nextNodeIndex++
    ) {
        nextNodeIndentationSpaceCount = 0;

        const nextNode = parentNode.child(nextNodeIndex);

        for (let childNodeIndex = 0; childNodeIndex < nextNode.childCount; childNodeIndex++) {
            const childNode = nextNode.child(childNodeIndex);
            if (!childNode.isText) break;

            const match = childNode.text!.match(/^ +/);
            if (!match) break;

            nextNodeIndentationSpaceCount += match[0].length;
            if (match[0].length < childNode.text!.length) break;
        }

        // If the entire line was white space, try another node.
        if (nextNodeIndentationSpaceCount === nextNode.content.size) continue;

        break;
    }

    return Math.max(previousNodeIndentationSpaceCount, nextNodeIndentationSpaceCount);
}
