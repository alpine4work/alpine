import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {OrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.open_source.js";

export const OrderKeySchema = Schema.string.transform<OrderKey>({
    serialize: value => {
        assert(isOrderKey(value));
        return value;
    },
    deserialize: value => {
        if (!isOrderKey(value))
            throw new SchemaDeserializationError("Expected string to be an order key");

        return value;
    },
});
