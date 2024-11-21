import {FileProcessorError} from "~/shared/files/file_processor_error.js";

const fileProcessorErrorByObject = new WeakMap<object, FileProcessorError>();

export function setFileProcessorError(object: object, error: FileProcessorError): void {
    fileProcessorErrorByObject.set(object, error);
}

export function getFileProcessorErrors(error: unknown): Array<FileProcessorError> {
    const processorErrors: Array<FileProcessorError> = [];

    const collectProcessorErrors = (error: unknown) => {
        const processorError =
            typeof error === "object" && error !== null
                ? fileProcessorErrorByObject.get(error)
                : undefined;

        if (processorError) {
            processorErrors.push(processorError);
        }

        if (error instanceof AggregateError) {
            for (const childError of error.errors) {
                collectProcessorErrors(childError);
            }
        }
    };

    collectProcessorErrors(error);

    return processorErrors;
}
