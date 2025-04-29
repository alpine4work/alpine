import {FileEntityContextModuleBase} from "~/server/context/file_entity_context_module_base.js";
import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {getFileEntityIfPossible} from "~/server/files/entity/get_file_entity_if_possible.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export class FileEntityContextModule extends FileEntityContextModuleBase<
    ServerContentActionContextModules & {tasks: TaskContextModuleBase}
> {
    public override getIfPossible(
        spaceId: SpaceId,
        entityId: FileEntityId,
    ): Promise<Result<FileEntityModel, ErrorBase> | null> {
        return getFileEntityIfPossible(this._context, spaceId, entityId);
    }

    public override fork() {
        return new FileEntityContextModule();
    }
}
