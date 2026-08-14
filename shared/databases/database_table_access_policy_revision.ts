import {Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * Orders resolved access-policy replicas for one database table. Table metadata
 * changes take precedence over changes to an inherited policy source.
 */
export const DatabaseTableAccessPolicyRevisionSchema = Schema.object({
    tableMetadataVersion: Schema.integer,
    sourcePolicyVersion: Schema.integer,
});

export type DatabaseTableAccessPolicyRevision = SchemaType<
    typeof DatabaseTableAccessPolicyRevisionSchema
>;
