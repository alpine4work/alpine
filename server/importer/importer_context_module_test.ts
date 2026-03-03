import {
    ImporterContextModuleBase,
    PresignedUploadUrlResult,
} from "~/server/importer/importer_context_module_base.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Test importer context module that stores files in memory.
 *
 * This module is used in unit tests where filesystem access isn't available (e.g.,
 * in Bazel sandboxed tests).
 */
export class TestImporterContextModule extends ImporterContextModuleBase<{
    tracer: TracerContextModule;
    constants: ConstantsContextModule;
}> {
    private readonly _files = new Map<string, Uint8Array>();

    constructor() {
        super();
        assert(process.env.NODE_ENV === "test");
    }

    async createPresignedUploadUrl({
        importKey,
    }: {
        importKey: string;
        contentType: string;
        contentLength: number;
    }): Promise<PresignedUploadUrlResult> {
        const presignedUploadUrl = `https://test.cyberworlds.dev/dev/import-upload/${importKey}`;
        return {presignedUploadUrl, importKey};
    }

    async hasUploadedFile(importKey: string): Promise<boolean> {
        return this._files.has(importKey);
    }

    async readUploadedFile(importKey: string): Promise<Uint8Array | null> {
        return this._files.get(importKey) ?? null;
    }

    async deleteUploadedFile(importKey: string): Promise<void> {
        this._files.delete(importKey);
    }

    /**
     * Test helper to simulate a file being uploaded.
     */
    public setUploadedFile(importKey: string, data: Uint8Array): void {
        this._files.set(importKey, data);
    }

    fork(): TestImporterContextModule {
        const forked = new TestImporterContextModule();
        for (const [key, value] of this._files) {
            forked._files.set(key, value);
        }
        return forked;
    }
}
