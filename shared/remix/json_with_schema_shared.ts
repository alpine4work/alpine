// These constants need to be in `shared` since they are used from both `client`
// and `server`. `client` can't import `server` and `server` can't import `client`.

/**
 * We stash the deserialized value on the result of `jsonWithSchema()` so that when
 * server-side rendering our Remix app we don't need to do a wasteful deserialize.
 */
export const deserializedValueSymbol = Symbol("deserializedValue");

/**
 * A key for accessing propagated event data on a result returned from
 * `jsonWithSchema()`. Propagated event data is then consumed in `<Root>` and added
 * to our tracer.
 *
 * We don't want code to directly accesses this property, instead use this
 * variable. That makes code related to propagating event data with
 * `jsonWithSchema()` easier to track.
 */
export const propagateEventDataKey = "_propagateEventData";

/**
 * A key for accessing data returned by a loader that should be integrated into the
 * shared `TaskClientStore`. We have a shared `TaskClientStore` in the
 * `/s/:spaceId` layout component but we need to get data into that store through
 * sub-route loaders. We do this with a special key on our loader data.
 *
 * We don't want code to directly accesses this property, instead use this
 * variable. That makes code related to shared task store data loading with
 * `jsonWithSchema()` easier to track.
 */
export const taskStoreLoaderDataKey = "_taskStoreLoaderData";
