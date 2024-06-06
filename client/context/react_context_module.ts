import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * A context module we use when rendering a React component.
 */
export class ReactContextModule extends ContextModuleBase<{tracer: TracerContextModule}> {
    /**
     * Report an error rendered somewhere by React. We call this function with an
     * error a user actually sees.
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
}
