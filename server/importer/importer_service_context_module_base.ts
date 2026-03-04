import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";

/**
 * Base class for importer service context modules.
 *
 * This defines the interface that both production (`ImporterServiceContextModule`)
 * and development (`ImporterServiceDevelopmentContextModule`) implementations must
 * provide for reading uploaded import files.
 *
 * Note: This base class is in `//server/importer` to avoid circular dependencies.
 * The production implementation is in `//server/importer/importer_service`.
 */
export abstract class ImporterServiceContextModuleBase extends ContextModuleBase {
    /**
     * Reads an uploaded import file.
     */
    abstract readUploadedFile(importKey: string): Promise<Uint8Array | null>;

    abstract fork(): ForkableContextModuleBase;
}
