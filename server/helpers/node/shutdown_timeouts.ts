/**
 * Timeout constants for graceful shutdown. These timeouts are ordered from
 * shortest to longest and each should be longer than the previous to allow proper
 * cascading shutdown.
 *
 * The chain is:
 *
 * 1. HTTP server stops accepting new connections and drains existing ones (2
 *    minutes)
 * 2. ECS sends SIGTERM and waits before force-killing the container (2 minutes)
 * 3. Shutdown manager timeout is longer but ECS will force-kill first (5 minutes,
 *    mostly relevant for tests)
 */

/**
 * ECS stop timeout configured in most task definitions. ECS sends SIGTERM and
 * waits this long before sending SIGKILL.
 *
 * Used by `stopTimeout` in:
 *
 * - admin/aws/internal/create_aws_app_or_api_service.ts
 * - admin/aws/internal/aws_job_queue_service.ts
 * - admin/aws/internal/aws_task_realtime_service.ts
 *
 * By default, ECS sends SIGTERM and waits 30 seconds before sending SIGKILL [1].
 * It's a little hard to find documentation on this, but it looks like the max
 * timeout is 2 minutes [2].
 *
 * [1]: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html
 * [2]:
 *     https://docs.aws.amazon.com/sdk-for-swift/latest/api/awsecs/documentation/awsecs/ecsclienttypes/containerdefinition/stoptimeout/
 */
export const ecsStopTimeoutMs = 2 * 60 * 1000; // 2 minutes

/**
 * Timeout for HTTP server graceful shutdown. The server will force-close
 * connections if they haven't finished within this time. Intentionally slightly
 * shorter than `ecsStopTimeoutMs` to allow the server to perform any hard shutdown
 * itself before ECS kills the process.
 */
export const httpServerGracefulForceShutdownTimeoutMs = ecsStopTimeoutMs - 10000; // 2 minutes, less 10 seconds

/**
 * Timeout for the shutdown manager to wait for all shutdown listeners and
 * `waitUntil()` promises to resolve. After this timeout, the process will exit
 * with an error.
 *
 * NOTE: This is currently longer than the ECS stop timeout, so ECS may force-kill
 * the container before this timeout is reached.
 */
export const shutdownManagerTimeoutMs = 5 * 60 * 1000; // 5 minutes
