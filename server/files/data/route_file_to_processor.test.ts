import {routeFileToProcessor} from "~/server/files/data/route_file_to_processor.js";
import {FileContentType} from "~/shared/files/file_content_type.js";

const oneKb = 1024;
const oneMb = 1024 * oneKb;
const tenMb = 10 * oneMb;
const fiftyMb = 50 * oneMb;
const oneHundredMb = 100 * oneMb;

describe("routeFileToProcessor", () => {
    describe("large files rule", () => {
        test("routes large files (>100MB) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "text/plain",
                contentLength: oneHundredMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_files_always_heavy");
        });

        test("routes files exactly at 100MB threshold to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "text/plain",
                contentLength: oneHundredMb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_files_always_heavy");
        });

        test("routes files just under 100MB to light compute by default", () => {
            const result = routeFileToProcessor({
                contentType: "text/plain",
                contentLength: oneHundredMb - oneMb,
            });

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });
    });

    describe("video files rule", () => {
        test("routes webm video files to heavy compute", () => {
            const result = routeFileToProcessor({contentType: "video/webm", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });

        test("routes mp4 video files to heavy compute", () => {
            const result = routeFileToProcessor({contentType: "video/mp4", contentLength: 1});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });

        test("routes quicktime video files to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "video/quicktime",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });

        test("routes mpeg video files to heavy compute", () => {
            const result = routeFileToProcessor({contentType: "video/mpeg", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });

        test("routes matroska video files to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "video/x-matroska",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });
    });

    describe("Microsoft Office files rule", () => {
        test("routes Word documents to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/msword",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });

        test("routes Excel spreadsheets to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/vnd.ms-excel",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });

        test("routes PowerPoint presentations to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/vnd.ms-powerpoint",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });

        test("routes modern Word documents (.docx) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });

        test("routes modern Excel spreadsheets (.xlsx) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });

        test("routes modern PowerPoint presentations (.pptx) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("microsoft_office_heavy");
        });
    });

    describe("audio transcoding rule", () => {
        test("routes OGG audio files to heavy compute", () => {
            const result = routeFileToProcessor({contentType: "audio/ogg", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("web_unsafe_audio_transcoding_heavy");
        });

        test("routes MP4 audio files to heavy compute", () => {
            const result = routeFileToProcessor({contentType: "audio/mp4", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("web_unsafe_audio_transcoding_heavy");
        });
    });

    describe("large web-safe audio rule", () => {
        test("routes large MP3 files (>50MB) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "audio/mpeg",
                contentLength: fiftyMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_web_safe_audio_heavy");
        });

        test("routes large WAV files (>50MB) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "audio/wav",
                contentLength: fiftyMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_web_safe_audio_heavy");
        });

        test("routes large WebM audio files (>50MB) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "audio/webm",
                contentLength: fiftyMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_web_safe_audio_heavy");
        });

        test("routes small MP3 files (<50MB) to light compute", () => {
            const result = routeFileToProcessor({
                contentType: "audio/mpeg",
                contentLength: fiftyMb - oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("routes audio files exactly at 50MB threshold to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "audio/mpeg",
                contentLength: fiftyMb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_web_safe_audio_heavy");
        });
    });

    describe("large PDF rule", () => {
        test("routes large PDF files (>10MB) to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/pdf",
                contentLength: tenMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_pdf_heavy");
        });

        test("routes small PDF files (<10MB) to light compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/pdf",
                contentLength: tenMb - oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("routes PDFs exactly at 10MB threshold to heavy compute", () => {
            const result = routeFileToProcessor({
                contentType: "application/pdf",
                contentLength: tenMb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_pdf_heavy");
        });
    });

    describe("rule priority", () => {
        test("large file rule takes precedence over other rules", () => {
            // Large video file should be routed due to size, not content type
            const result = routeFileToProcessor({
                contentType: "video/mp4",
                contentLength: oneHundredMb + oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_files_always_heavy");
        });

        test("video rule takes precedence over audio transcoding rule for MP4", () => {
            // MP4 could be either video or audio, but video rule has higher priority
            const result = routeFileToProcessor({contentType: "video/mp4", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("video_files_heavy");
        });
    });

    describe("default behavior", () => {
        test("routes unknown content types to light compute by default", () => {
            const result = routeFileToProcessor({
                contentType: "application/octet-stream" as FileContentType,
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("routes image files to light compute by default", () => {
            const result = routeFileToProcessor({contentType: "image/jpeg", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("routes text files to light compute by default", () => {
            const result = routeFileToProcessor({contentType: "text/plain", contentLength: oneKb});

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("routes code files to light compute by default", () => {
            const result = routeFileToProcessor({
                contentType: "text/javascript",
                contentLength: oneKb,
            });

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });
    });

    describe("edge cases", () => {
        test("handles zero file size", () => {
            const result = routeFileToProcessor({contentType: "text/plain", contentLength: 0});

            expect(result.jobType).toEqual("ProcessFileLight");
            expect(result.reason).toEqual("default");
        });

        test("handles very large file size", () => {
            const result = routeFileToProcessor({
                contentType: "text/plain",
                contentLength: Number.MAX_SAFE_INTEGER,
            });

            expect(result.jobType).toEqual("ProcessFileHeavy");
            expect(result.reason).toEqual("large_files_always_heavy");
        });
    });
});
