import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {PostContentWithReferencesSchema} from "~/shared/forum/post_content_schema.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type FilePostEntityModel = SchemaType<typeof FilePostEntityModelSchema>;

export const FilePostEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Post"),
    id: Schema.id<PostId>(),
    author: AccountModel.schema,
    createdTime: Schema.date,
    channelName: Schema.string.nullable(),
    content: PostContentWithReferencesSchema,
});
