import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Schema for the document creator's "from" field, indicating what created
 * the document on behalf of the creator.
 *
 * - `Bot`: The document was created by a bot on behalf of the creator.
 * - `Importer`: The document was imported from an external source.
 *
 * Note: This schema is not nullable by default. Apply `.nullable()` and any
 * migration helpers (like `.wrapOriginalPropertyInUnionVariant()`) as needed.
 */

export const DocumentCreatorFromImporter = Schema.object({
    type: Schema.value("Importer"),
    source: Schema.union({
        Notion: Schema.object({
            type: Schema.value("Notion"),
        }),
    }),
});

export type DocumentCreatorFromImporterType = SchemaType<typeof DocumentCreatorFromImporter>;

export const DocumentCreatorFromSchema = Schema.union({
    Bot: Schema.object({
        type: Schema.value("Bot"),
        accountId: Schema.id<AccountId>(),
    }),
    Importer: DocumentCreatorFromImporter,
});

export type DocumentCreatorFrom = SchemaType<typeof DocumentCreatorFromSchema>;
