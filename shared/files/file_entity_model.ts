import {ErrorSchema} from "~/shared/error/error_schema.js";
import {getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * An interface schema representing file entities. We should create implementations
 * of this model in other packages where relevant.
 *
 * This uses `Schema.interface()` because otherwise there would be a schema cycle
 * here. `ContentReferences` contains `FileEntityModel`s and some `FileEntityModel`
 * (specifically `FileDocumentEntityModel`) contain `ContentReferences` which may
 * in turn contain more `FileEntityModel`s etc.
 *
 * We could also use `Schema.declare()` which supports cyclic schemas a little more
 * ergonomically but that would require bringing all the schemas we need into one
 * Bazel package. Instead of keeping them split between `share/forum`,
 * `shared/documents`, `shared/tasks`, etc.
 *
 * Another relevant note: A long term infrastructure project I (@calebmer) think
 * we'll want to invest in is "app slices". The ability to run the app in tests
 * with a subset of features. For example, running the app with only documents
 * enabled. You wouldn't be able to access tasks or channels or anything like that.
 * Just documents. If we had app slices it would speed up our integration test
 * suite (which is ~40% of our test time right now) since if you changed some code
 * related to tasks we'd only need to rerun task integration tests and we could
 * skip document integration tests. `FileEntityModel` needs to be a
 * `Schema.interface()` to support app slices since then we could have a slice
 * where there's only a `FileTaskCollectionEntityModel` implementation and no
 * `FileDocumentEntityModel` implementation.
 */
export type FileEntityModel = InstanceType<typeof FileEntityModel>;

export const FileEntityModel = Schema.interface({
    /**
     * The type of this file entity.
     */
    type: Schema.enum(getFileEntityTypes()),

    /**
     * Version numbers associated with this entity. When we call
     * `mergeContentReferences()` we use `versions` to pick a winner. We iterate
     * through the version array of both models and the first time we find a version
     * number that's different we pick the model with a higher version number out of
     * the two. If one version array is a prefix of another than we pick the model with
     * the longer version array.
     *
     * This is a generic conflict resolution mechanism. Different entities will have
     * fundamentally different ways of resolving conflicts. But we need a generic way
     * to merge multiple entities together. So that's what we have here.
     */
    versions: Schema.array(Schema.integer),
});

export type FileEntityModelResult = SchemaType<typeof FileEntityModelResultSchema>;

export const FileEntityModelResultSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        value: FileEntityModel.schema,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
