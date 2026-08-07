import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    ContentReferencesSchema,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

const simpleContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
    },
    marks: {
        ...contentBaseProsemirrorSchemaSpec.marks,
    },
});

/**
 * Simple content is the most basic content schema available. It doesn't support
 * any references (no mentions, no files) only basic rich text content.
 *
 * Useful when we want to provide a rich text editor but don't want the rich text
 * to be tied to a specific space.
 */
export type SimpleContent = Node & {_SimpleContent: never};

export function isSimpleContent(node: Node): node is SimpleContent {
    return node.type.schema === SimpleContentProsemirrorSchema && node.type.name === "doc";
}

export function assertSimpleContent(node: Node): SimpleContent {
    assert(isSimpleContent(node));
    return node;
}

export function createSimpleContent(text?: string): SimpleContent {
    return assertSimpleContent(
        SimpleContentProsemirrorSchema.node("doc", {}, [
            SimpleContentProsemirrorSchema.node(
                "paragraph",
                {},
                text ? [SimpleContentProsemirrorSchema.text(text)] : [],
            ),
        ]),
    );
}

export const SimpleContentProsemirrorSchema = new ProsemirrorSchema(
    simpleContentProsemirrorSchemaSpec,
);

// Property `isSimpleContentSchema()` looks for to tell if a ProseMirror schema is
// the `SimpleContent` schema.
(SimpleContentProsemirrorSchema as any)._isSimpleContent = true;

const simpleContentSchemas = createSchemaForProsemirrorSchema(SimpleContentProsemirrorSchema);

export const SimpleContentSchema =
    simpleContentSchemas.TopNodeType as Schema<any> as Schema<SimpleContent>;

export const SimpleContentStepSchema = simpleContentSchemas.createStepSchema();

export const emptySimpleContent = SimpleContentProsemirrorSchema.node("doc", {}, [
    SimpleContentProsemirrorSchema.node("paragraph"),
]) as SimpleContent;

export const SimpleContentWithReferencesSchema = Schema.object({
    doc: SimpleContentSchema,
    references: ContentReferencesSchema,
});

export type SimpleContentWithReferences = SchemaType<typeof SimpleContentWithReferencesSchema>;

export const emptySimpleContentWithReferences: SimpleContentWithReferences = {
    doc: emptySimpleContent,
    references: emptyContentReferences,
};
