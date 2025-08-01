import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {ErrorBase, UnimplementedError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

/**
 * Context module for loading content references (like search entities and file
 * entities). This needs to be done in a context module instead of directly
 * calling `getFileEntityIfPossible()` since a primitive package like
 * `server/content` can't depend on `server/documents/data` and
 * `server/tasks/data` so we need to do dependency injection.
 */
export abstract class ContentContextModuleBase<
        Modules extends {[key: string]: ContextModuleBase | undefined} = {},
    >
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    public abstract getSearchEntityIfPossible(
        spaceId: SpaceId,
        entityId: SearchMentionEntityId,
    ): Promise<{isPrivate: false; entity: SearchEntityModel} | {isPrivate: true} | null>;

    public abstract getFileEntityIfPossible(
        spaceId: SpaceId,
        entityId: FileEntityId,
    ): Promise<Result<FileEntityModel, ErrorBase> | null>;

    public abstract fork(): ContentContextModuleBase;
}

export type TestContentContextModuleOptions<Modules extends {[key: string]: ContextModuleBase}> = {
    getSearchEntityIfPossible?:
        | ((
              context: Context<Modules>,
              spaceId: SpaceId,
              entityId: SearchMentionEntityId,
          ) => Promise<{isPrivate: false; entity: SearchEntityModel} | {isPrivate: true} | null>)
        | null;
    getFileEntityIfPossible?:
        | ((
              context: Context<Modules>,
              spaceId: SpaceId,
              entityId: FileEntityId,
          ) => Promise<Result<FileEntityModel, ErrorBase> | null>)
        | null;
};

export class TestContentContextModule<
    Modules extends {[key: string]: ContextModuleBase} = {},
> extends ContentContextModuleBase<Modules> {
    private readonly _getSearchEntityIfPossible:
        | ((
              context: Context<Modules>,
              spaceId: SpaceId,
              entityId: SearchMentionEntityId,
          ) => Promise<{isPrivate: false; entity: SearchEntityModel} | {isPrivate: true} | null>)
        | null;

    private readonly _getFileEntityIfPossible:
        | ((
              context: Context<Modules>,
              spaceId: SpaceId,
              entityId: FileEntityId,
          ) => Promise<Result<FileEntityModel, ErrorBase> | null>)
        | null;

    constructor({
        getSearchEntityIfPossible = null,
        getFileEntityIfPossible = null,
    }: TestContentContextModuleOptions<Modules> = {}) {
        super();
        assert(process.env.NODE_ENV === "test");

        this._getSearchEntityIfPossible = getSearchEntityIfPossible;
        this._getFileEntityIfPossible = getFileEntityIfPossible;
    }

    public override getSearchEntityIfPossible(spaceId: SpaceId, entityId: SearchMentionEntityId) {
        if (this._getSearchEntityIfPossible === null) {
            throw new UnimplementedError(
                "`TestContentContextModule.getSearchEntityIfPossible()` can’t be implemented in unit tests because we want to limit unit test dependencies to just what we need",
            );
        }
        return this._getSearchEntityIfPossible(this._context, spaceId, entityId);
    }

    public override getFileEntityIfPossible(spaceId: SpaceId, entityId: FileEntityId) {
        if (this._getFileEntityIfPossible === null) {
            throw new UnimplementedError(
                "`TestContentContextModule.getFileEntityIfPossible()` can’t be implemented in unit tests because we want to limit unit test dependencies to just what we need",
            );
        }
        return this._getFileEntityIfPossible(this._context, spaceId, entityId);
    }

    public fork() {
        return new TestContentContextModule({
            getSearchEntityIfPossible: this._getSearchEntityIfPossible,
            getFileEntityIfPossible: this._getFileEntityIfPossible,
        });
    }
}
