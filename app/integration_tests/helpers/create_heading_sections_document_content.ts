import {AccessPolicy} from "~/shared/access/access_policy.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Document content for heading section tests: an "Introduction" heading followed
 * by enough filler paragraphs to push the "Roadmap" section (with its "Q3 Goals"
 * subsection) and the "Appendix" section below the fold.
 */
export function createHeadingSectionsDocumentContent(creatorId: AccountId): DocumentContent {
    const node = DocumentContentProsemirrorSchema.node.bind(DocumentContentProsemirrorSchema);
    const text = DocumentContentProsemirrorSchema.text.bind(DocumentContentProsemirrorSchema);

    const accessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    return assertDocumentContent(
        node("doc", {accessPolicy}, [
            node("title", {}, [text("Heading sections")]),
            node("heading", {level: 1}, [text("Introduction")]),
            ...Array.from({length: 20}, (_, index) =>
                node("paragraph", {}, [text(`Filler paragraph ${index + 1}.`)]),
            ),
            node("heading", {level: 1}, [text("Roadmap")]),
            node("paragraph", {}, [text("Roadmap body text.")]),
            node("heading", {level: 2}, [text("Q3 Goals")]),
            node("paragraph", {}, [text("Q3 goals body text.")]),
            node("heading", {level: 1}, [text("Appendix")]),
            node("paragraph", {}, [text("Appendix body text.")]),
        ]),
    );
}
