import {ContextModuleBase} from "~/shared/context/context_module_base.js";

/**
 * A context module we use when rendering a React component.
 */
export class ReactContextModule extends ContextModuleBase {
    /**
     * Report an error rendered somewhere by React. We call this function with an
     * error a user actually sees.
     */
    public readonly reportRenderedError: (error: unknown) => void;

    constructor({reportRenderedError}: {reportRenderedError: (error: unknown) => void}) {
        super();
        this.reportRenderedError = reportRenderedError;
    }
}
