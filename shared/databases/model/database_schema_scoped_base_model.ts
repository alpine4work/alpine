import type {DatabaseActionContext} from "~/shared/databases/database_action_context.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {SqlQuery} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";

export abstract class DatabaseSchemaScopedBaseModel {
    /** The action context the root model runs in — see `DatabaseModel.ctx`. */
    readonly ctx: DatabaseActionContext;
    readonly db: SqliteDatabase;

    constructor(
        readonly schema: SqlQuery,
        root: DatabaseModel,
    ) {
        this.ctx = root.ctx;
        this.db = root.db;
    }

    get root(): DatabaseModel {
        return this.ctx.model;
    }
}
