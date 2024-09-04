import {
    FileLibreofficeContentType,
    FileUploadServiceContentTypeTestCase,
    testFileUploadServiceContentTypes,
} from "~/server/files/upload/test_helpers/test_file_upload_service_content_types.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in Exclude<
        FileContentType,
        FileLibreofficeContentType
    >]: FileUploadServiceContentTypeTestCase;
} = {
    "application/octet-stream": [
        {
            path: "random.bin",
            contentLength: 5000,
        },
    ],
    "image/apng": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            previewSize: {width: 100, height: 100},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/avif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            contentLength: 3704,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYy9bbz9jcztfbzdba1tnZ2tzd3+Pj4uTl3d7fuLSvtLKt0M7L0M3IsK2klaerlqqun7C1o7K1p7K0",
            ]),
        },
    ],
    "image/gif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.gif",
            contentLength: 64718,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "x9TY/8vW2//O2Nv/ztfa/83W2v/W2dn/2Nzd/97j5f/i5OX/3d7f/7a0rv+0saz/0M7L/9DNyP+xrKX/laer/5aprf+fr7T/o7K1/6eytf8=",
            ]),
        },
        {
            path: "wikimedia_rotating_earth.gif",
            contentLength: 118405,
            previewSize: {width: 400, height: 400},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AgEA/wMFEP8BAw//AAAA/wAAAf8AAAr/DhZM/3lwWf9HQSr/AgEC/wACCv8nLFX/o5xp/1ZTKv8AAAL/BAQA/wIDIv8HCyf/DhEF/wAABP8BAQL/AgEB/wQCBv8DAQT/AgED/w==",
            ]),
        },
    ],
    "image/jpeg": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            contentLength: 33102,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "x9LXytXaztfbztfay9bY19rb3N/g3+Ll4OPm3+HhtrKssq+q0M3L0c3Jsaymna2vm62xp7a6qra6q7O0",
            ]),
        },
    ],
    "image/png": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.png",
            contentLength: 76547,
            previewSize: {width: 336, height: 252},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpW8Jo1f6owN7k9fFq0WhFupv8Xj2bAsLxTYc9jkTinAOsTDQAAAADTXDYvy2hP8t1gYD0AAAAAAAAAAJ+/fwiltkw/jcY4CQAAAAA=",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            previewSize: {width: 100, height: 100},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/svg+xml": [
        {
            path: "undraw_landscape_photographer.svg",
            contentLength: 4701,
            previewSize: {width: 732, height: 619},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "VVVVA2hWeVd3YrucAAAAAAAAAAAAAAAAaFz/DVZY/70AAAAAAAAAAAAAAAAAAAAALSxEowAAAAAAAAAAAAAAAAAAAABEO0+JAAAAAAAAAAA=",
            ]),
        },
        {
            path: "alpine_favicon_old.svg",
            contentLength: 594,
            previewSize: {width: 74, height: 74},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAMDAwpAAAAAAAAAAAAAAAACwsLQwsLDtAAAAADAAAAAAAAAAELCwy0CgoNZAoKDq0AAAABCQkNUAsLDocTExMNCgoNeAkJDVAKCg5hCwsOiAkJDWcREREPCgoOYQ==",
            ]),
        },
    ],
    "image/webp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.webp",
            contentLength: 60260,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTXzdba0Njc0Njcztfa297e3uLj4uXl4uTl3+Hhr62nq6mjxsXDysfCp6Sdoa+yorK2qbm7rru9sru9",
            ]),
        },
    ],
    "image/bmp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.bmp",
            contentLength: 141432,
            previewSize: {width: 250, height: 188},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 7638,
                // We shrink the `.bmp` file since it's quite large so we have a special
                // `.bmp.avif` file to compare for similarity.
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.bmp.avif",
            },
        },
    ],
    "image/ico": [
        {
            path: "alpine_favicon_old.ico",
            contentLength: 15086,
            previewSize: {width: 48, height: 48},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAFQwLCwsrAAAAAAAAAAIAAAAACQkMUgoKDdMAAAAGAAAAAAAAAAkLCw2XCgoOfQoKDaoAAAADDAwOagsLDqwAAAAACgoOjAsLDm0LCwttCwsNlwwMD1QJCQkbDAwMag==",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/png",
                contentLength: 843,
                similarPath: "alpine_favicon_old.png",
            },
        },
        {
            path: "stackoverflow_favicon.ico",
            contentLength: 5430,
            previewSize: {width: 32, height: 32},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL9nsIHQAAAAAAAAABAAAAAP96AEn/dQCP/n8JHAAAAAD/egAb/3gAkP91AI3/fwAOf6/vEM2OYWb/cgB72otPanGq4huZqrsPo6CgZ6udlFmiop9gn5+qGA==",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/png",
                contentLength: 632,
                similarPath: "stackoverflow_favicon.png",
            },
        },
        {
            path: "stackoverflow_favicon.png.ico",
            contentLength: 1264,
            previewSize: {width: 32, height: 32},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL/3cIHgAAAAAAAAAAAAAAAP93AE3/eACO9X8JHAAAAAD+fwAc/3UAhP9zAIf/eAARX6//EMqRZGv/eACb1YlRekTM/w+WpaURoaGhWqWenkecoqVTnZ2dFQ==",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/png",
                contentLength: 819,
                similarPath: "stackoverflow_favicon.png",
            },
        },
    ],
    "image/tiff": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.tiff",
            contentLength: 118764,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 20082,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.tiff",
            contentLength: 107676,
            previewSize: {width: 336, height: 252},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpX8Jo1f6owN7Q9fFq0WhFupv8Xj2bAsLxTYc9kjzanAOsTDQAAAADTXDYvymlP8t1gYD0AAAAAAAAAAJ+/fwilskQ/japVCQAAAAA=",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 29508,
                similarPath: "wikimedia_png_transparency_demonstration.avif",
            },
        },
    ],
    "image/heif": [
        {
            path: "filesampleshub_heif_sample1.heif",
            contentLength: 42984,
            previewSize: {width: 640, height: 426},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "udnfm7i+hZ+ki7fChdTrxbafTR8QVyoZglxHfnlzyZBivoFT3J5p7qdq4ZVY",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 93447,
                similarPath: "filesampleshub_heif_sample1.avif",
            },
        },
    ],
    "image/heic": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.heic",
            contentLength: 36233,
            previewSize: {width: 500, height: 375},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 20246,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "iphone_calebmer_colorado_twin_lakes.heic",
            contentLength: 88109,
            previewSize: {width: 480, height: 640},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                4,
                "R4zOX5TLVoa7dpW+farYor3ikrLafqTRfZu2cZKsVHyfP2+YUG5/QWd2GEdWHEZTW3+MV3+KM2RvGFRi",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 91235,
                similarPath: "iphone_calebmer_colorado_twin_lakes.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.heic",
            contentLength: 16960,
            previewSize: {width: 336, height: 252},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "XFy5IUNMzZo1aoowOZo5fEuWSxFYkP8XfFypsKNMWM9aezWnAJwTDQAAAACtSzAvs19J8sRbVz0AAAAAAAAAAH9/XwiNlTw/jY1VCQAAAAA=",
            ]),
            isPreviewImageAlternative: true,
            previewImage: {
                contentType: "image/avif",
                contentLength: 25424,
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
            contentLength: 67840,
            previewSize: {width: 1224, height: 1584, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "8gAA/+sAAP/7+/v//////8YAAv++AAD///////////////////////////////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 34554,
                similarPath: "iup_pdf_testpage.avif",
            },
        },
        {
            path: "py_pdf_sample_google_doc_document.pdf",
            contentLength: 80100,
            previewSize: {width: 1192, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////+5tIj/2dnT//39/f/8/Pz/trqF/7W8gv8FBQX/AAAA/wAAAP8FBQT/ODg4/w0NDf8ODg7/QkJC/5OTk/+ioqL///////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 79284,
                similarPath: "py_pdf_sample_google_doc_document.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_form.pdf",
            contentLength: 34186,
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "JSUl/wcHB/9DQ0P//////wAAAP/X19f/mpqa//////80NDT/R0dH//Hx8f////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 11172,
                similarPath: "py_pdf_sample_libreoffice_form.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_write_password.pdf",
            contentLength: 12783,
            previewError: {
                code: ErrorCode.PermissionDenied,
                displayMessage: errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`,
            },
        },
        {
            path: "py_pdf_sample_multicolumn.pdf",
            contentLength: 78657,
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 182019,
                similarPath: "py_pdf_sample_multicolumn.avif",
            },
        },
        {
            path: "py_pdf_sample_pdflatex_outline.pdf",
            contentLength: 48722,
            previewSize: {width: 1190, height: 1684, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 6148,
                similarPath: "py_pdf_sample_pdflatex_outline.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.pdf",
            contentLength: 82860,
            previewSize: {width: 672, height: 504, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "7u77/46R7f/i6u//l9SZ//r9+v/39/3/tpzS/9eAhf+buYP/9fv1///////25eL/zXJi//Xb2P////////////7+/v/h4r7//f38//////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 11253,
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
            contentLength: 40069,
            previewSize: {width: 4760, height: 6736, scale: 2},
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            previewImage: {
                contentType: "image/avif",
                contentLength: 1453,
                similarPath: "pdfsharp_sample_page_sizes.avif",
            },
            // Needs higher tolerance probably because this file is much bigger than others
            // we test so there's more space for there to be mismatches.
            looksSameTolerance: 70,
        },
    ],
};

testFileUploadServiceContentTypes(testCases);
