import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type FileChatEntityModel = SchemaType<typeof FileChatEntityModelSchema>;

export const FileChatEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Chat"),
    id: Schema.id<ChatId>(),
    definition: Schema.union({
        Direct: Schema.object({
            type: Schema.value("Direct"),
            accounts: Schema.array(AccountModel.schema),
        }),
        Room: Schema.object({
            type: Schema.value("Room"),
            name: LabelStringSchema,
            isPrivate: Schema.boolean,
        }),
    }),
    isSubscribed: Schema.boolean,
    messages: Schema.array(ChatMessageModel.schema()),
    otherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    /**
     * The site this chat belongs to, if any. Populated when the chat's access policy
     * resolves to a `Site` policy. Used by the file entity preview to render a
     * breadcrumb pointing at the parent site.
     */
    site: SitePreviewModel.schema.nullable().default(null),
});
