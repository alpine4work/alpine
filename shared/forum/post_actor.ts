import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Metadata about what authored a post on behalf of its author.
 *
 * For now only bot-authored posts are represented here.
 */
export const PostActorFromSchema = Schema.union({
    Bot: Schema.object({
        type: Schema.value("Bot"),
        accountId: Schema.id<AccountId>(),
    }),
});

export type PostActorFrom = SchemaType<typeof PostActorFromSchema>;

/**
 * A non-null post author account plus optional metadata about what authored it.
 */
export const PostActorSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    from: PostActorFromSchema.nullable().default(null),
});

export type PostActor = SchemaType<typeof PostActorSchema>;
