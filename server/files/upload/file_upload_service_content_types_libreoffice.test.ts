import {
    FileLibreofficeContentType,
    FileUploadServiceContentTypeTestCase,
    testFileUploadServiceContentTypes,
} from "~/server/files/upload/test_helpers/test_file_upload_service_content_types.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
//
// Tests that depend on LibreOffice are in a separate file since developer
// machines may not have LibreOffice installed. So our developer testing tool
// `dev test` won't run this test file unless LibreOffice is installed. But
// `dev test` will run the rest of our content type tests.
const testCases: {
    [Key in FileLibreofficeContentType]: FileUploadServiceContentTypeTestCase;
} = {
    "application/msword": [
        {
            path: "file_examples_doc_100kb.doc",
            contentLength: 100352,
            alternative: {
                contentType: "application/pdf",
                contentLength: 155144,
            },
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////39/f/9/f3///////////////////////////+IiIj/MTEx/+np6f//////xsbG///SAP//FgD/8vLy/+vr6///0gD//9IA//X19f8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 93170,
                similarPath: "file_examples_doc_100kb.avif",
            },
        },
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
        {
            path: "file_examples_docx_100kb.docx",
            contentLength: 111303,
            alternative: {
                contentType: "application/pdf",
                contentLength: 179336,
            },
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////39/f/9/f3///////j4+P////////////////9/f3//RUVF/+fn5////////9IA///SAP/DwsH///////8UAP//FAD/3t7e//////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 93195,
                similarPath: "file_examples_docx_100kb.avif",
            },
        },
    ],
};

testFileUploadServiceContentTypes(testCases);
