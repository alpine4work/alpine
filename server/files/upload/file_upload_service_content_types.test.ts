import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import decodeIco from "decode-ico";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import looksSame from "looks-same";
import {extname, join as joinPath} from "path";
import sharp from "sharp";
import {ReadableStream} from "stream/web";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {getFile} from "~/server/files/data/files_table.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {UploadFileEventSchema} from "~/server/files/upload/upload_file.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

const testlogsPath = joinPath(assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR), "files");

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in FileContentType]: NonEmptyReadonlyArray<{
        only?: CommitBlocker;
        path: string;
        contentLength: number;
        size?: {width: number; height: number; scale?: number};
        placeholder?: FilePreviewPlaceholder;
        image?: {
            contentType: FileContentType;
            contentLength: number;
            similarPath: string;
        };
        error?: {
            code: ErrorCode;
            displayMessage: ErrorDisplayMessage;
        };
    }>;
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "x9TY/8vW2//O2Nv/ztfa/83W2v/W2dn/2Nzd/97j5f/i5OX/3d7f/7a0rv+0saz/0M7L/9DNyP+xrKX/laer/5aprf+fr7T/o7K1/6eytf8=",
            ]),
        },
        {
            path: "wikimedia_rotating_earth.gif",
            contentLength: 118405,
            size: {width: 400, height: 400},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.png",
            contentLength: 76547,
            size: {width: 336, height: 252},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpW8Jo1f6owN7k9fFq0WhFupv8Xj2bAsLxTYc9jkTinAOsTDQAAAADTXDYvy2hP8t1gYD0AAAAAAAAAAJ+/fwiltkw/jcY4CQAAAAA=",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 732, height: 619},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "VVVVA2hWeVd3YrucAAAAAAAAAAAAAAAAaFz/DVZY/70AAAAAAAAAAAAAAAAAAAAALSxEowAAAAAAAAAAAAAAAAAAAABEO0+JAAAAAAAAAAA=",
            ]),
        },
        {
            path: "alpine_favicon_old.svg",
            contentLength: 594,
            size: {width: 74, height: 74},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
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
            size: {width: 250, height: 188},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 5940,
                // We shrink the `.bmp` file since it's quite large so we have a special
                // `.bmp.jpeg` file to compare for similarity.
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.bmp.avif",
            },
        },
    ],
    "image/ico": [
        {
            path: "alpine_favicon_old.ico",
            contentLength: 15086,
            size: {width: 48, height: 48},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAFQwLCwsrAAAAAAAAAAIAAAAACQkMUgoKDdMAAAAGAAAAAAAAAAkLCw2XCgoOfQoKDaoAAAADDAwOagsLDqwAAAAACgoOjAsLDm0LCwttCwsNlwwMD1QJCQkbDAwMag==",
            ]),
            image: {
                contentType: "image/png",
                contentLength: 843,
                similarPath: "alpine_favicon_old.png",
            },
        },
        {
            path: "stackoverflow_favicon.ico",
            contentLength: 5430,
            size: {width: 32, height: 32},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL9nsIHQAAAAAAAAABAAAAAP96AEn/dQCP/n8JHAAAAAD/egAb/3gAkP91AI3/fwAOf6/vEM2OYWb/cgB72otPanGq4huZqrsPo6CgZ6udlFmiop9gn5+qGA==",
            ]),
            image: {
                contentType: "image/png",
                contentLength: 632,
                similarPath: "stackoverflow_favicon.png",
            },
        },
        {
            path: "stackoverflow_favicon.png.ico",
            contentLength: 1264,
            size: {width: 32, height: 32},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAD/iwAL/3cIHgAAAAAAAAAAAAAAAP93AE3/eACO9X8JHAAAAAD+fwAc/3UAhP9zAIf/eAARX6//EMqRZGv/eACb1YlRekTM/w+WpaURoaGhWqWenkecoqVTnZ2dFQ==",
            ]),
            image: {
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
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 16324,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.tiff",
            contentLength: 107676,
            size: {width: 336, height: 252},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpX8Jo1f6owN7Q9fFq0WhFupv8Xj2bAsLxTYc9kjzanAOsTDQAAAADTXDYvymlP8t1gYD0AAAAAAAAAAJ+/fwilskQ/japVCQAAAAA=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 24923,
                similarPath: "wikimedia_png_transparency_demonstration.avif",
            },
        },
    ],
    "image/heif": [
        {
            path: "filesampleshub_heif_sample1.heif",
            contentLength: 42984,
            size: {width: 640, height: 426},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "udnfm7i+hZ+ki7fChdTrxbafTR8QVyoZglxHfnlzyZBivoFT3J5p7qdq4ZVY",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 74432,
                similarPath: "filesampleshub_heif_sample1.avif",
            },
        },
    ],
    "image/heic": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.heic",
            contentLength: 36233,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 16095,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            },
        },
        {
            path: "iphone_calebmer_colorado_twin_lakes.heic",
            contentLength: 88109,
            size: {width: 480, height: 640},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                4,
                "R4zOX5TLVoa7dpW+farYor3ikrLafqTRfZu2cZKsVHyfP2+YUG5/QWd2GEdWHEZTW3+MV3+KM2RvGFRi",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 72829,
                similarPath: "iphone_calebmer_colorado_twin_lakes.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.heic",
            contentLength: 16960,
            size: {width: 336, height: 252},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "XFy5IUNMzZo1aoowOZo5fEuWSxFYkP8XfFypsKNMWM9aezWnAJwTDQAAAACtSzAvs19J8sRbVz0AAAAAAAAAAH9/XwiNlTw/jY1VCQAAAAA=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 21462,
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
            size: {width: 1224, height: 1584, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "8gAA/+sAAP/7+/v//////8YAAv++AAD///////////////////////////////////////////////////////////////////////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 43729,
                similarPath: "iup_pdf_testpage.avif",
            },
        },
        {
            path: "py_pdf_sample_google_doc_document.pdf",
            contentLength: 80100,
            size: {width: 1192, height: 1684, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////+5tIj/2dnT//39/f/8/Pz/trqF/7W8gv8FBQX/AAAA/wAAAP8FBQT/ODg4/w0NDf8ODg7/QkJC/5OTk/+ioqL///////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 98603,
                similarPath: "py_pdf_sample_google_doc_document.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_form.pdf",
            contentLength: 34186,
            size: {width: 1190, height: 1684, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "JSUl/wcHB/9DQ0P//////wAAAP/X19f/mpqa//////80NDT/R0dH//Hx8f////////////////////////////////////////////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 13628,
                similarPath: "py_pdf_sample_libreoffice_form.avif",
            },
        },
        {
            path: "py_pdf_sample_libreoffice_write_password.pdf",
            contentLength: 12783,
            error: {
                code: ErrorCode.PermissionDenied,
                displayMessage: errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`,
            },
        },
        {
            path: "py_pdf_sample_multicolumn.pdf",
            contentLength: 78657,
            size: {width: 1190, height: 1684, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 223379,
                similarPath: "py_pdf_sample_multicolumn.avif",
            },
        },
        {
            path: "py_pdf_sample_pdflatex_outline.pdf",
            contentLength: 48722,
            size: {width: 1190, height: 1684, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 7418,
                similarPath: "py_pdf_sample_pdflatex_outline.avif",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.pdf",
            contentLength: 82860,
            size: {width: 672, height: 504, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "7u77/46R7f/i6u//l9SZ//r9+v/39/3/tpzS/9eAhf+buYP/9fv1///////25eL/zXJi//Xb2P////////////7+/v/h4r7//f38//////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 18137,
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
            size: {width: 4760, height: 6736, scale: 2},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                4,
                "//////////////////////////////////////////////////////////////////////////////////////////////////////////8=",
            ]),
            image: {
                contentType: "image/avif",
                contentLength: 1717,
                similarPath: "pdfsharp_sample_page_sizes.avif",
            },
        },
    ],
};

let r2Bucket: R2Bucket;
let serverTokenAgent: TokenAgent;
let tokenAgent: TokenAgent;
let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    const r2Storage = new FileStorage(joinPath(context.getTempPath(), "r2", filesBucketName));
    r2Bucket = new R2Bucket(r2Storage);
    const r2ContextModule = new CloudflareR2ContextModule(
        new MiniflareR2Client(new Map([[filesBucketName, r2Bucket]])),
    );

    [[serverTokenAgent, tokenAgent], port] = await runAllPromises([
        createTestTokenAgents(context, ["FileUploadService", "EdgeService"]),
        getPort(),
    ]);
    server = createFileUploadService(context.clone({r2: r2ContextModule}), serverTokenAgent);

    await new Promise<void>(resolve => {
        server.listen(port, resolve);
    });
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
});

async function authorization(session: TestSession) {
    const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
        "FileUploadService",
        session.getTokenPayload(),
    );

    return `Bearer ${token}`;
}

function massageHeaders(headers: Headers) {
    return omitObject(Object.fromEntries(headers), [
        "connection",
        "date",
        "keep-alive",
        "transfer-encoding",
    ]);
}

function parseJsonEvents(responseText: string) {
    return responseText
        .trim()
        .split("\n")
        .map(eventString => UploadFileEventSchema.deserialize(JSON.parse(eventString)));
}

test("can process bmp files", async () => {
    const metadata = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.bmp",
        ),
    ).metadata();

    expect(metadata.format).toEqual("magick");
    expect(metadata.formatMagick).toEqual("BMP");
});

test("can process pdf files", async () => {
    const metadata = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/iup_pdf_testpage.pdf",
        ),
    ).metadata();

    expect(metadata.format).toEqual("pdf");
});

test("`looks-same` dependency works", async () => {
    const {equal} = await looksSame(
        ...(await runAllPromises([
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.png",
                ),
            ),
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures/wikimedia_png_transparency_demonstration.png",
                ),
            ),
        ])),
    );

    if (equal) {
        throw new InternalError(
            "The two images we provided look the same when we expected them to not look the same",
        );
    }
});

test("`decode-ico` dependency can parse ico files with png and with bmp", async () => {
    const result1 = decodeIco(
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/stackoverflow_favicon.ico",
            ),
        ),
    );

    expect(
        result1.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "bmp", width: 16, height: 16},
        {type: "bmp", width: 32, height: 32},
    ]);

    const result2 = decodeIco(
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/stackoverflow_favicon.png.ico",
            ),
        ),
    );

    expect(
        result2.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "png", width: 16, height: 16},
        {type: "png", width: 32, height: 32},
    ]);

    const result3 = decodeIco(
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/alpine_favicon_old.ico",
            ),
        ),
    );

    expect(
        result3.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "bmp", width: 48, height: 48},
        {type: "bmp", width: 32, height: 32},
        {type: "bmp", width: 16, height: 16},
    ]);
});

for (const [contentType, contentTypeTestCases] of Object.entries(testCases)) {
    for (const {
        only,
        path,
        contentLength: expectedContentLength,
        size: expectedSize,
        placeholder: expectedPlaceholder,
        image: expectedImage,
        error: expectedError,
    } of contentTypeTestCases) {
        const testFn = only ? test.only : test;

        testFn(quote`can upload ${contentType} file ${path}`, async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": contentType,
                },
                body: await fs.readFile(
                    joinPath(runfilesPath, "cyberworlds/server/files/upload/test_fixtures", path),
                ),
            });
            const responseText = await response.text();

            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });

            const eventOrder = [
                "Start",
                "PreviewSize",
                "PreviewPlaceholder",
                "PreviewImage",
                "PreviewError",
                "Finish",
            ];
            const events = parseJsonEvents(responseText).sort(
                (event1, event2) =>
                    eventOrder.indexOf(event1.type) - eventOrder.indexOf(event2.type),
            );

            expect(
                findMapIterable(events, event => (event.type === "Error" ? event : undefined)),
            ).toEqual(undefined);

            const fileId = assertExists(
                findMapIterable(events, event =>
                    event.type === "Start" ? event.fileId : undefined,
                ),
            );

            const file = await getFile(space.systemAction(), fileId);
            expect(file).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: contentType as FileContentType,
                    contentLength: expectedContentLength,
                    isUploading: false,
                    preview: expectedError
                        ? {
                              isProcessing: false,
                              ok: false,
                              error: expectedError,
                          }
                        : expectedSize
                        ? {
                              isProcessing: false,
                              ok: true,
                              size: {
                                  width: expectedSize.width,
                                  height: expectedSize.height,
                                  scale: expectedSize.scale ?? 1,
                              },
                              placeholder: expect.any(FilePreviewPlaceholder),
                              image: expectedImage
                                  ? {
                                        contentType: expectedImage.contentType,
                                        contentLength: expect.any(Number),
                                    }
                                  : undefined,
                          }
                        : null,
                }),
            );

            if (!expectedError && expectedSize && expectedImage) {
                assert(file.preview);
                assert(!file.preview.isProcessing);
                assert(file.preview.ok);
                assert(file.preview.image);

                const epsilon = 200;
                const withinRange =
                    expectedImage.contentLength - epsilon <= file.preview.image.contentLength &&
                    file.preview.image.contentLength <= expectedImage.contentLength + epsilon;

                if (!withinRange) {
                    throw new InternalError(
                        `Expected preview image content length to be ${expectedImage.contentLength} (±${epsilon}) but the actual content length is ${file.preview.image.contentLength}`,
                    );
                }
            }

            expect(events).toEqual([
                {
                    type: "Start",
                    hasPreview: !!expectedSize || !!expectedError,
                    hasPreviewImage: !!expectedImage || !!expectedError,
                    fileId: expect.any(String),
                },
                ...(expectedSize
                    ? [
                          {
                              type: "PreviewSize",
                              width: expectedSize.width,
                              height: expectedSize.height,
                              scale: expectedSize.scale ?? 1,
                          },
                      ]
                    : []),
                ...(expectedPlaceholder
                    ? [
                          {
                              type: "PreviewPlaceholder",
                              placeholder: expect.any(FilePreviewPlaceholder),
                          },
                      ]
                    : []),
                ...(expectedImage
                    ? [
                          {
                              type: "PreviewImage",
                              contentType: expectedImage.contentType,
                              contentLength:
                                  file.preview && !file.preview.isProcessing && file.preview.ok
                                      ? file.preview.image?.contentLength
                                      : null,
                          },
                      ]
                    : []),
                ...(expectedError
                    ? [
                          {
                              type: "PreviewError",
                              error: expectedError,
                          },
                      ]
                    : []),
                {
                    type: "Finish",
                },
            ]);
            expect(response.status).toEqual(200);

            const placeholder = findMapIterable(events, event =>
                event.type === "PreviewPlaceholder" ? event.placeholder : undefined,
            );

            if (!expectedPlaceholder) {
                expect(placeholder).toEqual(undefined);
            } else {
                // Compare placeholders. Sharp's placeholder generation isn't deterministic
                // across platforms. So check that placeholders are close to each other if not
                // exactly equal.
                compareFilePreviewPlaceholders(assertExists(placeholder), expectedPlaceholder);
            }

            if (expectedImage) {
                const object = await r2Bucket.get(
                    `${space.id}/${fileId}.preview.${getFileContentTypePreferredExtension(
                        expectedImage.contentType,
                    )}`,
                );
                if (!object) throw new NotFoundError("Preview image file not found");

                const [actualImageContents, expectedImageContents] = await runAllPromises([
                    convertReadableStreamToUint8Array(object.body).then(buffer =>
                        Buffer.from(buffer),
                    ),
                    fs.readFile(
                        joinPath(
                            runfilesPath,
                            "cyberworlds/server/files/upload/test_fixtures",
                            expectedImage.similarPath,
                        ),
                    ),
                ]);

                const result = await looksSame(actualImageContents, expectedImageContents, {
                    tolerance: 50,
                    createDiffImage: true,
                });

                if (!result.equal) {
                    const name = encodeURIComponent(
                        `${contentType.replaceAll("/", "_")}.${path.slice(
                            0,
                            -extname(path).length,
                        )}`,
                    );
                    const extension = extname(expectedImage.similarPath);

                    await fs.mkdir(testlogsPath, {recursive: true});

                    await runAllPromises([
                        fs.writeFile(
                            joinPath(testlogsPath, `${name}.input.actual${extension}`),
                            actualImageContents,
                        ),
                        fs.writeFile(
                            joinPath(testlogsPath, `${name}.input.expected${extension}`),
                            expectedImageContents,
                        ),
                        result.diffImage?.save(joinPath(testlogsPath, `${name}.diff${extension}`)),
                    ]);

                    throw new InternalError(
                        "Actual preview image doesn't look the same as expected preview image, diff image saved to `bazel-testlogs`",
                    );
                }
            }
        });
    }
}

function compareFilePreviewPlaceholders(
    actualPlaceholder: FilePreviewPlaceholder,
    expectedPlaceholder: FilePreviewPlaceholder,
) {
    const actualPixelGrid = actualPlaceholder.get();
    const expectedPixelGrid = expectedPlaceholder.get();
    const actualSerializedPixelGrid = actualPlaceholder.serialize();
    const expectedSerializedPixelGrid = expectedPlaceholder.serialize();
    const actualPlaceholderString = JSON.stringify(
        FilePreviewPlaceholder.schema.serialize(actualPlaceholder),
    );

    if (actualPixelGrid.length !== expectedPixelGrid.length) {
        throw new InvalidArgumentError(
            `Placeholder height doesn't match, actual placeholder: ${actualPlaceholderString}`,
        );
    }

    if (actualSerializedPixelGrid[0] !== expectedSerializedPixelGrid[0]) {
        throw new InvalidArgumentError(
            `Placeholder "hasAlphaChannel" doesn't match, actual placeholder: ${actualPlaceholderString}`,
        );
    }

    const hasAlphaChannel = actualSerializedPixelGrid[0];
    const channelCount = hasAlphaChannel ? 4 : 3;

    let totalDistance = 0;
    let pixelCount = 0;

    for (let y = 0; y < actualPixelGrid.length; y++) {
        const actualPixelRow = actualPixelGrid[y]!;
        const expectedPixelRow = expectedPixelGrid[y]!;

        if (actualPixelRow.length !== expectedPixelRow.length) {
            throw new InvalidArgumentError(
                `Placeholder width doesn't match, actual placeholder: ${actualPlaceholderString}`,
            );
        }

        for (let x = 0; x < actualPixelRow.length; x++) {
            const actualPixel = actualPixelRow[x]!;
            const expectedPixel = expectedPixelRow[x]!;

            // Make sure we're not comparing the exact same `FilePreviewPlaceholder`
            // object.
            assert(actualPixel !== expectedPixel);

            const distance =
                Math.sqrt(
                    (actualPixel.r - expectedPixel.r) ** 2 +
                        (actualPixel.g - expectedPixel.g) ** 2 +
                        (actualPixel.b - expectedPixel.b) ** 2 +
                        ((actualPixel.alpha ?? 1) * 255 - (expectedPixel.alpha ?? 1) * 255) ** 2,
                ) / channelCount;

            totalDistance += distance;
            pixelCount += 1;
        }
    }

    const averageDistance = totalDistance / pixelCount;

    if (averageDistance >= 4) {
        throw new InvalidArgumentError(
            `Placeholder pixel doesn't match (average distance = ${averageDistance}), actual placeholder: ${actualPlaceholderString}`,
        );
    }
}

function concatUint8Arrays(chunks: Array<Uint8Array>): Uint8Array {
    const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

async function convertReadableStreamToUint8Array(
    stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
    const chunks: Array<Uint8Array> = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return concatUint8Arrays(chunks);
}
