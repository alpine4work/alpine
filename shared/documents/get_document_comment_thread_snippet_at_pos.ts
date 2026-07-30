import {cutContent} from "~/shared/content/cut_content.js";
import {getContentSnippetPos} from "~/shared/content/get_content_snippet.js";
import {
    DocumentContent,
    DocumentWithOptionalTitleContent,
    DocumentWithOptionalTitleContentProsemirrorSchema,
    assertDocumentWithOptionalTitleContent,
} from "~/shared/documents/document_content_schema.js";

export type DocumentCommentThreadSnippet = {
    /**
     * The snippet content cut from the document.
     */
    node: DocumentWithOptionalTitleContent;

    /**
     * Add this to a position inside `node` to get the corresponding position in the
     * source document. Positions only map exactly for content in whole text blocks, so
     * use the `wholeTextBlocks` collector option when you need this mapping.
     */
    posOffset: number;
};

/**
 * Gets a document comment thread snippet around a known document position without
 * searching the document for a comment mark.
 */
export function getDocumentCommentThreadSnippetAtPos(
    doc: DocumentContent,
    pos: number,
): DocumentCommentThreadSnippet {
    // Enough lines to fill a document comment thread preview component.
    const snippetPos = getContentSnippetPos(doc.resolve(pos), {
        linesAbove: 2,
        linesBelow: 8,
    });

    const node = cutContent(doc, snippetPos.from, snippetPos.to);

    return {
        // `cutContent` preserves the source document's node type even when the cut
        // excludes its required title. Reparse with the optional-title schema so the
        // snippet is valid whether or not the selected window contains the title.
        node: assertDocumentWithOptionalTitleContent(
            DocumentWithOptionalTitleContentProsemirrorSchema.nodeFromJSON(node.toJSON()),
        ),
        posOffset: snippetPos.from - doc.resolve(snippetPos.from).depth,
    };
}
