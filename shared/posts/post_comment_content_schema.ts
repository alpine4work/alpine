import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

const postCommentContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
    },
    marks: {
        ...contentBaseProsemirrorSchemaSpec.marks,
    },
});

export type PostCommentContent = Node & {_PostCommentContent: never};

export function isPostCommentContent(node: Node): node is PostCommentContent {
    return node.type.schema === PostCommentContentProsemirrorSchema && node.type.name === "doc";
}

export function assertPostCommentContent(node: Node): PostCommentContent {
    assert(isPostCommentContent(node));
    return node;
}

export const PostCommentContentProsemirrorSchema = new ProsemirrorSchema(
    postCommentContentProsemirrorSchemaSpec,
);

export const PostCommentContentSchema = Schema.unknown.transform<PostCommentContent>({
    serialize: content => content.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = PostCommentContentProsemirrorSchema.nodeFromJSON(unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid post content");
        }

        if (!isPostCommentContent(content))
            throw new SchemaDeserializationError('Invalid post content"');

        return content;
    },
});

export const emptyPostCommentContent = PostCommentContentProsemirrorSchema.node("doc", {}, [
    PostCommentContentProsemirrorSchema.node("paragraph"),
]) as PostCommentContent;
