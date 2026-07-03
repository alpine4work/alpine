import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {SqlQuery} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";

export abstract class DatabaseSchemaScopedBaseModel {
    readonly db: SqliteDatabase;

    constructor(
        readonly schema: SqlQuery,
        readonly root: DatabaseModel,
    ) {
        this.db = root.db;
    }
}
