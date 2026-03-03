/**
 * Maximum size for a file uploaded to our service: 1 GB. This is the same maximum
 * file size as Slack.
 */
export const maxFileContentLength = 1e9;

/**
 * Maximum size for a file multipart upload part is 100 MB. This is the [Cloudflare
 * Workers request body limit][1].
 *
 * [1]: https://developers.cloudflare.com/workers/platform/limits
 */
export const maxFileMultipartUploadPartContentLength = 1e8;

/**
 * If a file processor doesn't finish processing within this amount of time, we
 * abort the file processor.
 */
export const fileProcessorTimeoutMs = 1000 * 60 * 5;
