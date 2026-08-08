import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export type TaskStepCountByAccountId = InstanceType<typeof TaskStepCountByAccountId>;

export const TaskStepCountByAccountId = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<AccountId, number>
>(Schema.bytes, {
    serialize: stepCountByAccountId => {
        const bytes = new Uint8Array(stepCountByAccountId.size * (idByteLength + 4));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;
        for (const [accountId, stepCount] of stepCountByAccountId) {
            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            view.setUint32(byteOffset, stepCount);
            byteOffset += 4;
        }

        return bytes;
    },
    deserialize: bytes => {
        const view = new DataView(bytes.buffer);
        const stepCountByAccountId = new Map<AccountId, number>();

        let byteOffset = 0;
        while (byteOffset + idByteLength + 4 <= bytes.byteLength) {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const stepCount = view.getUint32(byteOffset);
            byteOffset += 4;

            stepCountByAccountId.set(accountId, stepCount);
        }

        return stepCountByAccountId;
    },
});
