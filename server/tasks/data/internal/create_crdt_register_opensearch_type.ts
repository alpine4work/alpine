import {
    OpensearchIndexObjectType,
    OpensearchIndexTypeBase,
} from "~/server/opensearch/opensearch_index_type.js";
import {HybridLogicalTimeType} from "~/server/tasks/data/internal/hybrid_logical_time_type.js";
import {CrdtRegister, CrdtRegisterClass} from "~/shared/crdt/crdt_register.js";

/**
 * Creates an OpenSearch object type for a CRDT register.
 */
export function createCrdtRegisterOpensearchType<Value, FlattenedKeys extends string>(
    class_: CrdtRegisterClass<Value>,
    type: OpensearchIndexTypeBase<Value, FlattenedKeys>,
) {
    return OpensearchIndexObjectType.new({
        fields: {
            value: type,
            version: HybridLogicalTimeType,
        },
    }).transform<CrdtRegister<Value>>({
        serialize: register => register,
        deserialize: register => new class_(register.value, register.version),
    });
}
