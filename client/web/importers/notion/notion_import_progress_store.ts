import {getFileContentTypeThroughputBytesPerMs} from "~/client/web/content/estimate_process_file_duration_ms.js";
import {ProgressValueStore} from "~/client/web/content/progress_store.js";
import {LocalNotionImportItem} from "~/client/web/importers/notion/notion_import_types.js";
import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {Locale} from "~/shared/helpers/intl/locale.open_source.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Our result of getFileContentTypeThroughputBytesPerMs is estimated for single
 * uploads. Our importer batches most files, but some may be processed
 * consecutively. This multiplier is a really bad estimate of how much longer the
 * importer will take vs individual uploads. We've come to this number through very
 * loose manual testing.
 */
const estimateRemainingDurationImporterRatio = 1.75;

export interface NotionImportProgressEstimate {
    /** Human-readable time remaining, e.g. "About 3 minutes remaining". */
    timeRemainingDisplay: string | null;
    /** Human-readable elapsed time, e.g. "5 minutes 30 seconds". */
    timeElapsedDisplay: string | null;
    /** Overall completion percentage from 0 to 100. */
    percentComplete: number;
}

/**
 * Manages smooth, optimistic progress animation for a Notion import.
 *
 * Wraps a `ProgressValueStore` so the progress bar eases forward between server
 * poll updates instead of jumping in discrete steps. Call `update(item)` whenever
 * new poll data arrives; subscribe to `estimate` to get the reactive
 * `NotionImportProgressEstimate`.
 *
 * This is not incredibly accurate as to the "real" progress of the import. It's a
 * very rough estimate that is meant to be a good enough approximation for the
 * user.
 */
export class NotionImportProgressStore {
    private readonly _progressStore = new ProgressValueStore();
    private readonly _displayStore = new ValueStore<{
        timeRemainingDisplay: string | null;
        timeElapsedDisplay: string | null;
    } | null>(null);

    /**
     * Reactive store that emits `NotionImportProgressEstimate` values with a smoothly
     * animated `percentComplete`.
     */
    readonly estimate: Store<NotionImportProgressEstimate | null>;

    private readonly _locale: Locale;

    constructor(locale: Locale) {
        this.estimate = computeStore(get => {
            const display = get(this._displayStore);
            if (!display) return null;

            const percent = get(this._progressStore);
            return {
                percentComplete: Math.round(percent * 100),
                timeRemainingDisplay: display.timeRemainingDisplay,
                timeElapsedDisplay: display.timeElapsedDisplay,
            };
        });

        this._locale = locale;
    }

    /**
     * Stop the progress animation. Cancels any in-progress easing and clears the
     * display so `estimate` emits `null`.
     */
    stop(): void {
        this._progressStore.cancelEase();
        this._displayStore.set(null);
    }

    /**
     * Feed new poll data into the store. Snaps the progress to the real server value,
     * then re-eases toward completion over the estimated remaining duration.
     */
    update(item: LocalNotionImportItem): void {
        if (
            item.status.type === "UploadPending" ||
            item.status.type === "ValidateQueued" ||
            item.status.type === "Validating"
        ) {
            return;
        }

        const progress = aggregateNotionImportProgress(item.status.result);
        const {totalWeight, completedWeight} = computeNotionImportWeights(progress);

        const percentFraction = totalWeight === 0 ? 0 : completedWeight / totalWeight;

        const isProcessing =
            item.status.type === "Processing" || item.status.type === "ProcessQueued";

        const isTerminal = item.status.type === "Success" || item.status.type === "Failed";

        if (isTerminal) {
            this._progressStore.set(1);
        } else {
            // Snap to real progress (ProgressValueStore guarantees non-decreasing).
            this._progressStore.set(percentFraction);

            const remainingMs = estimateRemainingDurationMs(
                progress,
                completedWeight,
                totalWeight,
                item,
                isProcessing,
            );

            if (remainingMs > 0) {
                this._progressStore.ease(remainingMs, percentFraction, 0.99);
            }
        }

        // Update the human-readable display strings.
        const elapsedMs = computeElapsedMs(item, isProcessing, isTerminal);
        const timeElapsedDisplay =
            elapsedMs !== null && elapsedMs > 0
                ? formatDuration(this._locale, elapsedMs / 1000)
                : null;

        const timeRemainingDisplay = isTerminal ? null : estimateTimeRemaining(progress);

        this._displayStore.set({timeRemainingDisplay, timeElapsedDisplay});
    }
}

interface AggregatedFileStats {
    contentType: FileContentType;
    expectedCount: number;
    size: number;
    uploaded: number;
}

/**
 * Aggregates per-mimetype file statistics across all teamspaces into a single flat
 * list.
 */
function aggregateNotionImportProgress(
    result: NotionImportProcessingOrDoneResult,
): Array<AggregatedFileStats> {
    const totals = new Map<string, {expectedCount: number; size: number; uploaded: number}>();

    for (const stats of result.teamspaces.values()) {
        for (const [contentType, fileStats] of stats.files.entries()) {
            const existing = totals.get(contentType);
            if (existing) {
                existing.expectedCount += fileStats.expectedCount;
                existing.size += fileStats.size;
                existing.uploaded += fileStats.imported;
            } else {
                totals.set(contentType, {
                    expectedCount: fileStats.expectedCount,
                    size: fileStats.size,
                    uploaded: fileStats.imported,
                });
            }
        }
    }

    const result_: Array<AggregatedFileStats> = [];
    for (const [contentType, stats] of totals.entries()) {
        result_.push({contentType: contentType as FileContentType, ...stats});
    }
    return result_;
}

