import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/upload/test_helpers/test_file_processor_content_types.js";
import {setShouldDebugPdfPasswordErrorForTest} from "~/server/files/upload/upload_file.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileContentType} from "~/shared/files/file_content_type.js";

// TODO(calebmer, #files): Remove this test file once we figure out why the
// password test is flaky in CI.

setShouldDebugPdfPasswordErrorForTest();

const context = createTestContext();

const testCases: {
    [Key in FileContentType]?: FileProcessorContentTypeTestCase;
} = {
    "application/pdf": [
        {
            path: "py_pdf_sample_libreoffice_write_password.pdf",
            previewError: {
                code: ErrorCode.PermissionDenied,
                displayMessage: errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`,
            },
        },
    ],
};

beforeEach(() => {
    // eslint-disable-next-line no-console
    console.log("================================== START TEST ==================================");
});

describe("attempt 1", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 2", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 3", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 4", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 5", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 6", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 7", () => {
    testFileProcessorContentTypes(context, testCases);
});

describe("attempt 8", () => {
    testFileProcessorContentTypes(context, testCases);
});
