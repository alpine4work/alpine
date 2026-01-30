import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/processor/test_helpers/test_file_processor_content_types.js";
import {
    FileAudioContentType,
    FileCodeContentType,
    FileContentType,
    FileMicrosoftOfficeDocumentContentType,
    FileVideoContentType,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";

const context = createTestContext();

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in Exclude<
        FileContentType,
        | FileMicrosoftOfficeDocumentContentType
        | FileVideoContentType
        | FileAudioContentType
        | Exclude<FileCodeContentType, "text/plain" | "text/x-haskell" | "text/x-java">
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
                7,
                "xNDUx9LWy9TYzdbaztfazdbYy9TX2N7g3ePl3+Xo3+Xn3+Pm4OTn3+Pmy8rEwr+6y8jH2tnY4eHd0M7LxcS/trWwo6KdtLKux8TDysjEtLGroJ2Vna2xma2ynrK3ora5p7a6rbu+sLu9",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            imagePreviewSize: {width: 100, height: 100, hasAlpha: true},
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
                7,
                "xNDUx9LVy9TYzdbaztfazdXZy9TY2N7g3ePm3+Xo3+Xn3+Pm4OXo3+Tmy8rEwr+7y8jH2trZ4eHe0M/LxcTAtrWwo6Kds7OuxcTDysjEtLGsop2Vna2xm62ynrK3ora7p7a6rbu+sLu9",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.avif",
            imagePreviewSize: {width: 336, height: 252, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "AAAAAEpT3m48UPGUALm5CyuzO4BQuVNJAAAAAAAAAAB1f+iedlzL6stdapRYlDfiFrAxewAAAAAAAAABAAAAAM9NVIvbTVX/0FdXlQAAAAD/AP8BqqpVAwAAAADDfVdJu3xO9M6FVVQAAAAAqqpVAwAAAAAAAAAAublFC5zAQkGJxDoNAAAAAAAAAAA=",
            ]),
        },
        {
            path: "cooksmarts_guide_to_stir_frying.avif",
            imagePreviewSize: {width: 400, height: 4778, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "50wt/+hYO//WPiH/yTYb/804G//USC7/2l9D/9ZVOv/YX0b/zkEl/9R4Zf/Qdmb/z3hm/8JqWf/bfWv/5+vp/+Xn5v/p4OL/3+Hg/+ju7P/q5N7/7eXg//Pd2P/u6un/6efl/+jRzv/r19T/7O7r/+Lazf/cz7j/5dDN/+ja2P/o7fb/5tjA/+TLof/l5+j/3N/i/9zc3f/b4ef/6u/3/8q7tP/R1tr/8PHz/9S3sf/g1dT/4N/f/9TU1f/Z2t7/6uTk//Hv7//s6+7/3dze/9HNxf/r7Oz//P3+/9fo4P/b5eL/8+vc/+Tf1v/q6+7/",
            ]),
        },
        {
            path: "cooksmarts_guide_to_stir_frying_rotated.avif",
            imagePreviewSize: {width: 4778, height: 400, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                16,
                "6enq/+fp6P/c6eX/4uHd/9LPwP/q6u7/4eHk/+Dg4//g4OP/4uLl/+Hh5P/h4eT/3d3d/+np6v/HxsT/3dzd/+bl5f/f5N7/wtvS/9TTyP+8t5T/4ODm/+rq7v/n5+v/6ent/+Tk5//p6e3/5ufq/+fn5//p6ez/3tfV/+Hg5P/o4+D/5eTc/9Tm1v/e3eL/4+Tu/+np7P/i4d3/4ODe/+Lh3v/f4d//5uXl/+Xk4//19fb/7Ozu/9jX2v/l5un/8+Xj/+XY0v/V6uL/7Ovf/9XZnP/29v7/w7+g/7m5oP+9wKr/ucav/9DNwv/OyLz/9fX5/+bm6v/MvbP/29bX//Ps7P/o5OL/3Ozo/+7x6P/H4LX/9vX5/+Tj3//l5eP/5uXi/+fm5f/o5+f/6efm//X19//w8PL/4NnW/+Lh5P8=",
            ]),
        },
    ],
    "image/gif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.gif",
            imagePreviewSize: {width: 500, height: 375, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "xNDU/8jR1v/K1Nj/zdfa/87W2v/L1dn/y9TY/9je4P/c4uX/3+Xo/9/k5//f4+b/4OTn/9/j5v/LysT/wr+6/8rJx//Z2tj/4eHd/9DOy//FxL//trWw/6Oinf+zsq7/xcXD/8nIxP+0sav/oJ2V/52tsf+ZrbL/nrK3/6O0uf+ntrr/rbu+/6+7vv8=",
            ]),
        },
        {
            path: "wikimedia_rotating_earth.gif",
            imagePreviewSize: {width: 400, height: 400, hasAlpha: true},
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
                7,
                "xNDVx9TXytTYzdbaztfbzdbYy9TY2N7g3ePm3+Xo3+Xn3uPm3+Tn3+TmzczGxcLAzczK29rZ4+Lf1dPRysnFtbOvoJ+ZsrCtxcXDy8rFtrGrn5uTpbS2orK2p7e9qru+rbu/tL7CtL2+",
            ]),
        },
    ],
    "image/png": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                7,
                "xNDUx9LWy9TYzdbaztfazdbYy9TX2N7g3ePl3+Xo3+Xn3+Pm4OTn3+Pmy8rEwr+6y8jH2tnY4eHd0M7LxcS/trWwo6KdtLKux8TDysjEtLGroJ2Vna2xma2ynrK3ora5p7a6rbu+sLu9",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.png",
            imagePreviewSize: {width: 336, height: 252, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "AAAAAEpU4G08UPGUALm5CyuzO4BQuVNJAAAAAAAAAAB1f+iedl3K6s1eapRZljfiFrAzewAAAAAAAAABAAAAAM9NVIvbTVX/0FdYlQAAAAD/AP8BqqpVAwAAAADDgVdJu31O9M6FW1QAAAAAqqpVAwAAAAAAAAAAudBFC6TAQkGcxDoNAAAAAAAAAAA=",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            imagePreviewSize: {width: 100, height: 100, hasAlpha: true},
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
            imagePreviewSize: {width: 732, height: 619, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                6,
                "AAAAAFpNaFuJZYGdf2POKAAAAAAAAAAAAAAAAP///wFoYv+tXV7/mgAAAAAAAAAAAAAAAAAAAAA7PINoPTuAlwAAAAAAAAAAAAAAAAAAAAAsLEJULS1GfwAAAAAAAAAAPj9SEDs8YBFFO1NZTzxUgTs8YBE+P1IQ",
            ]),
        },
        {
            path: "alpine_favicon_old.svg",
            imagePreviewSize: {width: 74, height: 74, hasAlpha: true},
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
                7,
                "xNDUx9LWy9TYzdbazdfazdXZy9TX2d/i3ePm4OXo4OXo3+Pm4OTn3uPlysnDwL65ysnF2dnY4N/d0dDOx8bCt7WypKOds7KuxcXDy8rHtLCrn5uUna2xm620nrK3ora5pLa5rLm9r7u8",
            ]),
        },
    ],
    "image/bmp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.bmp",
            imagePreviewSize: {width: 250, height: 188},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                7,
                "xNDUx9LWy9TYzdbazdfazdXZy9TX2d/i3ePm4OXo4OXo3+Pm4OTn3uPlysnDwL65ysnF2dnY4N/d0dDOx8bCt7WypKOds7KuxcXDy8rHtLCrn5uUna2xm620nrK3ora5pLa5rLm9r7u8",
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
            imagePreviewSize: {width: 48, height: 48, hasAlpha: true},
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
            imagePreviewSize: {width: 32, height: 32, hasAlpha: true},
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
            imagePreviewSize: {width: 32, height: 32, hasAlpha: true},
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
                7,
                "xNDUx9LWy9TYzdbaztfazdbYy9TX2N7g3ePl3+Xo3+Xn3+Pm4OTn3+Pmy8rEwr+6y8jH2tnY4eHd0M7LxcS/trWwo6KdtLKux8TDysjEtLGroJ2Vna2xma2ynrK3ora5p7a6rbu+sLu9",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.tiff",
            imagePreviewSize: {width: 336, height: 252, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "AAAAAEpU4G04UO+UALm5CyuzO4BQuVNJAAAAAAAAAAB1f+iedlzL6steapRYlDfiErAxewAAAAAAAAABAAAAAM9NVIvbTVX/0FdYlQAAAAD/AP8BqqpVAwAAAADDfVdJu3xO9M6FVVQAAAAAqqpVAwAAAAAAAAAAublFC5zAQkGJxDoNAAAAAAAAAAA=",
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
                8,
                "sNDYq9PeqNvpoNzrkM3cgsvddcPbY7jWyeDeu9LQg4J9c3BshIF7k5+dn9zplt7u6vXfjHBdOgIANwIAVCoedUIsZ1ZPam5u5rKCqGA0iE4sn25KxIhZ1JJdxoBNxH9LxJRt2qV39LZ++7l9/LZ5+7R2/bV276hr",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "filesampleshub_heif_sample1.avif",
            },
        },
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.heic",
            imagePreviewSize: {width: 500, height: 375},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                7,
                "xNDUx9LWy9TYzdbaztfazdbYy9TY2N7g3eLl3+Xo3+Xn3+Pm4OTn3+Pmy8rEwr+6ysnH2dnZ4eHe0M7LxcTAtrWwo6Kds7KuxcTDysjEtLGroJ2Vna2xma2ynrK3ora5p7a6rbu+sLu9",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "calebmer_iphone_colorado_twin_lakes.heic",
            imagePreviewSize: {width: 480, height: 640},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "RI3SRIjIOni5aJPEbI67UY7KlLbdhafPXoq9jajKh7HakbLZpL3fmLnebZvOjKrDiKa7aZCyQnKbQXSgOFlsMFRiIkpZEDlGG0BNco+fbY2aS3eKHlZmIlhqRW56SW93QmtyKFlgFU9X",
            ]),
            isImagePreviewContentAlternative: true,
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "calebmer_iphone_colorado_twin_lakes.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.heic",
            imagePreviewSize: {width: 336, height: 252, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "AAAAAEZIu205RcyTAIuLCy+VOYBMnUlJAAAAAAAAAABocM6eaVO06qxUYJRRgDXhH5EvewAAAAD/AAABAAAAALBFS4vESlD/t1JQlQAAAAD/AP8BqlVVAwAAAACqalFIpm1I9LZzUVQAAAAAqlVVAwAAAAAAAAAAi6IuC4WZM0F1nCcNAAAAAAAAAAA=",
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
            imagePreviewSize: {width: 1224, height: 1584, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "8gAA/+sAAP/19fX/9/f3///////GAAL/vgAA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "iup_pdf_testpage.avif",
            },
        },
        {
            path: "py_pdf_sample_google_doc_document.pdf",
            imagePreviewSize: {width: 1192, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "+/v7//n5+f////////////////////////////////+5tIj/2dnT//n5+f/x8fH/8fHx/7K2gf+zu4D/FBQU/wAAAP8AAAD/AAAA/xIRD/8jIyP/AAAA/wAAAP8AAAD/Jycn/9PT0/+mpqb/////////////////xcXF/4mJif////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_google_doc_document.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_form.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "l5eX/yMjI/9ERET/vLy8//////8TExP/AQEB/x0dHf+wsLD//////wkJCf/V1dX/gYGB////////////iYmJ/05OTv/MzMz///////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_libreoffice_form.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_write_password.pdf",
            previewError: {
                type: "PasswordProtected",
            },
        },
        {
            path: "py_pdf_sample_multicolumn.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_multicolumn.avif",
            },
        },
        {
            path: "py_pdf_sample_pdflatex_outline.pdf",
            imagePreviewSize: {width: 1190, height: 1684, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "py_pdf_sample_pdflatex_outline.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.pdf",
            imagePreviewSize: {width: 672, height: 504, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                7,
                "/////7Cx8v+dn/P/+vz7/6LXof/O7M7///////////+nqO3/iG/R/+Ckp/96o17/is6L/////////////P3+/9+VmP/UaWj/4JmV//z9/P/////////////////v2sz/xYhl/+7Twv///////////////////////f37/+npz//7+/f///////////8=",
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
            imagePreviewSize: {width: 4760, height: 6736, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "pdfsharp_sample_page_sizes.avif",
            },
            // Needs higher tolerance probably because this file is much bigger than others
            // we test so there's more space for there to be mismatches.
            looksSameTolerance: 70,
        },
        {
            path: "deel_for_employees.pdf",
            imagePreviewSize: {width: 2560, height: 6095, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "//////////////////////////////////////////////////////////////////////////////////vz///78///+/P///vz///78/8UFBT/Dw8P///78///+/P///vz///78///+/P//vnw/+zn4P/59Oz///vz///78///+/P///vz///78///+/P///vz///78///+/P///vz//z37v/18On/9fDp//bx6v/89+7///vz///78///+/P///vz///78///+/P///vz///78///+/P///vz///78///+/P///vz///78///+/P/",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "deel_for_employees.avif",
            },
        },
        {
            path: "deel_for_employees_rotated.pdf",
            imagePreviewSize: {width: 8141, height: 2560, scale: 2, hasAlpha: true},
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                true,
                16,
                "qNn//5vK8f8TExP///vz///78///+/P/9/Lq//736v//9N7///nu//Dr4///9eT///Xi///78//17+r/2sv//6jZ//+bx+7/qNn////78///+/P///vz//v27v//9ub///DT///47P/z7uf///Pb///x1///+/P/8+3r/8Wv//+o2f//ptf//6jZ////+/P///vz//r09P/m2fv/9ezw//jv3f/t8fL/2ez6//726f/479//3u75/+Xv+P/k1/n/qNn//6jZ//+o2f////vz///78//07PX/xa///+nd+f/18On/0Oj8/6jZ///++vP/9/Lq/7Dc///F5P7//vnw/6jZ//+o2f//qNn////78///+/P/+PL0/9rL///x6ff///vz/+Lu+P/K5v7//vrz///78//O6Pz/2+36///78/8=",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "deel_for_employees_rotated.avif",
            },
        },
    ],
    "text/plain": [
        {
            path: "haskell_for_all_calendar.txt",
            codePreviewContentLength: 510,
            codePreviewContent: `\
data DayOfWeek
    = Sunday | Monday | Tuesday | Wednesday | Thursday | Friday | Saturday
    deriving (Eq, Enum, Bounded)

data Month
    = January | February | March     | April   | May      | June
    | July    | August   | September | October | November | December
    deriving (Enum, Bounded, Show)

next :: (Eq a, Enum a, Bounded a) =&gt; a -&gt; a
next x | x == maxBound = minBound
       | otherwise     = succ x

pad :: Int -&gt; String
pad day = case show day of
    [c] -&gt; [&#39; &#39;, c]
`,
        },
        {
            path: "haskell_for_all_calendar_with_longer_line_width.txt",
            codePreviewContentLength: 792,
            codePreviewContent: `\
data DayOfWeek = Sunday | Monday | Tuesday | Wednesday | Thursday | Friday | Saturday
data Month = January | February | March | April | May | June | July | August | Septem

year = month January   Thursday  31 ++ month February  Sunday    28 ++ month March   \n\
    ++ month May       Friday    31 ++ month June      Monday    30 ++ month July    \n\
    ++ month September Tuesday   30 ++ month October   Thursday  31 ++ month November

month :: Month -&gt; DayOfWeek -&gt; Int -&gt; String
month m startDay maxDay = show m ++ &quot; 2015\\n&quot; ++ week ++ spaces Sunday
  where
    week = &quot;Su Mo Tu We Th Fr Sa\\n&quot;

    spaces currDay | startDay == currDay = days startDay 1
                   | otherwise           = &quot;   &quot; ++ spaces (next currDay)

    days Sunday    n | n &gt; maxDay = &quot;\\n&quot;
`,
        },
    ],
    "text/x-haskell": [
        {
            path: "haskell_for_all_calendar.hs",
            codePreviewContentLength: 842,
            codePreviewContent: `\
<span class="tok-keyword">data</span> <span class="tok-typeName">DayOfWeek</span>
    <span class="tok-keyword">=</span> <span class="tok-typeName">Sunday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Monday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Tuesday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Wednesday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Thursday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Friday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Saturday</span>
    <span class="tok-keyword">deriving</span> (<span class="tok-variableName">Eq</span>, <span class="tok-variableName">Enum</span>, <span class="tok-variableName">Bounded</span>)

<span class="tok-keyword">data</span> <span class="tok-typeName">Month</span>
    <span class="tok-keyword">=</span> <span class="tok-typeName">January</span> <span class="tok-variableName">|</span> <span class="tok-typeName">February</span> <span class="tok-variableName">|</span> <span class="tok-typeName">March</span>     <span class="tok-variableName">|</span> <span class="tok-typeName">April</span>   <span class="tok-variableName">|</span> <span class="tok-typeName">May</span>      <span class="tok-variableName">|</span> <span class="tok-typeName">June</span>
    <span class="tok-variableName">|</span> <span class="tok-typeName">July</span>    <span class="tok-variableName">|</span> <span class="tok-typeName">August</span>   <span class="tok-variableName">|</span> <span class="tok-typeName">September</span> <span class="tok-variableName">|</span> <span class="tok-typeName">October</span> <span class="tok-variableName">|</span> <span class="tok-typeName">November</span> <span class="tok-variableName">|</span> <span class="tok-typeName">December</span>
    <span class="tok-keyword">deriving</span> (<span class="tok-variableName">Enum</span>, <span class="tok-variableName">Bounded</span>, <span class="tok-variableName">Show</span>)

<span class="tok-variableName">next</span> <span class="tok-keyword">::</span> (<span class="tok-variableName">Eq</span> <span class="tok-variableName">a</span>, <span class="tok-variableName">Enum</span> <span class="tok-variableName">a</span>, <span class="tok-variableName">Bounded</span> <span class="tok-variableName">a</span>) <span class="tok-keyword">=&gt;</span> <span class="tok-variableName">a</span> <span class="tok-keyword">-&gt;</span> <span class="tok-variableName">a</span>
<span class="tok-variableName">next</span> <span class="tok-variableName">x</span> <span class="tok-variableName">|</span> <span class="tok-variableName">x</span> <span class="tok-variableName">==</span> <span class="tok-variableName">maxBound</span> <span class="tok-keyword">=</span> <span class="tok-variableName">minBound</span>
       <span class="tok-variableName">|</span> <span class="tok-variableName">otherwise</span>     <span class="tok-keyword">=</span> <span class="tok-variableName">succ</span> <span class="tok-variableName">x</span>

<span class="tok-variableName">pad</span> <span class="tok-keyword">::</span> <span class="tok-variableName">Int</span> <span class="tok-keyword">-&gt;</span> <span class="tok-variableName">String</span>
<span class="tok-variableName">pad</span> <span class="tok-variableName">day</span> <span class="tok-keyword">=</span> <span class="tok-keyword">case</span> <span class="tok-variableName">show</span> <span class="tok-variableName">day</span> <span class="tok-keyword">of</span>
    [<span class="tok-variableName">c</span>] <span class="tok-keyword">-&gt;</span> [<span class="tok-string">&#39; &#39;</span>, <span class="tok-variableName">c</span>]
`,
        },
        {
            path: "haskell_for_all_calendar_with_longer_line_width.hs",
            codePreviewContentLength: 1284,
            codePreviewContent: `\
<span class="tok-keyword">data</span> <span class="tok-typeName">DayOfWeek</span> <span class="tok-keyword">=</span> <span class="tok-typeName">Sunday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Monday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Tuesday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Wednesday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Thursday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Friday</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Saturday</span>
<span class="tok-keyword">data</span> <span class="tok-typeName">Month</span> <span class="tok-keyword">=</span> <span class="tok-typeName">January</span> <span class="tok-variableName">|</span> <span class="tok-typeName">February</span> <span class="tok-variableName">|</span> <span class="tok-typeName">March</span> <span class="tok-variableName">|</span> <span class="tok-typeName">April</span> <span class="tok-variableName">|</span> <span class="tok-typeName">May</span> <span class="tok-variableName">|</span> <span class="tok-typeName">June</span> <span class="tok-variableName">|</span> <span class="tok-typeName">July</span> <span class="tok-variableName">|</span> <span class="tok-typeName">August</span> <span class="tok-variableName">|</span> <span class="tok-typeName">Septem</span>

<span class="tok-variableName">year</span> <span class="tok-keyword">=</span> <span class="tok-variableName">month</span> <span class="tok-typeName">January</span>   <span class="tok-typeName">Thursday</span>  <span class="tok-number">31</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">February</span>  <span class="tok-typeName">Sunday</span>    <span class="tok-number">28</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">March</span>   \n\
    <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">May</span>       <span class="tok-typeName">Friday</span>    <span class="tok-number">31</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">June</span>      <span class="tok-typeName">Monday</span>    <span class="tok-number">30</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">July</span>    \n\
    <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">September</span> <span class="tok-typeName">Tuesday</span>   <span class="tok-number">30</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">October</span>   <span class="tok-typeName">Thursday</span>  <span class="tok-number">31</span> <span class="tok-variableName">++</span> <span class="tok-variableName">month</span> <span class="tok-typeName">November</span>

<span class="tok-variableName">month</span> <span class="tok-keyword">::</span> <span class="tok-typeName">Month</span> <span class="tok-keyword">-&gt;</span> <span class="tok-typeName">DayOfWeek</span> <span class="tok-keyword">-&gt;</span> <span class="tok-variableName">Int</span> <span class="tok-keyword">-&gt;</span> <span class="tok-variableName">String</span>
<span class="tok-variableName">month</span> <span class="tok-variableName">m</span> <span class="tok-variableName">startDay</span> <span class="tok-variableName">maxDay</span> <span class="tok-keyword">=</span> <span class="tok-variableName">show</span> <span class="tok-variableName">m</span> <span class="tok-variableName">++</span> <span class="tok-string">&quot; 2015\\n&quot;</span> <span class="tok-variableName">++</span> <span class="tok-variableName">week</span> <span class="tok-variableName">++</span> <span class="tok-variableName">spaces</span> <span class="tok-typeName">Sunday</span>
  <span class="tok-keyword">where</span>
    <span class="tok-variableName">week</span> <span class="tok-keyword">=</span> <span class="tok-string">&quot;Su Mo Tu We Th Fr Sa\\n&quot;</span>

    <span class="tok-variableName">spaces</span> <span class="tok-variableName">currDay</span> <span class="tok-variableName">|</span> <span class="tok-variableName">startDay</span> <span class="tok-variableName">==</span> <span class="tok-variableName">currDay</span> <span class="tok-keyword">=</span> <span class="tok-variableName">days</span> <span class="tok-variableName">startDay</span> <span class="tok-number">1</span>
                   <span class="tok-variableName">|</span> <span class="tok-variableName">otherwise</span>           <span class="tok-keyword">=</span> <span class="tok-string">&quot;   &quot;</span> <span class="tok-variableName">++</span> <span class="tok-variableName">spaces</span> (<span class="tok-variableName">next</span> <span class="tok-variableName">currDay</span>)

    <span class="tok-variableName">days</span> <span class="tok-typeName">Sunday</span>    <span class="tok-variableName">n</span> <span class="tok-variableName">|</span> <span class="tok-variableName">n</span> <span class="tok-variableName">&gt;</span> <span class="tok-variableName">maxDay</span> <span class="tok-keyword">=</span> <span class="tok-string">&quot;\\n&quot;</span>
`,
        },
    ],
    "text/x-java": [
        {
            path: "lacuna_bifurcan_directed_acyclic_graph.java",
            codePreviewContentLength: 588,
            codePreviewContent: `\
<span class="tok-comment">// From: https://github.com/lacuna/bifurcan</span>
<span class="tok-comment">// License: https://github.com/lacuna/bifurcan/blob/master/LICENSE</span>

<span class="tok-keyword tok-moduleKeyword">package</span> <span class="tok-variableName">io</span><span class="tok-operator">.</span><span class="tok-variableName">lacuna</span><span class="tok-operator">.</span><span class="tok-variableName">bifurcan</span><span class="tok-punctuation">;</span>

<span class="tok-keyword tok-moduleKeyword">import</span> <span class="tok-variableName">java</span><span class="tok-operator">.</span><span class="tok-variableName">util</span><span class="tok-operator">.</span><span class="tok-variableName">Iterator</span><span class="tok-punctuation">;</span>
<span class="tok-keyword tok-moduleKeyword">import</span> <span class="tok-variableName">java</span><span class="tok-operator">.</span><span class="tok-variableName">util</span><span class="tok-operator">.</span><span class="tok-variableName">function</span><span class="tok-operator">.</span><span class="tok-punctuation">*</span><span class="tok-punctuation">;</span>

<span class="tok-keyword tok-moduleKeyword">import</span> <span class="tok-keyword">static</span> <span class="tok-variableName">io</span><span class="tok-operator">.</span><span class="tok-variableName">lacuna</span><span class="tok-operator">.</span><span class="tok-variableName">bifurcan</span><span class="tok-operator">.</span><span class="tok-variableName">Graphs</span><span class="tok-operator">.</span><span class="tok-variableName">MERGE_LAST_WRITE_WINS</span><span class="tok-punctuation">;</span>

<span class="tok-comment">/**</span>
<span class="tok-comment"> * A directed graph which will throw a {@link DirectedAcyclicGraph.CycleException} if</span>
<span class="tok-comment"> *</span>
<span class="tok-comment"> * @author ztellman</span>
<span class="tok-comment"> */</span>
<span class="tok-keyword">public</span> <span class="tok-keyword">class</span> <span class="tok-variableName tok-definition">DirectedAcyclicGraph</span>&lt;<span class="tok-variableName tok-definition">V</span><span class="tok-punctuation">,</span> <span class="tok-variableName tok-definition">E</span>&gt; <span class="tok-keyword">implements</span> <span class="tok-typeName">IGraph</span>&lt;<span class="tok-typeName">V</span><span class="tok-punctuation">,</span> <span class="tok-typeName">E</span>&gt; <span class="tok-punctuation">{</span>
`,
        },
    ],
};

testFileProcessorContentTypes(context, testCases);