function computeElapsedMs(
    item: LocalNotionImportItem,
    isProcessing: boolean,
    isTerminal: boolean,
): number | null {
    if (!item.startedProcessingTime) return null;
    const start = item.startedProcessingTime.getTime();

    if (isProcessing) return Date.now() - start;
    if (isTerminal) return item.updatedTime.getTime() - start;
    return null;
}

/**
 * Computes time-weighted total and completed weights across all file types.
 * Weights by _estimated processing duration_ per mimetype rather than raw byte
 * size so that slow-to-process media doesn't inflate the percentage.
 */
function computeNotionImportWeights(progress: Array<AggregatedFileStats>) {
    let totalWeight = 0;
    let completedWeight = 0;

    for (const {contentType, expectedCount, size, uploaded} of progress) {
        if (expectedCount === 0) continue;

        const throughput = getFileContentTypeThroughputBytesPerMs(contentType);
        let estimatedDuration = (size / throughput) * estimateRemainingDurationImporterRatio;

        // Small files are processed in parallel, so we don't need to weight them as
        // heavily. This is a rough estimate.
        if (size < 1000 * 1024 * 1024) {
            estimatedDuration = estimatedDuration * 0.25;
        }

        totalWeight += estimatedDuration;
        completedWeight += estimatedDuration * (Math.min(uploaded, expectedCount) / expectedCount);
    }

    return {totalWeight, completedWeight};
}

/**
 * Estimates time remaining using per-mimetype processing rates. Sums the estimated
 * duration for the remaining items in each category, scaled by the fraction
 * remaining.
 */
function estimateTimeRemaining(progress: Array<AggregatedFileStats>): string | null {
    let totalRemainingMs = 0;

    for (const {contentType, size, expectedCount, uploaded} of progress) {
        const remaining = expectedCount - uploaded;
        if (remaining <= 0 || expectedCount === 0) continue;
        const throughput = getFileContentTypeThroughputBytesPerMs(contentType);
        totalRemainingMs += (size / throughput) * (remaining / expectedCount);
    }

    if (totalRemainingMs <= 0) return null;
    return formatTimeRemainingSeconds(totalRemainingMs / 1000);
}

function formatTimeRemainingSeconds(seconds: number): string | null {
    if (seconds < 0) return null;
    if (seconds < 60) return "Less than a minute remaining";

    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) {
        return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} remaining`;
    }

    const hours = Math.floor(minutes / 60);
    const leftoverMinutes = minutes % 60;
    if (leftoverMinutes === 0) {
        return `About ${hours} ${hours === 1 ? "hour" : "hours"} remaining`;
    }
    return `About ${hours}h ${leftoverMinutes}m remaining`;
}

/**
 * Formats a duration in seconds into a human-readable string using full words.
 */
function formatDuration(locale: Locale, totalSeconds: number): string {
    const totalClamped = Math.max(1, totalSeconds);
    const seconds = Math.floor(totalClamped) % 60;
    const minutes = Math.floor(totalClamped / 60) % 60;
    const hours = Math.floor(totalClamped / 3600);

    const p = (n: number, label: string) => printPrettyNumber(locale, n, label);
    if (hours > 0) return `${p(hours, "hour")} ${p(minutes, "minute")}`;
    if (minutes >= 2) return p(minutes, "minute");
    if (minutes > 0) return `${p(minutes, "minute")} ${p(seconds, "second")}`;
    return p(seconds, "second");
}

/**
 * Estimates how many milliseconds remain for the import to finish.
 */
function estimateRemainingDurationMs(
    progress: Array<AggregatedFileStats>,
    completedWeight: number,
    totalWeight: number,
    item: LocalNotionImportItem,
    isProcessing: boolean,
): number {
    const elapsedMs =
        isProcessing && item.startedProcessingTime
            ? Date.now() - item.startedProcessingTime.getTime()
            : null;

    // Throughput-based estimate.
    if (completedWeight > 0 && elapsedMs !== null && elapsedMs > 0) {
        const remainingWeight = totalWeight - completedWeight;
        const bytesPerMs = completedWeight / elapsedMs;
        return remainingWeight / bytesPerMs;
    }

    // Static per-mimetype estimate, scaled by fraction remaining.
    let totalMs = 0;

    for (const {contentType, size, expectedCount, uploaded} of progress) {
        const remaining = expectedCount - uploaded;
        if (remaining <= 0 || expectedCount === 0) continue;
        const throughput = getFileContentTypeThroughputBytesPerMs(contentType);

        // This is very much magic number and should probably be replaced with a more
        // accurate estimate. We've observed that video processing is a lot faster on our
        // beefy fargate instances than our file processor instances.
        const adjustedThroughput = contentType.startsWith("video/") ? throughput * 4 : throughput;

        totalMs += (size / adjustedThroughput) * (remaining / expectedCount);
    }

    return totalMs * estimateRemainingDurationImporterRatio;
}
