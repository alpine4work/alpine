import {
    FileProcessorRoutingRule,
    fileProcessorRoutingConfig,
} from "~/server/files/data/file_processor_routing_config.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {FileContentType} from "~/shared/files/file_content_type.js";

// Sort rules by priority (lower number = higher priority)
const sortedRules = [...fileProcessorRoutingConfig.rules].sort((a, b) => a.priority - b.priority);

/**
 * Determines the appropriate processing tier for a file based on routing rules.
 *
 * @param contentType The MIME type of the file @param fileSizeBytes The size of
 * the file in bytes @returns The job type and reason for routing
 */
export function routeFileToProcessor(file: {contentType: FileContentType; contentLength: number}): {
    jobType: Extract<JobDescription["type"], "ProcessFileLight" | "ProcessFileHeavy">;
    reason: string;
} {
    // Find the first matching rule
    for (const rule of sortedRules) {
        if (ruleMatches(rule, file)) {
            return {
                jobType: rule.target,
                reason: rule.name,
            };
        }
    }

    // No rules matched, use default tier
    return {
        jobType: fileProcessorRoutingConfig.defaultJobType,
        reason: "default",
    };
}

/**
 * Checks if a routing rule matches the given file characteristics.
 */
function ruleMatches(
    rule: FileProcessorRoutingRule,
    file: {contentType: FileContentType; contentLength: number},
): boolean {
    const {condition} = rule;

    // Check content type match
    if (condition.contentTypes && !condition.contentTypes.has(file.contentType)) {
        return false;
    }

    // Check file size constraints
    if (condition.minFileSize !== undefined && file.contentLength < condition.minFileSize) {
        return false;
    }

    if (condition.maxFileSize !== undefined && file.contentLength > condition.maxFileSize) {
        return false;
    }

    // All conditions matched
    return true;
}
