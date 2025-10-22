import {Fragment, Node} from "prosemirror-model";
import {ContentWithReferences} from "~/shared/content/content_references.js";

export function trimContent<Content extends Node>(node: Content): Content {
    return trimContentStart(trimContentEnd(node));
}

export function trimContentFragment(fragment: Fragment): Fragment {
    return trimContentFragmentStart(trimContentFragmentEnd(fragment));
}

/**
 * Trim spaces from the end of a ProseMirror node. We call this before sending
 * a chat message or creating a post. Trailing white space is usually an
 * accident and looks weird in the message.
 */
export function trimContentEnd<Content extends Node>(node: Content): Content {
    const trimPos = trimContentFragmentEndPos(node.content);
    if (trimPos === null) return node;
    return node.cut(0, trimPos) as Content;
}

export function trimContentFragmentEnd(fragment: Fragment): Fragment {
    const trimPos = trimContentFragmentEndPos(fragment);
    if (trimPos === null) return fragment;
    return fragment.cut(0, trimPos);
}

/**
 * Trim spaces from the start of a ProseMirror node.
 */
export function trimContentStart<Content extends Node>(node: Content): Content {
    const trimPos = trimContentFragmentStartPos(node.content);
    if (trimPos === null) return node;
    return node.cut(trimPos) as Content;
}

export function trimContentFragmentStart(fragment: Fragment): Fragment {
    const trimPos = trimContentFragmentStartPos(fragment);
    if (trimPos === null) return fragment;
    return fragment.cut(trimPos);
}

export function trimContentWithReferences<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = trimContentStart(trimContentEnd(content.doc));
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

export function trimContentWithReferencesEnd<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = trimContentEnd(content.doc);
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

export function trimContentWithReferencesStart<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = trimContentStart(content.doc);
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

export function trimContentFragmentEndPos(fragment: Fragment): number | null {
    if (fragment.content.length === 0) return null;

    const lastChildNode = fragment.content[fragment.content.length - 1]!;

    if (!lastChildNode.isText) {
        const trimPos = trimContentFragmentEndPos(lastChildNode.content);

        // If the last node is an empty paragraph, then remove it and then try trimming
        // the new last node.
        if (
            fragment.content.length > 1 &&
            (lastChildNode.type.name === "paragraph" ||
                lastChildNode.type.name === "codeBlockLine") &&
            (trimPos === 0 || (trimPos === null && lastChildNode.content.size === 0))
        ) {
            return (
                trimContentFragmentEndPos(Fragment.from(fragment.content.slice(0, -1))) ??
                fragment.size - lastChildNode.nodeSize
            );
        }

        if (trimPos === null) return null;

        return fragment.size - lastChildNode.nodeSize + 1 + trimPos;
    }

    const trimmedText = lastChildNode.text!.trimEnd();
    if (trimmedText.length === lastChildNode.text!.length) return null;

    if (trimmedText.length === 0) {
        return (
            trimContentFragmentEndPos(Fragment.from(fragment.content.slice(0, -1))) ??
            fragment.size - lastChildNode.nodeSize
        );
    }

    return fragment.size - lastChildNode.nodeSize + trimmedText.length;
}

export function trimContentFragmentStartPos(fragment: Fragment): number | null {
    if (fragment.content.length === 0) return null;

    const firstChildNode = fragment.content[0]!;

    if (!firstChildNode.isText) {
        // Don't trim spaces at the start of a code block.
        if (firstChildNode.type.name === "codeBlockLine") return null;

        const trimPos = trimContentFragmentStartPos(firstChildNode.content);

        // If the first node is an empty paragraph, then remove it and then try
        // trimming the new first node.
        if (
            fragment.content.length > 1 &&
            firstChildNode.type.name === "paragraph" &&
            (trimPos === firstChildNode.content.size ||
                (trimPos === null && firstChildNode.content.size === 0))
        ) {
            return (
                firstChildNode.nodeSize +
                (trimContentFragmentStartPos(Fragment.fromArray(fragment.content.slice(1))) ?? 0)
            );
        }

        if (trimPos === null) return null;

        return 1 + trimPos;
    }

    const trimmedText = firstChildNode.text!.trimStart();
    if (trimmedText.length === firstChildNode.text!.length) return null;

    if (trimmedText.length === 0) {
        return (
            firstChildNode.nodeSize +
            (trimContentFragmentStartPos(Fragment.fromArray(fragment.content.slice(1))) ?? 0)
        );
    }

    return firstChildNode.nodeSize - trimmedText.length;
}
