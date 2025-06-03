import {DocumentContentWithReferencesSchema} from "~/shared/documents/document_content_references.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

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
});
