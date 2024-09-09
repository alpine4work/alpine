import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/upload/test_helpers/test_file_processor_content_types.js";
import {FileVideoContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in FileVideoContentType]: FileProcessorContentTypeTestCase;
} = {
    "video/webm": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            previewVideoDuration: 7620,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_vorbis_audio_codec.webm",
            previewVideoDuration: 7610,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_without_metadata.webm",
            previewVideoDuration: 7590,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
    ],
    "video/quicktime": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21.mov",
            alternative: {
                contentType: "video/webm",
                // The `.mov` file is shorter than the `.webm` file. Clocking in at ~2s vs 6s.
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.mov.webm",
            },
            previewVideoDuration: 2010,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "calebmer_alpine_forum_screen_recording.mov",
            alternative: {
                contentType: "video/webm",
                similarPath: "calebmer_alpine_forum_screen_recording.webm",
            },
            previewVideoDuration: 3820,
            previewSize: {
                width: 756,
                height: 1018,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                4,
                "8/Pz9fX1+/v78/Pz8vLy9fX1/Pz8+/v78fHx9fX1/Pz8+vr69vb2+Pj4+/v7+vr69PT19/f4+/v6+vr6",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "calebmer_alpine_forum_screen_recording.avif",
            },
        },
    ],
    "video/mpeg": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21.mpeg",
            alternative: {
                contentType: "video/webm",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            },
            previewVideoDuration: 7650,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
            // Higher tolerance since it appears some artifacts are created when
            // re-encoding to MPEG to WEBM then to JPEG.
            looksSameTolerance: 40,
        },
    ],
    "video/x-matroska": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21.mkv",
            alternative: {
                contentType: "video/webm",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            },
            previewVideoDuration: 7610,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_without_metadata.mkv",
            alternative: {
                contentType: "video/webm",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            },
            previewVideoDuration: 7590,
            previewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            previewPlaceholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            previewImage: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
    ],
};

testFileProcessorContentTypes(testCases);
