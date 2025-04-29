import {FileEntityType, getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * An interface schema representing file entities. We should create
 * implementations of this model in other packages where relevant.
 *
 * This uses `Schema.interface()` because otherwise there would be a schema
 * cycle here. `ContentReferences` contains `FileEntityModel`s and some
 * `FileEntityModel` (specifically `FileDocumentEntityModel`) contain
 * `ContentReferences` which may in turn contain more `FileEntityModel`s etc.
 *
 * We could also use `Schema.declare()` which supports cyclic schemas a little
 * more ergonomically but that would require bringing all the schemas we need
 * into one Bazel package. Instead of keeping them split between `share/forum`,
 * `shared/documents`, `shared/tasks`, etc.
 *
 * Another relevant note: A long term infrastructure project I (@calebmer)
 * think we'll want to invest in is "app slices". The ability to run the app in
 * tests with a subset of features. For example, running the app with only
 * documents enabled. You wouldn't be able to access tasks or channels or
 * anything like that. Just documents. If we had app slices it would speed up
 * our integration test suite (which is ~40% of our test time right now) since
 * if you changed some code related to tasks we'd only need to rerun task
 * integration tests and we could skip document integration tests.
 * `FileEntityModel` needs to be a `Schema.interface()` to support app slices
 * since then we could have a slice where there's only a
 * `FileTaskCollectionEntityModel` implementation and no
 * `FileDocumentEntityModel` implementation.
 */
export type FileEntityModel = InstanceType<typeof FileEntityModel>;

export const FileEntityModel = Schema.interface({
    type: Schema.enum(getFileEntityTypes()),
});

export class FileEntityMergeableModel {
    public static readonly schema = Schema.array(FileEntityModel.schema)
        .minLength(1)
        .validation("Must have a single `type`", models => {
            const type = models[0]?.type;

            for (let i = 1; i < models.length; i++) {
                if (type !== models[i]!.type) return false;
            }

            return true;
        })
        .transform<FileEntityMergeableModel>({
            serialize: model => model._models,
            deserialize: models => new FileEntityMergeableModel(models[0]!.type, models),
        });

    public readonly type: FileEntityType;
    private readonly _models: ReadonlyArray<FileEntityModel>;

    private constructor(type: FileEntityType, models: ReadonlyArray<FileEntityModel>) {
        this.type = type;
        this._models = models;
    }

    public static new(model: FileEntityModel): FileEntityMergeableModel {
        return new FileEntityMergeableModel(model.type, [model]);
    }

    public merge(otherModel: FileEntityMergeableModel): FileEntityMergeableModel {
        // If `otherModel`'s type is different from our current model's type then
        // select the one with a larger type lexicographically. This really shouldn't
        // happen in practice. The types of file entity models don't change since a
        // `FileEntityId` only ever has one type.
        if (otherModel.type > this.type) return otherModel;
        if (otherModel.type < this.type) return this;

        // We don't know how to merge specific file entity model implementations at
        // this point in the code. The deserializer is therefore responsible for
        // defining merge logic.
        return new FileEntityMergeableModel(this.type, this._models.concat(otherModel._models));
    }
}
