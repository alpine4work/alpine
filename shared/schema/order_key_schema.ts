import {assert} from "~/shared/helpers/control/assert.js";
import {OrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

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
