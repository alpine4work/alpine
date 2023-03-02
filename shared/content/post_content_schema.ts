import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema";
import {contentStructuralProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra";
import {assert} from "~/shared/helpers/control/assert";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema";
import {Schema} from "~/shared/schema/schema";

const postContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
        ...contentStructuralProsemirrorNodeSpecs,
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

export const emptyPostContent = PostContentProsemirrorSchema.node("doc", {}, [
    PostContentProsemirrorSchema.node("paragraph"),
]) as PostContent;
