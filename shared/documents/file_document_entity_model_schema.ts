import {DocumentContentWithReferencesSchema} from "~/shared/documents/document_content_references.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export type FileDocumentEntityModel = SchemaType<typeof FileDocumentEntityModelSchema>;

export const FileDocumentEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Document"),
    id: Schema.id<DocumentId>(),
    version: Schema.integer,
    titleWithoutFallback: Schema.string,
    preview: Schema.object({
        version: Schema.integer,
        content: DocumentContentWithReferencesSchema,
    }).nullable(),
    /**
     * The site this document belongs to, if any. Populated when the document's access
     * policy resolves to a `Site` policy.
     */
    site: SitePreviewModel.schema.nullable().default(null),
});
