import {MessageContentWithReferencesSchema} from "~/shared/content/message_content_schema.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {maxChannelTopContributorCount} from "~/shared/forum/channel_model.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type FileChannelEntityModel = SchemaType<typeof FileChannelEntityModelSchema>;

export const FileChannelEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Channel"),
    id: Schema.id<ChannelId>(),
    createdTime: Schema.date,
    name: LabelStringSchema,
    isPrivate: Schema.boolean,
    description: MessageContentWithReferencesSchema,
    isSubscribed: Schema.boolean,
    contributorCount: Schema.integer,
    topContributors: Schema.array(AccountModel.schema)
        .minLength(1)
        .maxLength(maxChannelTopContributorCount),
    /**
     * The site this channel belongs to, if any. Populated when the channel's access
     * policy resolves to a `Site` policy. Used by the file entity preview to render a
     * breadcrumb pointing at the parent site.
     */
    site: SitePreviewModel.schema.nullable().default(null),
});
