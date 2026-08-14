import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Metadata about what created a channel on behalf of its creator.
 *
 * For now only bot-created channels are represented here.
 */
export const ChannelCreatorFromSchema = Schema.union({
    Bot: Schema.object({
        type: Schema.value("Bot"),
        accountId: Schema.id<AccountId>(),
    }),
});

export type ChannelCreatorFrom = SchemaType<typeof ChannelCreatorFromSchema>;

/**
 * A possibly historical-null channel creator account plus optional metadata about
 * what created it.
 */
export const ChannelCreatorSchema = Schema.object({
    accountId: Schema.id<AccountId>().nullable().default(null),
    from: ChannelCreatorFromSchema.nullable().default(null),
});

export type ChannelCreator = SchemaType<typeof ChannelCreatorSchema>;
