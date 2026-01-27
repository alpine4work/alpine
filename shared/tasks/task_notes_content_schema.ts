import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    ContentReferencesSchema,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema.js";
import {
    contentMentionProsemirrorNodeSpecs,
    createContentFileProsemirrorNodeSpecs,
} from "~/shared/content/content_schema_extra.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const taskNotesContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
        ...contentMentionProsemirrorNodeSpecs,
        // Currently we only allow `fileFloat`s in documents. They're mostly useful for
        // narrative storytelling and can create odd layouts if not carefully designed.
        // So in posts and task notes where file attachments mostly serve as a utility
        // (vs as a narrative device) we don't currently allow `fileFloat`s.
        ...createContentFileProsemirrorNodeSpecs({withTable: true}),
    },
    marks: {
        ...contentBaseProsemirrorSchemaSpec.marks,
    },
});

export type TaskNotesContent = Node & {readonly _TaskNotesContent: never};

export function isTaskNotesContent(node: Node): node is TaskNotesContent {
    return node.type.schema === TaskNotesContentProsemirrorSchema && node.type.name === "doc";
}

export function assertTaskNotesContent(node: Node): TaskNotesContent {
    assert(isTaskNotesContent(node));
    return node;
}

export function createSimpleTaskNotesContent(text: string): TaskNotesContent {
    return assertTaskNotesContent(
        TaskNotesContentProsemirrorSchema.node("doc", {}, [
            TaskNotesContentProsemirrorSchema.node("paragraph", {}, [
                TaskNotesContentProsemirrorSchema.text(text),
            ]),
        ]),
    );
}

export const TaskNotesContentProsemirrorSchema = new ProsemirrorSchema(
    taskNotesContentProsemirrorSchemaSpec,
);

const taskNotesContentSchemas = createSchemaForProsemirrorSchema(TaskNotesContentProsemirrorSchema);

export const TaskNotesContentSchema =
    taskNotesContentSchemas.TopNodeType as Schema<any> as Schema<TaskNotesContent>;

export const TaskNotesContentStepSchema = taskNotesContentSchemas.createStepSchema();

export const emptyTaskNotesContent = TaskNotesContentProsemirrorSchema.node("doc", {}, [
    TaskNotesContentProsemirrorSchema.node("paragraph"),
]) as TaskNotesContent;

export type TaskNotesContentWithReferences = SchemaType<
    typeof TaskNotesContentWithReferencesSchema
>;

export const TaskNotesContentWithReferencesSchema = Schema.object({
    doc: TaskNotesContentSchema,
    references: ContentReferencesSchema,
});

export const emptyTaskNotesContentWithReferences: TaskNotesContentWithReferences = {
    doc: emptyTaskNotesContent,
    references: emptyContentReferences,
};
