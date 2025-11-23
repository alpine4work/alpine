import {useCallback, useEffect, useMemo, useRef} from "react";
import {useLocation} from "react-router-dom";
import {useNavigate} from "~/client/web/remix/use_navigate.js";

/**
 * Convenient React-style state for a string that is persisted in the URL's
 * search parameters.
 */
export function useUrlSearchParamState(
    searchParamName: string,
): [value: string | null, setValue: (value: string | null) => void] {
    const location = useLocation();
    const navigate = useNavigate();

    const locationRef = useRef(location);
    useEffect(() => {
        locationRef.current = location;
    });

    const value = useMemo(() => {
        const searchParams = new URLSearchParams(location.search);
        return searchParams.get(searchParamName);
    }, [location.search, searchParamName]);

    const setValue = useCallback(
        (value: string | null) => {
            const searchParams = new URLSearchParams(locationRef.current.search);

            if (value !== null) {
                searchParams.set(searchParamName, value);
            } else {
                searchParams.delete(searchParamName);
            }

            void navigate({search: searchParams.toString()});
        },
        [navigate, searchParamName],
    );

    return [value, setValue];
}
