import {FetcherWithComponents} from "@remix-run/react";
import {useMemo} from "react";
import {useFetcher} from "react-router-dom";
import {Schema} from "~/shared/schema/schema.open_source.js";

/**
 * Returns a fetcher object with deserialized data from a schema.
 *
 * In basically all cases, we recommend using `<fetcher.Form>` and
 * `useFetcherWithSchema()` instead of `<Form>` and `useActionDataWithSchema()`.
 * The reason is `<Form>` _always_ changes the location on submit whereas fetcher
 * only changes the location if a `redirect()` is returned from the route's action.
 *
 * When the location changes in our native mobile apps, a push animation is
 * initiated. This is very strange when there was an error on form submission.
 * Since the exact same page is animated in but with a form error displayed. Since
 * `<fetcher.Form>` does not change the location this animation does not happen on
 * error responses.
 *
 * Remix documentation includes a page on [Form vs. fetcher][1]. The recommendation
 * there is to choose between form or fetcher based on whether or not you want the
 * URL to change. If a URL change is desired use `<Form>`. In basically all cases,
 * we don't want a URL change when there's an error. Since fetcher doesn't change
 * the URL by default (error case) but still allows a URL change by returning a
 * `redirect()` response prefer fetcher.
 *
 * [1]: https://remix.run/docs/en/main/discussion/form-vs-fetcher
 */
export function useFetcherWithSchema<Value>(
    schema: Schema<Value>,
): FetcherWithComponents<Value | undefined> {
    const fetcher = useFetcher();

    const serializedValue = fetcher.data;

    const deserializedValue = useMemo(
        () => (serializedValue !== undefined ? schema.deserialize(serializedValue) : undefined),
        [schema, serializedValue],
    );

    return useMemo(
        () => ({...fetcher, data: deserializedValue}) as FetcherWithComponents<Value | undefined>,
        [deserializedValue, fetcher],
    );
}
