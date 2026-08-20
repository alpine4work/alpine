import {DocumentContentReferencesSchema} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document_content_schema.js";
import {DocumentCreatorFromSchema} from "~/shared/documents/document_creator_from.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/** The most ProseMirror steps a single history comparison may return. */
export const documentHistoryDiffMaxStepCount = 1000;

export const DocumentHistoryAuthorSchema = Schema.object({
    id: Schema.id<AccountId>().nullable(),
    from: DocumentCreatorFromSchema.nullable(),
});

export type DocumentHistoryAuthor = SchemaType<typeof DocumentHistoryAuthorSchema>;

export const DocumentHistoryTransactionMetadataSchema = Schema.object({
    startVersion: Schema.integer,
    endVersion: Schema.integer,
    createdTime: Schema.date,
    author: DocumentHistoryAuthorSchema,
    clientId: Schema.id<ContentEditorClientId>(),
});

export type DocumentHistoryTransactionMetadata = SchemaType<
    typeof DocumentHistoryTransactionMetadataSchema
>;

export const DocumentHistoryVersionRangeSchema = Schema.object({
    startVersion: Schema.integer,
    endVersion: Schema.integer,
});

export type DocumentHistoryVersionRange = SchemaType<typeof DocumentHistoryVersionRangeSchema>;

export const DocumentHistorySubEntrySchema = Schema.object({
    startVersion: Schema.integer,
    endVersion: Schema.integer,
    startTime: Schema.date,
    endTime: Schema.date,
    contributors: Schema.array(DocumentHistoryAuthorSchema),
});

export type DocumentHistorySubEntry = SchemaType<typeof DocumentHistorySubEntrySchema>;

export const DocumentHistoryGroupSchema = Schema.object({
    startVersion: Schema.integer,
    endVersion: Schema.integer,
    startTime: Schema.date,
    endTime: Schema.date,
    contributors: Schema.array(DocumentHistoryAuthorSchema),
    entries: Schema.array(DocumentHistorySubEntrySchema),
});

export type DocumentHistoryGroup = SchemaType<typeof DocumentHistoryGroupSchema>;

export const DocumentHistoryDiffSchema = Schema.object({
    startContent: DocumentContentSchema,
    steps: Schema.array(DocumentContentStepSchema),
    contentReferences: DocumentContentReferencesSchema,
});

export type DocumentHistoryDiff = SchemaType<typeof DocumentHistoryDiffSchema>;

/** A reconstructed historical diff and the version range it represents. */
export const DocumentHistoryDiffForRangeSchema = Schema.object({
    range: DocumentHistoryVersionRangeSchema,
    showInitialContentAsAdditions: Schema.boolean,
    diff: DocumentHistoryDiffSchema,
});

export type DocumentHistoryDiffForRange = SchemaType<typeof DocumentHistoryDiffForRangeSchema>;
