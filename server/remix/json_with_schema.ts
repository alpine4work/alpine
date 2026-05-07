import {json} from "@remix-run/router";
import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {BlockInference} from "~/shared/helpers/types/block_inference.js";
import {
    deserializedValueSymbol,
    propagateEventDataKey,
    siteLoaderDataKey,
    taskStoreLoaderDataKey,
} from "~/shared/remix/json_with_schema_shared.js";
import {SiteLoaderData, SiteLoaderDataSchema} from "~/shared/remix/site_loader_data.js";
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
        siteLoaderData,
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

        /**
         * Data for a site that contains the entity rendered by this route. Stashed on the
         * response under `siteLoaderDataKey` so the space-level `SiteProvider` (mounted
         * under `/s/:spaceId`) can read it synchronously via `useMatches` on its first
         * render — letting site chrome paint immediately without a `useEffect` round-trip.
         *
         * Entity routes that should render inside a site (documents, channels, tasks,
         * etc.) populate this from their loader; routes that don't belong to a site leave
         * it unset.
         */
        siteLoaderData?: SiteLoaderData;
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

    if (siteLoaderData) {
        const siteLoaderDataSerializedValue = SiteLoaderDataSchema.serialize(siteLoaderData);
        (siteLoaderDataSerializedValue as any)[deserializedValueSymbol] = siteLoaderData;

        (serializedValue as any)[siteLoaderDataKey] = siteLoaderDataSerializedValue;
    }

    return json(serializedValue, responseInit);
}
