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

const postContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
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

export type PostContent = Node & {_PostContent: never};

export function isPostContent(node: Node): node is PostContent {
    return node.type.schema === PostContentProsemirrorSchema && node.type.name === "doc";
}

export function assertPostContent(node: Node): PostContent {
    assert(isPostContent(node));
    return node;
}

export function createSimplePostContent(text: string): PostContent {
    return assertPostContent(
        PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text(text),
            ]),
        ]),
    );
}

export const PostContentProsemirrorSchema = new ProsemirrorSchema(postContentProsemirrorSchemaSpec);

const postContentSchemas = createSchemaForProsemirrorSchema(PostContentProsemirrorSchema);

export const PostContentSchema =
    postContentSchemas.TopNodeType as Schema<any> as Schema<PostContent>;

export const PostContentStepSchema = postContentSchemas.createStepSchema();

export const emptyPostContent = PostContentProsemirrorSchema.node("doc", {}, [
    PostContentProsemirrorSchema.node("paragraph"),
]) as PostContent;

export type PostContentWithReferences = SchemaType<typeof PostContentWithReferencesSchema>;

export const PostContentWithReferencesSchema = Schema.object({
    doc: PostContentSchema,
    references: ContentReferencesSchema,
});

export const emptyPostContentWithReferences: PostContentWithReferences = {
    doc: emptyPostContent,
    references: emptyContentReferences,
};
