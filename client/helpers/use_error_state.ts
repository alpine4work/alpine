import {Memo, useCallback, useState} from "react";

type ErrorState = {readonly hasError: false} | {readonly hasError: true; readonly error: unknown};

const initialErrorState: ErrorState = {hasError: false};

/**
 * Basic error handling state. If you call the returned `setErrorState()`
 * function then the component will start throwing an error that's caught at
 * the nearest error boundary.
 */
export function useErrorState(): Memo<(error: unknown) => void> {
    const [errorState, setErrorState] = useState(initialErrorState);

    if (errorState.hasError) throw errorState.error;

    return useCallback(error => setErrorState({hasError: true, error}), []);
}
