import {Id, decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * A more space efficient representation of an unordered set of `Id`s.
 *
 * A UTF-8 encoded `Id` is 26 bytes whereas a binary encoded `Id` is 16 bytes. When
 * storing in DynamoDB an array also has an additional [3 bytes of overhead][1]. So
 * a binary encoding of an `Id` set is ~38% less than a UTF-8 encoding.
 *
 * There is some added serialization/deserialization overhead to using this `Id`
 * set though which is the tradeoff.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CapacityUnitCalculations.html
 */
export const IdByteSetSchema = {
    // Function so that you can pass in a custom `Id` type.
    get: <Value extends Id>(): Schema<ReadonlySet<Value>> => _IdByteSetSchema as Schema<any>,
};

const _IdByteSetSchema = Schema.bytes.transform<ReadonlySet<Id>>({
    serialize: ids => {
        const bytes = new Uint8Array(ids.size * idByteLength);

        let byteOffset = 0;
        for (const id of ids) {
            decodeIdInto(id, bytes, byteOffset);
            byteOffset += idByteLength;
        }

        return bytes;
    },
    deserialize: bytes => {
        const ids = new Set<Id>();

        for (
            let byteOffset = 0;
            byteOffset + idByteLength <= bytes.byteLength;
            byteOffset += idByteLength
        ) {
            ids.add(encodeId(bytes, byteOffset));
        }

        return ids;
    },
});
