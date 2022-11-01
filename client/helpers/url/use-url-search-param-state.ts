import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {useCallback, useEffect, useRef} from "react";

/**
 * Convenient React-style state for a string that is persisted in the URL's
 * search parameters.
 */
// TODO(calebmer): This is much slower now with React server components. Maybe
// find a different strategy for updating this state? Can we make it client
// only.
export function useUrlSearchParamState(
    searchParamName: string,
): [value: string | null, setValue: (value: string | null) => void] {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const pathnameAndSearchParamsRef = useRef({pathname, searchParams});
    useEffect(() => {
        pathnameAndSearchParamsRef.current = {pathname, searchParams};
    });

    const value = searchParams.get(searchParamName);

    const setValue = useCallback(
        (value: string | null) => {
            const {searchParams, pathname} = pathnameAndSearchParamsRef.current;

            const newSearchParams = new URLSearchParams(searchParams);

            if (value !== null) {
                newSearchParams.set(searchParamName, value);
            } else {
                newSearchParams.delete(searchParamName);
            }

            const newSearchParamsString = newSearchParams.toString();

            router.replace(
                `${pathname}${newSearchParamsString.length > 0 ? `?${newSearchParamsString}` : ""}`,
            );
        },
        [searchParamName, router],
    );

    return [value, setValue];
}
