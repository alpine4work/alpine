import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * We use ProseMirror for task titles. Task titles are short single line
 * strings with no formatting options. So why bother with the complexity of
 * ProseMirror?
 *
 * - Gives us the flexibility to one day add decorations, like mentions or
 *   tokenization
 * - Supports collaborative features like presence cursor and collaborative
 *   editing (collaborative editing within a task title will be rare, but nice
 *   to have everything support collaborative editing in theory)
 * - Better programmatic control of the text editor, for example translating
 *   cursor placement to pixel coords and back (for arrow up/down keyboard
 *   shortcuts)
 *
 * Overall, using a programmatic text editor allows us to super-power this
 * input for long into the future.
 */
const TaskTitleProsemirrorSchema = new ProsemirrorSchema({
    nodes: {
        doc: {content: "text*"},
        text: {inline: true},
    },
});

export type TaskTitle = Node & {readonly _TaskTitle: never};

export function isTaskTitle(node: Node): node is TaskTitle {
    return node.type.schema === TaskTitleProsemirrorSchema && node.type.name === "doc";
}

export function assertTaskTitle(node: Node): TaskTitle {
    assert(isTaskTitle(node));
    return node;
}

const taskTitleSchemas = createSchemaForProsemirrorSchema(TaskTitleProsemirrorSchema);

export const TaskTitleSchema = taskTitleSchemas.TopNodeType as Schema<any> as Schema<TaskTitle>;

export const emptyTaskTitle = TaskTitleProsemirrorSchema.node("doc", {}, []) as TaskTitle;

export function createSimpleTaskTitle(text: string): TaskTitle {
    return assertTaskTitle(
        TaskTitleProsemirrorSchema.node("doc", {}, [TaskTitleProsemirrorSchema.text(text)]),
    );
}
