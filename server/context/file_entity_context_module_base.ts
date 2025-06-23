import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {ErrorBase, UnimplementedError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Context module for loading file entities. This needs to be done in a context
 * module instead of directly calling `getFileEntityIfPossible()` since a
 * primitive package like `server/content` can't depend on
 * `server/documents/data` and `server/tasks/data` so we need to do dependency
 * injection.
 */
export abstract class FileEntityContextModuleBase<
        Modules extends {[key: string]: ContextModuleBase | undefined} = {},
    >
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    public abstract getIfPossible(
        spaceId: SpaceId,
        entityId: FileEntityId,
    ): Promise<Result<FileEntityModel, ErrorBase> | null>;

    public abstract fork(): FileEntityContextModuleBase;
}

export class TestFileEntityContextModule extends FileEntityContextModuleBase {
    constructor() {
        super();
        assert(process.env.NODE_ENV === "test");
    }

    public override getIfPossible(): never {
        throw new UnimplementedError(
            "`TestFileEntityContextModule.getIfPossible()` can’t be implemented in unit tests because we want to limit unit test dependencies to just what we need",
        );
    }

    public fork() {
        return new TestFileEntityContextModule();
    }
}
