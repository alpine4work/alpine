import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/upload/test_helpers/test_file_processor_content_types.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    FileAudioContentType,
    FileContentType,
    FileMicrosoftOfficeDocumentContentType,
    FileVideoContentType,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in Exclude<
        FileContentType,
        FileMicrosoftOfficeDocumentContentType | FileVideoContentType | FileAudioContentType
    >]: FileProcessorContentTypeTestCase;
} = {
    "application/octet-stream": [
        {
            path: "random.bin",
        },
    ],
    "image/apng": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            imagePreviewSize: {width: 100, height: 100},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/avif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYy9bbz9jcztfbzdba1tnZ2tzd3+Pj4uTl3d7fuLSvtLKt0M7L0M3IsK2klaerlqqun7C1o7K1p7K0",
            ]),
        },
    ],
    "image/gif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.gif",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "x9TY/8vW2//O2Nv/ztfa/83W2v/W2dn/2Nzd/97j5f/i5OX/3d7f/7a0rv+0saz/0M7L/9DNyP+xrKX/laer/5aprf+fr7T/o7K1/6eytf8=",
            ]),
        },
        {
            path: "wikimedia_rotating_earth.gif",
            imagePreviewSize: {width: 400, height: 400},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AgEA/wMFEP8BAw//AAAA/wAAAf8AAAr/DhZM/3lwWf9HQSr/AgEC/wACCv8nLFX/o5xp/1ZTKv8AAAL/BAQA/wIDIv8HCyf/DhEF/wAABP8BAQL/AgEB/wQCBv8DAQT/AgED/w==",
            ]),
        },
    ],
    "image/jpeg": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "x9LXytXaztfbztfay9bY19rb3N/g3+Ll4OPm3+HhtrKssq+q0M3L0c3Jsaymna2vm62xp7a6qra6q7O0",
            ]),
        },
    ],
    "image/png": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.png",
            imagePreviewSize: {width: 336, height: 252},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpW8Jo1f6owN7k9fFq0WhFupv8Xj2bAsLxTYc9jkTinAOsTDQAAAADTXDYvy2hP8t1gYD0AAAAAAAAAAJ+/fwiltkw/jcY4CQAAAAA=",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            imagePreviewSize: {width: 100, height: 100},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/svg+xml": [
        {
            path: "undraw_landscape_photographer.svg",
            imagePreviewSize: {width: 732, height: 619},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "VVVVA2hWeVd3YrucAAAAAAAAAAAAAAAAaFz/DVZY/70AAAAAAAAAAAAAAAAAAAAALSxEowAAAAAAAAAAAAAAAAAAAABEO0+JAAAAAAAAAAA=",
            ]),
        },
        {
            path: "alpine_favicon_old.svg",
            imagePreviewSize: {width: 74, height: 74},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAMDAwpAAAAAAAAAAAAAAAACwsLQwsLDtAAAAADAAAAAAAAAAELCwy0CgoNZAoKDq0AAAABCQkNUAsLDocTExMNCgoNeAkJDVAKCg5hCwsOiAkJDWcREREPCgoOYQ==",
            ]),
        },
    ],
    "image/webp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.webp",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTXzdba0Njc0Njcztfa297e3uLj4uXl4uTl3+Hhr62nq6mjxsXDysfCp6Sdoa+yorK2qbm7rru9sru9",
            ]),
        },
    ],
    "image/bmp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.bmp",
            imagePreviewSize: {width: 250, height: 188},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                // We shrink the `.bmp` file since it's quite large so we have a special
                // `.bmp.avif` file to compare for similarity.
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.bmp.avif",
            },
        },
    ],
    "image/ico": [
        {
            path: "alpine_favicon_old.ico",
            imagePreviewSize: {width: 48, height: 48},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAFQwLCwsrAAAAAAAAAAIAAAAACQkMUgoKDdMAAAAGAAAAAAAAAAkLCw2XCgoOfQoKDaoAAAADDAwOagsLDqwAAAAACgoOjAsLDm0LCwttCwsNlwwMD1QJCQkbDAwMag==",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/png",
                similarPath: "alpine_favicon_old.png",
            },
        },
        {
            path: "stackoverflow_favicon.ico",
            imagePreviewSize: {width: 32, height: 32},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL9nsIHQAAAAAAAAABAAAAAP96AEn/dQCP/n8JHAAAAAD/egAb/3gAkP91AI3/fwAOf6/vEM2OYWb/cgB72otPanGq4huZqrsPo6CgZ6udlFmiop9gn5+qGA==",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/png",
                similarPath: "stackoverflow_favicon.png",
            },
        },
        {
            path: "stackoverflow_favicon.png.ico",
            imagePreviewSize: {width: 32, height: 32},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL/3cIHgAAAAAAAAAAAAAAAP93AE3/eACO9X8JHAAAAAD+fwAc/3UAhP9zAIf/eAARX6//EMqRZGv/eACb1YlRekTM/w+WpaURoaGhWqWenkecoqVTnZ2dFQ==",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/png",
                similarPath: "stackoverflow_favicon.png",
            },
        },
    ],
    "image/tiff": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.tiff",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.tiff",
            imagePreviewSize: {width: 336, height: 252},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpX8Jo1f6owN7Q9fFq0WhFupv8Xj2bAsLxTYc9kjzanAOsTDQAAAADTXDYvymlP8t1gYD0AAAAAAAAAAJ+/fwilskQ/japVCQAAAAA=",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_png_transparency_demonstration.avif",
            },
        },
    ],
    "image/heif": [
        {
            path: "filesampleshub_heif_sample1.heif",
            imagePreviewSize: {width: 640, height: 426},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "udnfm7i+hZ+ki7fChdTrxbafTR8QVyoZglxHfnlzyZBivoFT3J5p7qdq4ZVY",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "filesampleshub_heif_sample1.avif",
            },
        },
    ],
    "image/heic": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.heic",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "iphone_calebmer_colorado_twin_lakes.heic",
            imagePreviewSize: {width: 480, height: 640},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                4,
                "R4zOX5TLVoa7dpW+farYor3ikrLafqTRfZu2cZKsVHyfP2+YUG5/QWd2GEdWHEZTW3+MV3+KM2RvGFRi",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "iphone_calebmer_colorado_twin_lakes.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.heic",
            imagePreviewSize: {width: 336, height: 252},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "XFy5IUNMzZo1aoowOZo5fEuWSxFYkP8XfFypsKNMWM9aezWnAJwTDQAAAACtSzAvs19J8sRbVz0AAAAAAAAAAH9/XwiNlTw/jY1VCQAAAAA=",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                // When using the Apple Preview app to export
                // `wikimedia_png_transparency_demonstration.png` the colors got darker,
                // especially around the edges. So we can't compare to the original `.png`
                // image. Instead we re-exported the darker `.heic` file to `.png` and we'll
                // use that as the similar image. This does not appear to be an issue with our
                // code but rather the Apple Preview app's export functionality.
                similarPath: "wikimedia_png_transparency_demonstration.heic.avif",
            },
        },
    ],
    "application/pdf": [
        {
            path: "iup_pdf_testpage.pdf",
            imagePreviewSize: {width: 1224, height: 1584, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "8gAA/+sAAP/7+/v//////8YAAv++AAD///////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "iup_pdf_testpage.avif",
            },
        },
        {
            path: "py_pdf_sample_google_doc_document.pdf",
            imagePreviewSize: {width: 1192, height: 1684, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////+5tIj/2dnT//39/f/8/Pz/trqF/7W8gv8FBQX/AAAA/wAAAP8FBQT/ODg4/w0NDf8ODg7/QkJC/5OTk/+ioqL///////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_google_doc_document.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_form.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "JSUl/wcHB/9DQ0P//////wAAAP/X19f/mpqa//////80NDT/R0dH//Hx8f////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_libreoffice_form.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_write_password.pdf",
            previewError: {
                code: ErrorCode.PermissionDenied,
                displayMessage: errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`,
            },
        },
        {
            path: "py_pdf_sample_multicolumn.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_multicolumn.avif",
            },
        },
        {
            path: "py_pdf_sample_pdflatex_outline.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_pdflatex_outline.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.pdf",
            imagePreviewSize: {width: 672, height: 504, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "7u77/46R7f/i6u//l9SZ//r9+v/39/3/tpzS/9eAhf+buYP/9fv1///////25eL/zXJi//Xb2P////////////7+/v/h4r7//f38//////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                // The PDF preview:
                //
                // 1. Removes the transparent background and replaces it with a white
                //    background
                // 2. Is twice as large as `wikimedia_png_transparency_demonstration.avif`
                //
                // TODO(calebmer): Ideally we would preserve the transparent background. Vips
                // can do this but [`sharp` doesn't expose the option we need][1].
                //
                // [1]: https://github.com/lovell/sharp/issues/3321
                similarPath: "wikimedia_png_transparency_demonstration.pdf.avif",
            },
        },
        {
            path: "pdfsharp_sample_page_sizes.pdf",
            imagePreviewSize: {width: 4760, height: 6736, scale: 2},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "pdfsharp_sample_page_sizes.avif",
            },
            // Needs higher tolerance probably because this file is much bigger than others
            // we test so there's more space for there to be mismatches.
            looksSameTolerance: 70,
        },
    ],
};

testFileProcessorContentTypes(testCases);
