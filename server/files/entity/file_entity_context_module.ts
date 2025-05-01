import {FileEntityContextModuleBase} from "~/server/context/file_entity_context_module_base.js";
import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {getFileEntityIfPossible} from "~/server/files/entity/get_file_entity_if_possible.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {fileEntityMaxRecursionDepth} from "~/shared/files/file_entity_max_recursion_depth.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export class FileEntityContextModule extends FileEntityContextModuleBase<
    ServerContentActionContextModules & {tasks: TaskContextModuleBase}
> {
    private readonly _depth: number;

    constructor(depth: number = 0) {
        super();
        this._depth = depth;
    }

    public override getIfPossible(
        spaceId: SpaceId,
        entityId: FileEntityId,
    ): Promise<Result<FileEntityModel, ErrorBase> | null> {
        // Cut off file entity loading when we're three entities deep. File entities
        // may recursively load each other (e.g. a document which has a file entity to
        // itself in its preview) so we need some protection to protect against
        // infinite recursion.
        //
        // Also, practically after three levels of depth previews shrink to such a size
        // you can't see what's being rendered.
        if (this._depth >= fileEntityMaxRecursionDepth) return Promise.resolve(null);

        const context = this._context.clone({
            fileEntity: new FileEntityContextModule(this._depth + 1),
        });

        return getFileEntityIfPossible(context, spaceId, entityId);
    }

    public override fork() {
        return new FileEntityContextModule(this._depth);
    }
}
