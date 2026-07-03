import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Metadata about what created a task entity on behalf of its creator.
 *
 * For now only bot-created task entities are represented here.
 */
export const TaskCreatorFromSchema = Schema.union({
    Bot: Schema.object({
        type: Schema.value("Bot"),
        accountId: Schema.id<AccountId>(),
    }),
});

export type TaskCreatorFrom = SchemaType<typeof TaskCreatorFromSchema>;

/**
 * A non-null task creator account plus optional metadata about what created it.
 */
export const TaskCreatorSchema = Schema.object({
    accountId: Schema.id<AccountId>(),
    from: TaskCreatorFromSchema.nullable().default(null),
});

export type TaskCreator = SchemaType<typeof TaskCreatorSchema>;

export const TaskActorSchema = TaskCreatorSchema;

export type TaskActor = TaskCreator;
