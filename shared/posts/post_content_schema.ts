import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema";
import {contentStructuralProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra";
import {assert} from "~/shared/helpers/control/assert";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

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

export const PostContentProsemirrorSchema = new ProsemirrorSchema(postContentProsemirrorSchemaSpec);

export const PostContentSchema = Schema.unknown.transform<PostContent>({
    serialize: content => content.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = PostContentProsemirrorSchema.nodeFromJSON(unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid post content");
        }

        if (!isPostContent(content)) throw new SchemaDeserializationError('Invalid post content"');

        return content;
    },
});

export const emptyPostContent = PostContentProsemirrorSchema.node("doc", {}, [
    PostContentProsemirrorSchema.node("paragraph"),
]) as PostContent;
