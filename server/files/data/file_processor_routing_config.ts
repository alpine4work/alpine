import {
    FileContentType,
    getFileAudioContentTypes,
    getFileMicrosoftOfficeContentTypes,
    getFileVideoContentTypes,
    isFileWebSafeAudioContentType,
} from "~/shared/files/file_content_type.open_source.js";
/**
 * Configuration for routing files to appropriate processor tiers.
 */
export interface FileProcessorRoutingRule {
    readonly name: string;
    readonly priority: number; // Lower = higher priority (rules evaluated in order)
    readonly condition: {
        readonly contentTypes?: ReadonlySet<FileContentType>;
        readonly maxFileSize?: number;
        readonly minFileSize?: number;
    };
    readonly target: "ProcessFileLight" | "ProcessFileHeavy";
}
export interface FileProcessorRoutingConfig {
    readonly defaultJobType: "ProcessFileLight" | "ProcessFileHeavy";
    readonly rules: ReadonlyArray<FileProcessorRoutingRule>;
}

const oneMb = 1024 * 1024;
const tenMb = 10 * oneMb;
const twentyFiveMb = 25 * oneMb;
const fiftyMb = 50 * oneMb;
const oneHundredMb = 100 * oneMb;

/**
 * File processor routing configuration.
 *
 * Rules are evaluated in priority order (lower number = higher priority). First
 * matching rule determines the target tier. If no rules match, defaultTier is
 * used.
 *
 * Strategy: Define heavy compute scenarios and default to lightweight. This covers
 * ~10 heavy compute scenarios vs ~60+ lightweight scenarios.
 */
// TODO(ifizsimmons, 2025-07-30): Consider moving to DynamoDB for runtime updates
// without deployment.
export const fileProcessorRoutingConfig: FileProcessorRoutingConfig = {
    defaultJobType: "ProcessFileLight",
    rules: [
        {
            // Large files (>100MB, Multipart Upload Limit) always need heavy compute resources
            name: "large_files_always_heavy",
            priority: 1,
            condition: {
                minFileSize: oneHundredMb,
            },
            target: "ProcessFileHeavy",
        },
        {
            // Video files require transcoding with heavy compute
            name: "video_files_heavy",
            priority: 2,
            condition: {
                contentTypes: new Set(getFileVideoContentTypes()),
            },
            target: "ProcessFileHeavy",
        },
        {
            // Microsoft Office documents require LibreOffice conversion
            name: "microsoft_office_heavy",
            priority: 3,
            condition: {
                contentTypes: new Set(getFileMicrosoftOfficeContentTypes()),
            },
            target: "ProcessFileHeavy",
        },
        {
            // Web-unsafe audio files requiring transcoding need heavy compute
            name: "web_unsafe_audio_transcoding_heavy",
            priority: 4,
            condition: {
                // ["audio/ogg", "audio/mp4"],
                contentTypes: new Set(
                    getFileAudioContentTypes().filter(
                        contentType => !isFileWebSafeAudioContentType(contentType),
                    ),
                ),
            },
            target: "ProcessFileHeavy",
        },
        {
            // Web-safe audio above the old preview limit needs heavy compute.
            name: "large_web_safe_audio_heavy",
            priority: 5,
            condition: {
                contentTypes: new Set(
                    getFileAudioContentTypes().filter(contentType =>
                        isFileWebSafeAudioContentType(contentType),
                    ),
                ),
                minFileSize: fiftyMb,
            },
            target: "ProcessFileHeavy",
        },
        {
            // Metadata analysis lowers the safe web-audio light processor limit.
            name: "analysis_web_safe_audio_heavy",
            priority: 6,
            condition: {
                contentTypes: new Set(
                    getFileAudioContentTypes().filter(contentType =>
                        isFileWebSafeAudioContentType(contentType),
                    ),
                ),
                minFileSize: twentyFiveMb + 1,
            },
            target: "ProcessFileHeavy",
        },
        {
            // Large PDFs (>10MB) need heavy compute for processing
            name: "large_pdf_heavy",
            priority: 7,
            condition: {
                contentTypes: new Set(["application/pdf"]),
                minFileSize: tenMb,
            },
            target: "ProcessFileHeavy",
        },
    ],
};
