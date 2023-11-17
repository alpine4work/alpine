import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_type_names.js";
import {MessageContentProsemirrorSchema} from "~/shared/messaging/message_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(MessageContentProsemirrorSchema);
});
