import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

/**
 * A context module we use when rendering a React component.
 */
export class ReactContextModule extends ContextModuleBase<{tracer: TracerContextModule}> {
    /**
     * Report an error rendered somewhere by React. We call this function with an error
     * a user actually sees.
     */
    private readonly _reportRenderedError: (tracer: TracerBase, error: unknown) => void;

    constructor({
        reportRenderedError,
    }: {
        reportRenderedError: (tracer: TracerBase, error: unknown) => void;
    }) {
        super();
        this._reportRenderedError = reportRenderedError;
    }

    public reportRenderedError(error: unknown) {
        this._reportRenderedError(this._context.tracer.getTracer(), error);
    }

    public static newForClient() {
        return new ReactContextModule({
            reportRenderedError: (tracer, error) => {
                // Log after a microtask so we don't get the React component trace in the error
                // log. The trace will always point to our error message renderer which isn't
                // useful.
                scheduleMicrotask(() => {
                    tracer.getRoot().logException("Rendered error", error);
                });
            },
        });
    }
}
