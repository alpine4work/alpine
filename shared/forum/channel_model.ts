import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {FileModel} from "~/shared/files/file_model.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentWithReferencesSchema} from "~/shared/messaging/message_content_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export class ChannelModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        version: Schema.integer,
        createdTime: Schema.date,
        name: LabelStringSchema,
        description: MessageContentWithReferencesSchema,
        accessPolicy: AccessPolicySchema,
    }),
) {
    public asPreview() {
        return new ChannelPreviewModel({
            id: this.id,
            spaceId: this.spaceId,
            version: this.version,
            createdTime: this.createdTime,
            name: this.name,
            accessPolicy: this.accessPolicy,
        });
    }
}

export class ChannelPreviewModel extends Model(
    Schema.object({
        id: Schema.id<ChannelId>(),
        spaceId: Schema.id<SpaceId>(),
        version: Schema.integer,
        createdTime: Schema.date,
        name: LabelStringSchema,
        accessPolicy: AccessPolicySchema,
    }),
) {}

export const renderedMaxChannelTopContributorCount = 10;

// We load more contributors than we render so that if we load some
// contributors that have been removed from the space we can take them out of
// our top contributor list and have another account to render in their place.
export const maxChannelTopContributorCount = Math.round(
    renderedMaxChannelTopContributorCount * 1.5,
);

export class ChannelContributorsModel extends Model(
    Schema.object({
        contributorCount: Schema.integer,
        topContributors: Schema.array(AccountModel.schema)
            .minLength(1)
            .maxLength(maxChannelTopContributorCount),
    }),
) {}

export class ChannelPostFilesModel extends Model(
    Schema.object({
        postId: Schema.id<PostId>(),
        files: Schema.array(
            Schema.object({
                signedUrlSearch: Schema.string,
                file: FileModel.schema,
            }),
        ).minLength(1),
    }),
) {}

export type ChannelOrMetadataModel = SchemaType<typeof ChannelOrMetadataModelSchema>;

export const ChannelOrMetadataModelSchema = createModelUnionSchema({
    Channel: ChannelModel,
    ChannelContributors: ChannelContributorsModel,
    ChannelPostFiles: ChannelPostFilesModel,
});
