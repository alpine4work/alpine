import type {DatabaseFieldId, DatabaseRowId} from "~/shared/id/types/id_types.js";

/**
 * A page of database view rows. Wraps the raw array-based
 * row data from `getViewRowsPage` with a per-page field
 * index mapping. Row objects are created lazily and cached.
 */
export class DatabaseQueryPage {
    readonly pageId: number;
    readonly afterCursor: DatabaseRowId | null;
    readonly endCursor: DatabaseRowId | null;

    private readonly _fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;
    private readonly _rawRows: ReadonlyArray<ReadonlyArray<unknown>>;
    private readonly _cachedRows: Array<DatabaseQueryRow | undefined>;

    constructor(options: {
        pageId: number;
        afterCursor: DatabaseRowId | null;
        endCursor: DatabaseRowId | null;
        fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;
        rows: ReadonlyArray<ReadonlyArray<unknown>>;
    }) {
        this.pageId = options.pageId;
        this.afterCursor = options.afterCursor;
        this.endCursor = options.endCursor;
        this._fieldIndexes = options.fieldIndexes;
        this._rawRows = options.rows;
        this._cachedRows = new Array(options.rows.length);
    }

    get rowCount(): number {
        return this._rawRows.length;
    }

    getRow(index: number): DatabaseQueryRow {
        let row = this._cachedRows[index];
        if (row === undefined) {
            row = new DatabaseQueryRow(this._rawRows[index]!, this._fieldIndexes);
            this._cachedRows[index] = row;
        }
        return row;
    }
}

/**
 * A single row in a database view. Values are stored as
 * an array; field values are accessed by field ID through
 * the page's field-index mapping. `_id` is always at
 * index 0.
 */
export class DatabaseQueryRow {
    private readonly _values: ReadonlyArray<unknown>;
    private readonly _fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;

    constructor(
        values: ReadonlyArray<unknown>,
        fieldIndexes: ReadonlyMap<DatabaseFieldId, number>,
    ) {
        this._values = values;
        this._fieldIndexes = fieldIndexes;
    }

    getId(): DatabaseRowId {
        return this._values[0] as DatabaseRowId;
    }

    getCellValue(fieldId: DatabaseFieldId): unknown {
        const index = this._fieldIndexes.get(fieldId);
        if (index === undefined) return undefined;
        return this._values[index];
    }
}
