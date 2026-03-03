import {json} from "@remix-run/router";
import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {BlockInference} from "~/shared/helpers/types/block_inference.js";
import {
    deserializedValueSymbol,
    propagateEventDataKey,
    taskStoreLoaderDataKey,
} from "~/shared/remix/json_with_schema_shared.js";
import {
    TaskStoreLoaderData,
    TaskStoreLoaderDataSchema,
} from "~/shared/remix/task_store_loader_data.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Creates a JSON HTTP response using a schema for serialization.
 */
export function jsonWithSchema<Value>(
    schema: Schema<Value>,
    value: BlockInference<Value>,
    {
        propagateEventData,
        taskStoreLoaderData,
        ...responseInit
    }: ResponseInit & {
        /**
         * Data to propagate in all tracer events while on this route. We collect all
         * propagated event data in the `<Root>` component and add it to our tracer.
         */
        propagateEventData?: TracerEventData;

        /**
         * You might ask: Task data in a generic helper? What is this?
         *
         * We have a shared loader data property for tasks because we want all task data to
         * go into a normalized store which lives at the `/s/:spaceId` route but that data
         * can be loaded from any route's loader function.
         *
         * The `/s/:spaceId` route knows to look for this shared property on all loader
         * data and will incorporate it into the store.
         *
         * This does mean shared logic code in `~/shared/tasks` is always included in the
         * JavaScript bundle for `/s/:spaceId` routes. We accept this since we do want
         * normalized task data to be accessible everywhere throughout the product.
         */
        taskStoreLoaderData?: TaskStoreLoaderData;
    } = {},
): Response {
    const serializedValue = schema.serialize(value as Value);

    // The serialized value must be an object so we can add properties to it. Like the
    // original, deserialized, value and the propagated event data.
    assert(isPlainObject(serializedValue));

    // When we render our component on the server, it's wasteful of CPU time to
    // deserialize again. So as an optimization, put the deserialized value on a
    // non-enumerable property.
    (serializedValue as any)[deserializedValueSymbol] = value;

    // If we are propagating event data, stash it on the serialized result. Our
    // `<Root>` component will read this property and add it to the tracer.
    if (propagateEventData) {
        (serializedValue as any)[propagateEventDataKey] = propagateEventData;
    }

    // If we have task data to load in our shared store, stash it on the serialized
    // result. Our `/s/:spaceId` route knows to look for this property and will add the
    // data to our shared store.
    if (taskStoreLoaderData) {
        const taskStoreLoaderDataSerializedValue =
            TaskStoreLoaderDataSchema.serialize(taskStoreLoaderData);
        (taskStoreLoaderDataSerializedValue as any)[deserializedValueSymbol] = taskStoreLoaderData;

        (serializedValue as any)[taskStoreLoaderDataKey] = taskStoreLoaderDataSerializedValue;
    }

    return json(serializedValue, responseInit);
}
