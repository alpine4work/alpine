import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_type_names.js";
import {PostContentProsemirrorSchema} from "~/shared/forum/post_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(PostContentProsemirrorSchema);
});
