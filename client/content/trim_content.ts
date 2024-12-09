import {Fragment, Node} from "prosemirror-model";
import {ContentWithReferences} from "~/shared/content/content_references.js";

/**
 * Trim spaces from the end of a ProseMirror node. We call this before sending
 * a chat message or creating a post. Trailing white space is usually an
 * accident and looks weird in the message.
 */
export function trimContentEnd<Content extends Node>(node: Content): Content {
    return actuallyTrimContentEnd(node) as Content;
}

/**
 * Trim spaces from the start of a ProseMirror node.
 */
export function trimContentStart<Content extends Node>(node: Content): Content {
    return actuallyTrimContentStart(node) as Content;
}

export function trimContent<Content extends Node>(node: Content): Content {
    return actuallyTrimContentStart(actuallyTrimContentEnd(node)) as Content;
}

export function trimContentWithReferencesEnd<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = actuallyTrimContentEnd(content.doc);
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

export function trimContentWithReferencesStart<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = actuallyTrimContentStart(content.doc);
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

export function trimContentWithReferences<Content extends ContentWithReferences>(
    content: Content,
): Content {
    const newDoc = actuallyTrimContentStart(actuallyTrimContentEnd(content.doc));
    if (newDoc === content.doc) return content;
    return {...content, doc: newDoc};
}

function actuallyTrimContentEnd(node: Node): Node {
    const fragment = trimContentFragmentEnd(node.content);
    if (node.content === fragment) return node;
    return node.type.create(node.attrs, fragment);
}

export function trimContentFragmentEnd(fragment: Fragment): Fragment {
    if (fragment.content.length === 0) return fragment;

    const oldLastChildNode = fragment.content[fragment.content.length - 1]!;

    if (!oldLastChildNode.isText) {
        const newLastChildNode = actuallyTrimContentEnd(oldLastChildNode);

        // If the last node is an empty paragraph, then remove it and then try trimming
        // the new last node.
        if (
            fragment.content.length > 1 &&
            newLastChildNode.type.name === "paragraph" &&
            newLastChildNode.content.size === 0
        ) {
            return trimContentFragmentEnd(Fragment.from(fragment.content.slice(0, -1)));
        }

        if (oldLastChildNode === newLastChildNode) return fragment;

        return Fragment.from([...fragment.content.slice(0, -1), newLastChildNode]);
    }

    const trimmedText = oldLastChildNode.text!.trimEnd();
    if (trimmedText.length === oldLastChildNode.text!.length) return fragment;

    return Fragment.from([
        ...fragment.content.slice(0, -1),
        oldLastChildNode.type.schema.text(trimmedText),
    ]);
}

function actuallyTrimContentStart(node: Node): Node {
    const fragment = trimContentFragmentStart(node.content);
    if (node.content === fragment) return node;
    return node.type.create(node.attrs, fragment);
}

export function trimContentFragmentStart(fragment: Fragment): Fragment {
    if (fragment.content.length === 0) return fragment;

    const oldFirstChildNode = fragment.content[0]!;

    if (!oldFirstChildNode.isText) {
        const newFirstChildNode = actuallyTrimContentStart(oldFirstChildNode);

        // If the first node is an empty paragraph, then remove it and then try
        // trimming the new first node.
        if (
            fragment.content.length > 1 &&
            newFirstChildNode.type.name === "paragraph" &&
            newFirstChildNode.content.size === 0
        ) {
            return trimContentFragmentStart(Fragment.fromArray(fragment.content.slice(1)));
        }

        if (oldFirstChildNode === newFirstChildNode) return fragment;

        return Fragment.from([newFirstChildNode, ...fragment.content.slice(1)]);
    }

    const trimmedText = oldFirstChildNode.text!.trimStart();
    if (trimmedText.length === oldFirstChildNode.text!.length) return fragment;

    return Fragment.from([
        oldFirstChildNode.type.schema.text(trimmedText),
        ...fragment.content.slice(1),
    ]);
}

export function trimContentFragment(fragment: Fragment): Fragment {
    return trimContentFragmentStart(trimContentFragmentEnd(fragment));
}
