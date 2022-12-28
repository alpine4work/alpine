// These constants need to be in `shared` since they are used from both
// `client` and `server`. `client` can't import `server` and `server`
// can't import `client`.

/**
 * We stash the deserialized value on the result of `jsonWithSchema()` so that
 * when server-side rendering our Remix app we don't need to do a wasteful
 * deserialize.
 */
export const deserializedValueSymbol = Symbol("deserializedValue");

/**
 * A key for accessing propagated event data on a result returned from
 * `jsonWithSchema()`. Propagated event data is then consumed in `<Root>` and
 * added to our tracer.
 *
 * We don't want code to directly accesses this property, instead use this
 * variable. That makes code related to propagating event data with
 * `jsonWithSchema()` easier to track. We include some random characters at the
 * end to discourage hardcoding this property.
 */
export const propagatedEventDataKey = "_propagateEventData_e215dc3a";
