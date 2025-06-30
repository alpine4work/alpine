import {getFileEntityIfPossible} from "~/server/content/context_module/get_file_entity_if_possible.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
import {ServerContentActionContextModules} from "~/server/context/server_content_action_context.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {getSearchMentionEntityIfPossible} from "~/server/search/data/index/search_entity_index.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {ErrorBase} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {fileEntityMaxRecursionDepth} from "~/shared/files/file_entity_max_recursion_depth.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

export class ContentContextModule extends ContentContextModuleBase<
    ServerContentActionContextModules & {
        opensearch: OpensearchContextModule;
        tasks: TaskContextModuleBase;
    }
> {
    private readonly _fileEntityDepth: number;

    constructor(fileEntityDepth: number = 0) {
        super();
        this._fileEntityDepth = fileEntityDepth;
    }

    public override getSearchEntityIfPossible(
        spaceId: SpaceId,
        entityId: SearchMentionEntityId,
    ): Promise<{isPrivate: false; entity: SearchEntityModel} | {isPrivate: true} | null> {
        return getSearchMentionEntityIfPossible(
            this._context.actor.authorizeSession(),
            spaceId,
            entityId,
        );
    }

    public override getFileEntityIfPossible(
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
        if (this._fileEntityDepth >= fileEntityMaxRecursionDepth) return Promise.resolve(null);

        const context = this._context.clone({
            content: new ContentContextModule(this._fileEntityDepth + 1),
        });

        return getFileEntityIfPossible(context, spaceId, entityId);
    }

    public override fork() {
        return new ContentContextModule(this._fileEntityDepth);
    }
}
