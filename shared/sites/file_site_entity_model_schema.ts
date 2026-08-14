import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type FileSiteEntityModel = SchemaType<typeof FileSiteEntityModelSchema>;

export const FileSiteEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Site"),
    id: Schema.id<SiteId>(),
    name: LabelStringSchema,
    /**
     * The first entity in the site, used as the nested preview body. `null` for sites
     * with no entries (or when the file-entity recursion-depth cutoff is reached deep
     * inside a nested preview).
     *
     * A plain `FileEntityModel` rather than a `FileEntityModelResult`: access to the
     * site implies access to its first entity (entries inherit the site's access
     * policy), so the server unwraps the load result in
     * `getFileSiteEntityModelIfPossible` and asserts the invariant there. That keeps
     * the "first entity failed to load" state impossible for clients.
     */
    firstEntity: FileEntityModel.schema.nullable(),
});
