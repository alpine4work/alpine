import {useCallback} from "react";
import {useUrlSearchParamState} from "~/client/web/remix/use_url_search_param_state.js";

/**
 * Convenient React-style state for a boolean that is persisted in the URL's search
 * parameters.
 */
export function useUrlSearchParamBooleanState(
    searchParamName: string,
    {trueString = "true"}: {trueString?: string} = {},
): [value: boolean, setValue: (value: boolean) => void] {
    const [value, setValue] = useUrlSearchParamState(searchParamName);

    const booleanValue = value === trueString;

    const setBooleanValue = useCallback(
        (value: boolean) => {
            setValue(value ? trueString : null);
        },
        [setValue, trueString],
    );

    return [booleanValue, setBooleanValue];
}
