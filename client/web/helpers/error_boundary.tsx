import {Component, ReactNode} from "react";

export type ErrorBoundaryProps = {
    readonly fallback?:
        | ReactNode
        | ((props: {error: unknown; resetErrorBoundary: () => void}) => ReactNode);
    readonly children?: ReactNode;
};

export type ErrorBoundaryState = {
    readonly hasError: boolean;
    readonly error: unknown;
};

/**
 * Convenient component for creating React error boundaries. Currently you must use
 * a [class component][1] to create an error boundary. However, we use functional
 * components for basically everything in our product. This helper can be used if
 * you don't want to write a class component.
 *
 * [1]:
 *     https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    public override readonly state: ErrorBoundaryState = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: unknown) {
        return {hasError: true, error};
    }

    private readonly _resetErrorBoundary = () => {
        this.setState({
            hasError: false,
            error: null,
        });
    };

    public override render() {
        if (this.state.hasError) {
            if (typeof this.props.fallback !== "function") {
                return this.props.fallback;
            } else {
                return this.props.fallback({
                    error: this.state.error,
                    resetErrorBoundary: this._resetErrorBoundary,
                });
            }
        }

        return this.props.children;
    }
}
