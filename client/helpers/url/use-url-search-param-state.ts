import {useRouter} from "next/router";
import {useCallback, useMemo} from "react";

/**
 * Convenient React-style state for a string that is persisted in the URL's
 * search parameters.
 */
export function useUrlSearchParamState(
    searchParamName: string,
): [value: string | null, setValue: (value: string | null) => void] {
    const router = useRouter();

    const value = useMemo(() => {
        // If Next.js is rendering the page with SSG, search params are
        // not available.
        if (!router.isReady) return null;

        const url = new URL(`https://www.example.com${router.asPath}`);
        return url.searchParams.get(searchParamName);
    }, [router.isReady, router.asPath, searchParamName]);

    const setValue = useCallback(
        (value: string | null) => {
            const url = new URL(`https://www.example.com${router.asPath}`);

            if (value !== null) {
                url.searchParams.set(searchParamName, value);
            } else {
                url.searchParams.delete(searchParamName);
            }

            router.replace(`${url.pathname}${url.hash}${url.search}`);
        },
        [searchParamName, router],
    );

    return [value, setValue];
}
