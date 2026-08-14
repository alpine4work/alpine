import {themeColors} from "~/shared/design/core/theme_colors.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Configuration for a blob used on document content covers.
 */
const DocumentContentCoverBlobsConfigSchema = Schema.object({
    type: Schema.value("Blobs"),
    seed: Schema.string,
    themeColor: Schema.enum(themeColors),
    hueSpread: Schema.integer,
});

/**
 * All configuration options for a document content cover.
 */
export type DocumentContentCover = SchemaType<typeof DocumentContentCoverSchema>;

export const DocumentContentCoverSchema = Schema.union({
    Blobs: DocumentContentCoverBlobsConfigSchema,
});
