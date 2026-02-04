import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_node_type_name.js";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(MessageContentProsemirrorSchema);
});
