import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_type_names.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(TaskNotesContentProsemirrorSchema);
});
