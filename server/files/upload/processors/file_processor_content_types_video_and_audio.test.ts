import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/upload/test_helpers/test_file_processor_content_types.js";
import {FileAudioContentType, FileVideoContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";

const context = createTestContext();

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in FileVideoContentType | FileAudioContentType]: FileProcessorContentTypeTestCase;
} = {
    "video/webm": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            imagePreviewVideoDuration: 7620,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_vorbis_audio_codec.webm",
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_without_metadata.webm",
            imagePreviewVideoDuration: 7590,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
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
            imagePreviewVideoDuration: 2010,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
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
            imagePreviewVideoDuration: 3820,
            imagePreviewSize: {
                width: 756,
                height: 1018,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                4,
                "8/Pz9fX1+/v78/Pz8vLy9fX1/Pz8+/v78fHx9fX1/Pz8+vr69vb2+Pj4+/v7+vr69PT19/f4+/v6+vr6",
            ]),
            imagePreviewContent: {
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
            imagePreviewVideoDuration: 7650,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
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
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
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
            imagePreviewVideoDuration: 7590,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
    ],
    "video/mp4": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_av1_video_codec_and_opus_audio_codec.mp4",
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_h264_video_codec_and_flac_audio_codec.mp4",
            imagePreviewVideoDuration: 2010,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_hevc_video_codec_and_alac_audio_codec.mp4",
            alternative: {
                contentType: "video/webm",
                // Use the `.mov.webm` file as the similar path since its duration was also
                // shorted to 2 seconds.
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.mov.webm",
            },
            imagePreviewVideoDuration: 2010,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_hevc_video_codec_and_mp3_audio_codec.mp4",
            alternative: {
                contentType: "video/webm",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.webm",
            },
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_vp9_video_codec_and_alac_audio_codec.mp4",
            alternative: {
                contentType: "video/webm",
                // Use the `.mov.webm` file as the similar path since its duration was also
                // shorted to 2 seconds.
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.mov.webm",
            },
            imagePreviewVideoDuration: 2010,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_vp9_video_codec_and_mp3_audio_codec.mp4",
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "aGFgbWJiZWBgamVfcGxhm3x4d6h5fatjg7RwmrRoqllcf2dan3ZheJRceqxM",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
    ],
    "audio/mpeg": [
        {
            path: "pokemon_regirock_un_un_un_meme.mp3",
            audioPreviewDuration: 5538,
        },
    ],
    "audio/wav": [
        {
            path: "pokemon_regirock_un_un_un_meme.wav",
            audioPreviewDuration: 5510,
        },
    ],
    "audio/webm": [
        {
            path: "pokemon_regirock_un_un_un_meme.weba",
            audioPreviewDuration: 5519,
        },
        {
            path: "pokemon_regirock_un_un_un_meme_without_metadata.weba",
            audioPreviewDuration: 5510,
        },
    ],
    "audio/ogg": [
        {
            path: "pokemon_regirock_un_un_un_meme.oga",
            alternative: {contentType: "audio/webm"},
            audioPreviewDuration: 5510,
        },
        {
            // This is a hack but we want to test the unsafe audio processor with a file
            // that doesn't have duration metadata. So pretend our WebM file without
            // metadata is an OGG file. We aren't currently asserting that the container
            // format matches the content type which is why this works.
            path: "pokemon_regirock_un_un_un_meme_without_metadata.weba",
            alternative: {contentType: "audio/webm"},
            audioPreviewDuration: 5510,
        },
    ],
    "audio/mp4": [
        {
            path: "pokemon_regirock_un_un_un_meme_with_aac_audio_codec.m4a",
            audioPreviewDuration: 5512,
        },
        {
            path: "pokemon_regirock_un_un_un_meme_with_alac_audio_codec.m4a",
            alternative: {contentType: "audio/webm"},
            audioPreviewDuration: 5510,
        },
    ],
};

testFileProcessorContentTypes(context, testCases);
