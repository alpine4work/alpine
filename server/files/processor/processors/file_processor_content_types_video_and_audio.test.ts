import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileProcessorContentTypeTestCase,
    testFileProcessorContentTypes,
} from "~/server/files/processor/test_helpers/test_file_processor_content_types.js";
import {FileAudioContentType, FileVideoContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";

const context = createTestContext();

// Use TypeScript to make sure we have at least one file as a test case for each of
// the `FileContentType`s we support.
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
                hasAlpha: true,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WVxWWFlVWlxWX11XYFxbX1dXYFxbX1xYY2FndW1sgGxufnJvdnFsdHNue3VnhIpzg4Jjm4xisWVnuaebm72BfrVmfq9ce7doh8B+l8Ful79ZwlljSY1yHpBncJZllK9jfbZbcrRUgK1ch7RYykRVo05VmEZNp0dXqlVnf2ljgJdfd6RIcqc+",
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
                hasAlpha: true,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WVxWWFlVWlxWX11XYFxbX1dXYFxbX1xYY2FndW1sgGxufnJvdnFsdHNue3VnhIpzg4Jjm4xisWVnuaebm72BfrVmfq9ce7doh8B+l8Ful79ZwlljSY1yHpBncJZllK9jfbZbcrRUgK1ch7RYykRVo05VmEZNp0dXqlVnf2ljgJdfd6RIcqc+",
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
                hasAlpha: true,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WVxWWFlVWlxWX11XYFxbX1dXYFxbX1xYY2FndW1sgGxufnJvdnFsdHNue3VnhIpzg4Jjm4xisWVnuaebm72BfrVmfq9ce7doh8B+l8Ful79ZwlljSY1yHpBncJZllK9jfbZbcrRUgK1ch7RYykRVo05VmEZNp0dXqlVnf2ljgJdfd6RIcqc+",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "blender_big_buck_bunny.webm",
            imagePreviewVideoDuration: 15030,
            imagePreviewSize: {
                width: 100,
                height: 56,
                scale: 1,
                hasAlpha: true,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "/9zd/93d/dze/ujd/+nh6eLY0eTMjamKhp9v/9zU/9vS/9vU/+HX/+3fm6OaeZ9yfZFleIhW7tDS3s3V08raytDJhKR2RGZnVWJeX3ZMW2tJlL5Ql8JNoMNdhLBpVXxDSGlDRlw7TGYzPFIqoa0LkakAmawAmKcNlKoAhqIAhp4OfJQHb4oA",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "blender_big_buck_bunny.avif",
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
                9,
                "WFxXWFlVWlxWYF1YYFxZXlhYYFxcYFtYY2BndW1sgGxufXJudXFtdHRufHVohIpzgoJjm4xjsGVnuaebnb2AfrVlf7BbfLZoh7+Alr9ul79XwlljSYxyHZJmcZZllK9hfbZbc7JTgK1bhrRZykVUo1BVmEZMp0dXqlVngGljgZdfd6VHcag/",
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
                5,
                "9vb29fX1+vr6/Pz86+vr8PDw7u7u/Pz8+vr6+/v78vLy8vLy/Pz8+/v7+fn58vLy9PT0/Pz8+vr6+vr68/Pz8/Pz+vr6+vr6+vr69vb39PP2/Pz8+/v7+/v79PT09PT1+/v6+fn5+vr6",
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
                9,
                "WFxXWFlVWlxWYF1YYFxZXlhYYFxcYFtYY2BndW1sgGxufXJudXFtdHRufHVohIpzgoJjm4xjsGVnuaebnb2AfrVlf7BbfLZoh7+Alr9ul79XwlljSYxyHZJmcZZllK9hfbZbc7JTgK1bhrRZykVUo1BVmEZMp0dXqlVngGljgZdfd6VHcag/",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
            // Higher tolerance since it appears some artifacts are created when re-encoding to
            // MPEG to WEBM then to JPEG.
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
                9,
                "WVxWWVlVW1xVX11XYFxZX1dXYFxcYFtaY2FndW1sgGxufXJvdnJsdHNte3RnhIp1g4JkmoxgsGVmu6ednLyCf7Rlfq9bfbZoh8B/lsBvl75YwlljSY1xHpBmcJZllK9ifbZcc7JUgK1bhrRYykNVo05Wl0ZMp0dWqlVngGligJdgd6RIc6c+",
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
                9,
                "WVxWWVlVW1xVX11XYFxZX1dXYFxcYFtaY2FndW1sgGxufXJvdnJsdHNte3RnhIp1g4JkmoxgsGVmu6ednLyCf7Rlfq9bfbZoh8B/lsBvl75YwlljSY1xHpBmcJZllK9ifbZcc7JUgK1bhrRYykNVo05Wl0ZMp0dWqlVngGligJdgd6RIc6c+",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "blender_big_buck_bunny.mkv",
            alternative: {
                contentType: "video/webm",
                similarPath: "blender_big_buck_bunny.webm",
            },
            imagePreviewVideoDuration: 15000,
            imagePreviewSize: {
                width: 100,
                height: 56,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "/9zd/93d/dze/ujd/+nh6eLY0eTMjamKhp9v/9zU/9vS/9vU/+HX/+3fm6OaeZ9yfZFleIhW7tDS3s3V08raytDJhKR2RGZnVWJeX3ZMW2tJlL5Ql8JNoMNdhLBpVXxDSGlDRlw7TGYzPFIqoa0LkakAmawAmKcNlKoAhqIAhp4OfJQHb4oA",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "blender_big_buck_bunny.avif",
            },
        },
    ],
    "video/mp4": [
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_av1_video_codec_and_mp3_audio_codec.mp4",
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WFxXWVlWXFxWYl1YYF1bX1dWYFxcYFtaY2FodW1tgGxufXJvdXJtdnNue3VnhIp1g4Jkm4xisGVouambm71/frVlfq9bfbZoh8B+l8Ful79awlljSYxyHZJncZZnlK9ifrZbc7JUgK1chrRYyUVUo1BVmEdNqUhXq1RogGljgJdgd6RJc6c/",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_av1_video_codec_and_mp3_audio_codec_and_moov_atom_at_end.mp4",
            alternative: {contentType: "video/mp4"},
            imagePreviewVideoDuration: 7610,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WFxXWVlWXFxWYl1YYF1bX1dWYFxcYFtaY2FodW1tgGxufXJvdXJtdnNue3VnhIp1g4Jkm4xisGVouambm71/frVlfq9bfbZoh8B+l8Ful79awlljSYxyHZJncZZnlK9ifrZbc7JUgK1chrRYyUVUo1BVmEdNqUhXq1RogGljgJdgd6RJc6c/",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "wikimedia_france_vs_czech_republic_2013_09_21_with_h264_video_codec_and_flac_audio_codec.mp4",
            imagePreviewVideoDuration: 2000,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WFxXWVlWW1xXYF1YYF1bYFdXYlxcYFxbZWFndW5tgGxufnJxdXJtdnNue3VohIp1hIJkmoxisWVouaedm72CfrVmf69ce7dph8B/lsBvmb9awlljSYxxHZJocJZolLBjfrZcc7RVgK1chrNXykNVo05UmEZNp0dXqlVlf2pkgJdgd6RIcqg/",
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
                // Use the `.mov.webm` file as the similar path since its duration was also shorted
                // to 2 seconds.
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.mov.webm",
            },
            imagePreviewVideoDuration: 2000,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WVxWWVlVW1xVX11XYFxZX1dXYFxcYFtaY2FndW1sgGxufXJvdnJsdHNte3RnhIp1g4JkmoxgsGVmu6ednLyCf7Rlfq9bfbZoh8B/lsBvl75YwlljSY1xHpBmcJZllK9ifbZcc7JUgK1bhrRYykNVo05Wl0ZMp0dWqlVngGligJdgd6RIc6c+",
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
                9,
                "WVxWWVlVW1xVX11XYFxZX1dXYFxcYFtaY2FndW1sgGxufXJvdnJsdHNte3RnhIp1g4JkmoxgsGVmu6ednLyCf7Rlfq9bfbZoh8B/lsBvl75YwlljSY1xHpBmcJZllK9ifbZcc7JUgK1bhrRYykNVo05Wl0ZMp0dWqlVngGligJdgd6RIc6c+",
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
                // Use the `.mov.webm` file as the similar path since its duration was also shorted
                // to 2 seconds.
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.mov.webm",
            },
            imagePreviewVideoDuration: 2000,
            imagePreviewSize: {
                width: 240,
                height: 134,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "WVxXWFlVWlxWYFxYYF1ZX1dWYFxcYFtaY2FodW1sgGxtfXJudnJsdnNue3VnhIp1g4JjmoxjsWVnuaebm72BfrVlfa9ZfLZoh8B/lsFul79ZwlljSYxxHpBncZVnk69ifbZbcrJUgKxbh7RYykRVo05Vl0ZNp0dXqVZngGllgJdgdqRIc6dB",
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
                9,
                "WVxXWFlVWlxWYFxYYF1ZX1dWYFxcYFtaY2FodW1sgGxtfXJudnJsdnNue3VnhIp1g4JjmoxjsWVnuaebm72BfrVlfa9ZfLZoh8B/lsFul79ZwlljSYxxHpBncZVnk69ifbZbcrJUgKxbh7RYykRVo05Vl0ZNp0dXqVZngGllgJdgdqRIc6dB",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "wikimedia_france_vs_czech_republic_2013_09_21.avif",
            },
        },
        {
            path: "blender_big_buck_bunny.mp4",
            imagePreviewVideoDuration: 15000,
            imagePreviewSize: {
                width: 100,
                height: 56,
                scale: 1,
            },
            imagePreviewPlaceholder: FileImagePreviewPlaceholder.schema.deserialize([
                false,
                9,
                "/9zd/93d/dze/ujd/+nh6eLY0eTMjamKhp9v/9zU/9vS/9vU/+HX/+3fm6OaeZ9yfZFleIhW7tDS3s3V08raytDJhKR2RGZnVWJeX3ZMW2tJlL5Ql8JNoMNdhLBpVXxDSGlDRlw7TGYzPFIqoa0LkakAmawAmKcNlKoAhqIAhp4OfJQHb4oA",
            ]),
            imagePreviewContent: {
                contentType: "image/avif",
                similarPath: "blender_big_buck_bunny.avif",
            },
        },
    ],
    "audio/mpeg": [
        {
            path: "pokemon_regirock_un_un_un_meme.mp3",
            audioPreviewDuration: 5512,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
        },
    ],
    "audio/wav": [
        {
            path: "pokemon_regirock_un_un_un_meme.wav",
            audioPreviewDuration: 5510,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
        },
    ],
    "audio/webm": [
        {
            path: "pokemon_regirock_un_un_un_meme.weba",
            audioPreviewDuration: 5528,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
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
            // This is a hack but we want to test the unsafe audio processor with a file that
            // doesn't have duration metadata. So pretend our WebM file without metadata is an
            // OGG file. We aren't currently asserting that the container format matches the
            // content type which is why this works.
            path: "pokemon_regirock_un_un_un_meme_without_metadata.weba",
            alternative: {contentType: "audio/webm"},
            audioPreviewDuration: 5510,
        },
    ],
    "audio/mp4": [
        {
            path: "pokemon_regirock_un_un_un_meme_with_aac_audio_codec.m4a",
            audioPreviewDuration: 5512,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
        },
        {
            path: "pokemon_regirock_un_un_un_meme_with_aac_audio_codec_and_moov_atom_at_end.m4a",
            alternative: {contentType: "audio/mp4"},
            audioPreviewDuration: 5510,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
        },
        {
            path: "pokemon_regirock_un_un_un_meme_with_alac_audio_codec.m4a",
            alternative: {contentType: "audio/webm"},
            audioPreviewDuration: 5510,
            audioPreviewMetadata: {title: "Regirock Un Un Un", artist: "Pokémon"},
        },
    ],
};

testFileProcessorContentTypes(context, testCases);
