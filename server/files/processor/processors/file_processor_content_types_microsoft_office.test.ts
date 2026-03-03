import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/processor/test_helpers/test_file_processor_content_types.js";
import {FileMicrosoftOfficeDocumentContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";

const context = createTestContext();

// Use TypeScript to make sure we have at least one file as a test case for each of
// the `FileContentType`s we support.
//
// Tests that depend on LibreOffice are in a separate file since developer machines
// may not have LibreOffice installed. So our developer testing tool `dev test`
// won't run this test file unless LibreOffice is installed. But `dev test` will
// run the rest of our content type tests.
const testCases: {
    [Key in FileMicrosoftOfficeDocumentContentType]: FileProcessorContentTypeTestCase;
} = {
    "application/msword": [
        {
            path: "file_examples_doc_100kb.doc",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_doc_100kb.pdf",
            },
            imagePreviewSize: {width: 1190, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////v7+//4+Pj//f39////////////////////////////////////////////////////////////vLy8/y0tLf+JiYn////////////W1tb/tLS0/7S0tP/Gxsb///////j4+P//0gD//9IA///RAP///////////8jIyP+9vb3/1tbW//////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_doc_100kb.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
        {
            path: "file_examples_docx_100kb.docx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_docx_100kb.pdf",
            },
            imagePreviewSize: {width: 1190, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////v7+//4+Pj//f39//////////////////////////////////b29v/9/f3/////////////////qamp/xkZGf96enr///////////+0tLT/srKy/7Ozs//8/Pz///////8UAP//0gD//9EA//n5+f//////6Ojo/9DQ0P/e3t7///////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_docx_100kb.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
    "application/vnd.ms-excel": [
        {
            path: "file_examples_xls_50_rows.xls",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_xls_50_rows.pdf",
            },
            imagePreviewSize: {width: 1024, height: 1080, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "8PDw/+Tk5P/j4+P/5eXl/+vr6//w8PD/5eXl/+bm5v/n5+f/6enp/+/v7//n5+f/6enp/+jo6P/p6en/8PDw/+bm5v/l5eX/5+fn/+np6f/x8fH/5ubm/+fn5//n5+f/6urq/w==",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_xls_50_rows.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        {
            path: "file_examples_xlsx_50_rows.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_xlsx_50_rows.pdf",
            },
            imagePreviewSize: {width: 1022, height: 1080, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "7u7u/9/f3//h4eH/4uLi/+jo6P/t7e3/39/f/+Pj4//j4+P/5eXl/+zs7P/h4eH/5eXl/+Tk5P/l5eX/7e3t/+Li4v/h4eH/4+Pj/+fn5//u7u7/4ODg/+Li4v/i4uL/5ubm/w==",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_xlsx_50_rows.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
        {
            // Tests charts and multiple sheets.
            path: "calebmer_typing_speed_percentile_calculator.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_typing_speed_percentile_calculator.pdf",
            },
            imagePreviewSize: {width: 1440, height: 1080, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "+fn5/+zs7P/6+vr//Pz8//n5+f/v7+//8/Pz//r6+v/q6ur/+/v7/////////////v7+//7+/v/7+/v/8PDw//r6+v/+/v7//v7///7+/v/+/v7/+vr6//Hx8f/6+vn/9/j7//z9/v/+/v7//v7+//r6+v/x8fH/+vr6//j6/P/7/P///v7+//3+/v8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "calebmer_typing_speed_percentile_calculator.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
        {
            path: "calebmer_small_spreadsheet.xlsx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_small_spreadsheet.pdf",
            },
            imagePreviewSize: {width: 420, height: 94, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                16,
                "/v7+///////+/v7//////9HR0f/c3Nz//////////////////v7+///////x8fH/09PT//r6+v////////////7+/v/////////////////g4OD/5ubm//////////////////7+/v//////9fX1/+Dg4P/6+vr////////////+/v7///////7+/v//////zMzM/8vLy//////////////////+/v7///////Ly8v/FxcX/7+/v///////+/v7//v7+/////////////////97e3v/c3Nz//////////////////v7+///////19fX/2NjY//X19f///////v7+//7+/v///////v7+///////Z2dn/19fX//////////////////7+/v//////9PT0/9TU1P/z8/P///////7+/v8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "calebmer_small_spreadsheet.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
    "application/vnd.ms-powerpoint": [
        {
            path: "file_examples_ppt_250kb.ppt",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_ppt_250kb.pdf",
            },
            imagePreviewSize: {width: 1588, height: 1190, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "wMS7/97h2f/u8ur/7/Pr/+7y6v/X6eP/x8rI/9HR0f/z8/P/9vb2//f39//29vb/8/Pz/9DQ0P/Q0ND/8/Pz//b29v/39/f/9vb2//Pz8//Q0ND/zMzM/+/v7//z8/P/9fX1//T09P/v7+//zMzM/6urq//FxcX/ysrK/8zMzP/Kysr/xcXF/6urq/8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_ppt_250kb.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
        {
            path: "file_examples_ppt_250kb.pptx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "file_examples_pptx_250kb.pdf",
            },
            imagePreviewSize: {width: 1588, height: 1190, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "wMS7/97h2f/u8ur/7/Pr/+7y6v/X6eP/x8rI/9HR0f/z8/P/9vb2//f39//29vb/8/Pz/9DQ0P/Q0ND/8/Pz//b29v/39/f/9vb2//Pz8//Q0ND/zMzM/+/v7//z8/P/9fX1//T09P/v7+//zMzM/6urq//FxcX/ysrK/8zMzP/Kysr/xcXF/6urq/8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "file_examples_pptx_250kb.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
        {
            path: "calebmer_basic_presentation.pptx",
            alternative: {
                contentType: "application/pdf",
                similarPath: "calebmer_basic_presentation.pdf",
            },
            imagePreviewSize: {width: 1440, height: 1080, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "/////////////////////////////////////////////////////////////////////////////////Pz8/+fn5//g4OD/6+vr//////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "calebmer_basic_presentation.avif",
            },
            // LibreOffice may generate files with meaningful differences between MacOS and
            // Linux due to platform differences. For example, differences in font rendering.
            // So use a generous tolerance.
            looksSameTolerance: 120,
        },
    ],
};

testFileProcessorContentTypes(context, testCases);
