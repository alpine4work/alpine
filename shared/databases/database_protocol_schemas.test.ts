import {TypedFastBitSet} from "typedfastbitset";
import {
    DatabaseRegisterTablesResultConfig,
    DatabaseTablePageDiffsSchema,
    DatabaseTableRegistrationsSchema,
} from "~/shared/databases/database_protocol_schemas.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

test("round-trips a table registration", () => {
    const registrations = new Map([
        [databaseMainTableId, {watermark: 41, heldPages: new TypedFastBitSet([0, 2, 262_143])}],
    ]);

    const roundTripped = DatabaseTableRegistrationsSchema.deserialize(
        DatabaseTableRegistrationsSchema.serialize(registrations),
    );

    expect({
        watermark: roundTripped.get(databaseMainTableId)?.watermark,
        heldPages: roundTripped.get(databaseMainTableId)?.heldPages.array(),
    }).toEqual({watermark: 41, heldPages: [0, 2, 262_143]});
});

test("round-trips registration catch-up pages and table access", () => {
    const resultSchema = Schema.object(DatabaseRegisterTablesResultConfig);
    const result = {
        tables: new Map([
            [
                databaseMainTableId,
                {
                    watermark: 42,
                    fileSizeInPages: 3,
                    catchUp: {
                        type: "pages" as const,
                        pages: new Map([[2, {version: 42, data: new Uint8Array([1, 2, 3])}]]),
                    },
                },
            ],
        ]),
        tableAccess: new Map([[databaseMainTableId, "Manage" as const]]),
    };

    const roundTripped = resultSchema.deserialize(resultSchema.serialize(result));

    expect({
        catchUp: roundTripped.tables.get(databaseMainTableId)?.catchUp,
        tableAccess: roundTripped.tableAccess.get(databaseMainTableId),
    }).toMatchObject({
        catchUp: {
            type: "pages",
            pages: new Map([[2, {version: 42}]]),
        },
        tableAccess: "Manage",
    });
});

test("round-trips a stale registration bitset", () => {
    const resultSchema = Schema.object(DatabaseRegisterTablesResultConfig);
    const result = {
        tables: new Map([
            [
                databaseMainTableId,
                {
                    watermark: 43,
                    fileSizeInPages: 4,
                    catchUp: {
                        type: "stale" as const,
                        pageIndexes: new TypedFastBitSet([1, 3]),
                    },
                },
            ],
        ]),
        tableAccess: new Map([[databaseMainTableId, null]]),
    };

    const roundTripped = resultSchema.deserialize(resultSchema.serialize(result));
    const catchUp = roundTripped.tables.get(databaseMainTableId)?.catchUp;

    expect(catchUp?.type === "stale" ? catchUp.pageIndexes.array() : null).toEqual([1, 3]);
});

test("round-trips the realtime batch version independently of page diffs", () => {
    const pageDiffs = {version: 44, diffs: new Map(), fileSizeInPages: 5};

    expect(
        DatabaseTablePageDiffsSchema.deserialize(DatabaseTablePageDiffsSchema.serialize(pageDiffs)),
    ).toEqual(pageDiffs);
});
