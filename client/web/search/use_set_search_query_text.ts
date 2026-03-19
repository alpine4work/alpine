import {useSearchParams} from "@remix-run/react";
import {useCallback} from "react";

/**
 * Since search is set in URL `searchParams` you can set the search query text from
 * anywhere in the app.
 */
export function useSetSearchQueryText() {
    const [, setSearchParams] = useSearchParams();

    const setSearchQueryText = useCallback(
        (queryText: string | null) => {
            setSearchParams(
                oldSearchParams => {
                    if (oldSearchParams.get("search") === queryText) return oldSearchParams;

                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    if (queryText === null) {
                        newSearchParams.delete("search");
                    } else {
                        newSearchParams.set("search", queryText);
                    }
                    return newSearchParams;
                },
                {
                    replace: true,
                    // Don't revalidate when updating search params from here. We can't use the stable
                    // `shouldRevalidate` route function because we want ALL rendered routes to skip
                    // revalidation. And updating all rendered routes `shouldRevalidate` function to
                    // ignore `search` is too much of a burden.
                    unstable_shouldRevalidate: false,
                },
            );
        },
        [setSearchParams],
    );

    return setSearchQueryText;
}
