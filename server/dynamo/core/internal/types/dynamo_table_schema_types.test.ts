import {expectTypeOf} from "expect-type";
import {DynamoTableSchemaTypes} from "~/server/dynamo/core/internal/types/dynamo_table_schema_types.js";

test("`TupleDropBeforeAndTakeUntil` returns a tuple of types between two strings", () => {
    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "b",
            "e"
        >
    >().toEqualTypeOf<["e", "d", "c", "b"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "a",
            "f"
        >
    >().toEqualTypeOf<["f", "e", "d", "c", "b", "a"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "c",
            "f"
        >
    >().toEqualTypeOf<["f", "e", "d", "c"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "a",
            "d"
        >
    >().toEqualTypeOf<["d", "c", "b", "a"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "c",
            "d"
        >
    >().toEqualTypeOf<["d", "c"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "b",
            "b"
        >
    >().toEqualTypeOf<["b"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "e",
            "b"
        >
    >().toEqualTypeOf<never>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "a",
            "z"
        >
    >().toEqualTypeOf<never>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            ["a", "b", "c", "d", "e", "f"],
            "z",
            "f"
        >
    >().toEqualTypeOf<never>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            [
                "Attributes",
                "Account",
                "Messages",
                "Messages#AgentResponse",
                "Messages#AgentResponsePart",
                "MessageChangeLog",
            ],
            "Messages",
            "Messages"
        >
    >().toEqualTypeOf<["Messages#AgentResponsePart", "Messages#AgentResponse", "Messages"]>();

    expectTypeOf<
        DynamoTableSchemaTypes.Partition.TupleDropBeforeAndTakeUntil<
            [
                "Attributes",
                "Account",
                "Messages",
                "Messages#AgentResponse",
                "Messages#AgentResponsePart",
                "MessageChangeLog",
            ],
            "Messages",
            "MessageChangeLog"
        >
    >().toEqualTypeOf<
        ["MessageChangeLog", "Messages#AgentResponsePart", "Messages#AgentResponse", "Messages"]
    >();
});
