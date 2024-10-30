import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_node_type_name.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(TaskNotesContentProsemirrorSchema);
});
