import {ServerSessionActionContextModules} from "~/server/context/server_action_context.js";
import {
    finishUploadingAndStartProcessingFile,
    getFileAsUploader,
    startUploadingFile,
} from "~/server/files/data/files_actions.js";
import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import * as fileRpcDefinitions from "~/shared/rpc/files_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    RpcDefinition,
    RpcDefinitionInputType,
    RpcDefinitionOutputType,
} from "~/shared/rpc/rpc_definition.js";

export class TestUploadFileRpcContextModule extends RpcContextModuleBase<ServerSessionActionContextModules> {
    public async execute(
        definition: RpcDefinition<any, any>,
        callId: RpcCallId,
        anyInput: any,
    ): Promise<any> {
        if (definition === fileRpcDefinitions.startUploadingFile) {
            const input: RpcDefinitionInputType<typeof fileRpcDefinitions.startUploadingFile> =
                anyInput;

            const output = await startUploadingFile(this._context, {
                spaceId: input.spaceId,
                fileId: input.fileId,
                contentType: input.contentType,
                contentLength: input.contentLength,
            });

            return {
                fileId: output.fileId,
            } satisfies RpcDefinitionOutputType<typeof fileRpcDefinitions.startUploadingFile>;
        }

        if (definition === fileRpcDefinitions.finishUploadingAndStartProcessingFile) {
            const input: RpcDefinitionInputType<
                typeof fileRpcDefinitions.finishUploadingAndStartProcessingFile
            > = anyInput;

            const file = await finishUploadingAndStartProcessingFile(this._context, {
                spaceId: input.spaceId,
                fileId: input.fileId,
                validateContentLength: input.validateContentLength,
            });

            return {
                signedUrlSearch: "?sig=test",
                file,
            } satisfies RpcDefinitionOutputType<
                typeof fileRpcDefinitions.finishUploadingAndStartProcessingFile
            >;
        }

        if (definition === fileRpcDefinitions.getFileWithoutSignedUrlAsUploader) {
            const input: RpcDefinitionInputType<
                typeof fileRpcDefinitions.getFileWithoutSignedUrlAsUploader
            > = anyInput;

            const file = await getFileAsUploader(this._context, input.fileId);

            return {
                file,
            } satisfies RpcDefinitionOutputType<
                typeof fileRpcDefinitions.getFileWithoutSignedUrlAsUploader
            >;
        }

        throw new InternalError(
            quote`Unsupported RPC call for upload file tests: ${definition.name}`,
        );
    }

    public fork() {
        return new TestUploadFileRpcContextModule();
    }
}
