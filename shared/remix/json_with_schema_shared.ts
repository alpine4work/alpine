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
 * shared `TaskClientStore`. We have a shared `TaskClientStore` in the `_space`
 * route layout component but we need to get data into that store through sub-route
 * loaders. We do this with a special key on our loader data.
 *
 * We don't want code to directly accesses this property, instead use this
 * variable. That makes code related to shared task store data loading with
 * `jsonWithSchema()` easier to track.
 */
export const taskStoreLoaderDataKey = "_taskStoreLoaderData";

/**
 * A key for accessing site activation data returned by a loader. The space-level
 * `SiteProvider` (mounted under the `_space` layout route) reads this property off
 * the matched routes' loader data via `useMatches` so it can synchronously
 * activate the site on the first render — see `SiteProvider` in
 * `client/web/sites/context/site_context.tsx` for the full activation flow.
 *
 * We need a shared key because entity routes nested under the `_space` layout
 * route (e.g. documents, channels, tasks) own their own loader output but each of
 * them must be able to publish "I'm part of site X with this initial query result"
 * up to the space-level provider. The provider scans every matched route's loader
 * data for this key.
 *
 * We don't want code to directly access this property, instead use this variable.
 * That makes code related to site activation with `jsonWithSchema()` easier to
 * track.
 */
export const siteLoaderDataKey = "_siteLoaderData";
