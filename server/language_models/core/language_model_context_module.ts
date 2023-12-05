import {LanguageModelBase} from "~/server/language_models/core/language_model_base.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";

export class LanguageModelContextModule extends ContextModuleBase {
    public readonly model: LanguageModelBase;

    constructor(model: LanguageModelBase) {
        super();
        this.model = model;
    }
}
