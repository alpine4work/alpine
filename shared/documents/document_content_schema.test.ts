import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_node_type_name.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(DocumentContentProsemirrorSchema);
});
