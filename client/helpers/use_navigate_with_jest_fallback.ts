import {Memo} from "react";
import {NavigateOptions, To, useNavigate} from "react-router-dom";
import {UnimplementedError} from "~/shared/error/error";

const unsupportedNavigate = (to: To, options?: NavigateOptions): void => {
    throw new UnimplementedError("Can't navigate in Jest unit tests without a <Router> component");
};

/**
 * The `useNavigate()` hook from `react-router-dom` but with a fallback for
 * Jest unit tests. The fallback throws an error. If you would like to unit
 * test navigation you should render your component inside a `<Router>`
 * component.
 */
export function useNavigateWithJestFallback(): Memo<(to: To, options?: NavigateOptions) => void> {
    try {
        return useNavigate() as Memo<(to: To, options?: NavigateOptions) => void>;
    } catch (error) {
        if (
            typeof jest !== "undefined" &&
            error instanceof Error &&
            error.message.includes(
                "useNavigate() may be used only in the context of a <Router> component",
            )
        ) {
            return unsupportedNavigate as Memo<(to: To, options?: NavigateOptions) => void>;
        }
        throw error;
    }
}
