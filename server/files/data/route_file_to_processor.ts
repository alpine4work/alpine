import {JobDescription} from "~/server/jobs/core/job_description.js";

/**
 * Determines the appropriate processing tier for a file based on routing rules.
 *
 * @param contentType The MIME type of the file
 * @param fileSizeBytes The size of the file in bytes
 * @returns The job type and reason for routing
 */
export function routeFileToProcessor(): {
    jobType: Extract<
        JobDescription["type"],
        "ProcessFileLight" | "ProcessFileHeavy" | "ProcessFile"
    >;
    reason: string;
} {
    // TODO(ifitzsimmons, 2025-09-13, #file-processor-service-migration): Until the service has been
    // migrated, we should always send the file to the current FileProcessor queue
    return {
        jobType: "ProcessFile",
        reason: "Production environment, using default tier `ProcessFile`",
    };
}
