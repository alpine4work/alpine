import {
    FileUploadServiceContentTypeTestCase,
    testFileUploadServiceContentTypes,
} from "~/server/files/upload/test_helpers/test_file_upload_service_content_types.js";
import {FileMicrosoftOfficeDocumentContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
//
// Tests that depend on LibreOffice are in a separate file since developer
// machines may not have LibreOffice installed. So our developer testing tool
// `dev test` won't run this test file unless LibreOffice is installed. But
// `dev test` will run the rest of our content type tests.
const testCases: {
    [Key in FileMicrosoftOfficeDocumentContentType]: FileUploadServiceContentTypeTestCase;
} = {
    "application/msword": [
        {
            path: "file_examples_doc_100kb.doc",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_doc_100kb.pdf",
            },
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////39/f/9/f3///////////////////////////+IiIj/MTEx/+np6f//////xsbG///SAP//FgD/8vLy/+vr6///0gD//9IA//X19f8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_doc_100kb.avif",
            },
        },
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
        {
            path: "file_examples_docx_100kb.docx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_docx_100kb.pdf",
            },
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////39/f/9/f3///////j4+P////////////////9/f3//RUVF/+fn5////////9IA///SAP/DwsH///////8UAP//FAD/3t7e//////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_docx_100kb.avif",
            },
        },
    ],
    "application/vnd.ms-excel": [
        {
            path: "file_examples_xls_50_rows.xls",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_xls_50_rows.pdf",
            },
            previewSize: {width: 1024, height: 1080, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "8PDw/+Tk5P/j4+P/5eXl/+vr6//w8PD/5eXl/+bm5v/n5+f/6enp/+/v7//n5+f/6enp/+jo6P/p6en/8PDw/+bm5v/l5eX/5+fn/+np6f/x8fH/5ubm/+fn5//n5+f/6urq/w==",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_xls_50_rows.avif",
            },
        },
    ],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        {
            path: "file_examples_xlsx_50_rows.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_xlsx_50_rows.pdf",
            },
            previewSize: {width: 1022, height: 1080, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "7u7u/9/f3//h4eH/4uLi/+jo6P/t7e3/39/f/+Pj4//j4+P/5eXl/+zs7P/h4eH/5eXl/+Tk5P/l5eX/7e3t/+Li4v/h4eH/4+Pj/+fn5//u7u7/4ODg/+Li4v/i4uL/5ubm/w==",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_xlsx_50_rows.avif",
            },
        },
        {
            // Tests charts and multiple sheets.
            path: "calebmer_typing_speed_percentile_calculator.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_typing_speed_percentile_calculator.pdf",
            },
            previewSize: {width: 1440, height: 1080, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "8vLy//X19f/+/v7/9/f3//Hx8f/z8/P/9vb2///////+/v7///////X19f/39/f/+vv8//39/f/+/v7/9fb2//j39//5+vz//Pz///7+/v8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "calebmer_typing_speed_percentile_calculator.avif",
            },
        },
        {
            path: "calebmer_small_spreadsheet.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_small_spreadsheet.pdf",
            },
            previewSize: {width: 420, height: 94, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "9PT0//T09P/5+fn/9PT0//7+/v8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "calebmer_small_spreadsheet.avif",
            },
        },
    ],
    "application/vnd.ms-powerpoint": [
        {
            path: "file_examples_ppt_250kb.ppt",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_ppt_250kb.pdf",
            },
            previewSize: {width: 1588, height: 1190, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "09PT//Dw8P/19fX/8vPz/9DV1v/a2tr/9fX1//j4+P/19fX/2tra/9fX1//z8/P/9fX1//Pz8//X19f/t7e3/8/Pz//S0tL/z8/P/7e3t/8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_ppt_250kb.avif",
            },
        },
    ],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
        {
            path: "file_examples_ppt_250kb.pptx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_pptx_250kb.pdf",
            },
            previewSize: {width: 1588, height: 1190, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "09PT//Dw8P/19fX/8vPz/9DV1v/a2tr/9fX1//j4+P/19fX/2tra/9fX1//z8/P/9fX1//Pz8//X19f/t7e3/8/Pz//S0tL/z8/P/7e3t/8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "file_examples_pptx_250kb.avif",
            },
        },
        {
            path: "calebmer_basic_presentation.pptx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_basic_presentation.pdf",
            },
            previewSize: {width: 1440, height: 1080, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "////////////////////////////////8PDw/+fn5//29vb///////////////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "calebmer_basic_presentation.avif",
            },
        },
    ],
};

testFileUploadServiceContentTypes(testCases);
