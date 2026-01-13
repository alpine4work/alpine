/* eslint-disable no-template-curly-in-string */
export const cloudwatchAgentConfig = JSON.stringify({
    agent: {
        metrics_collection_interval: 30,
    },
    metrics: {
        append_dimensions: {
            AutoScalingGroupName: "${aws:AutoScalingGroupName}",
            InstanceId: "${aws:InstanceId}",
            InstanceType: "${aws:InstanceType}",
            ImageId: "${aws:ImageId}",
        },
        metrics_collected: {
            mem: {
                measurement: ["total", "used", "used_percent"],
                metrics_collection_interval: 5,
            },
            cpu: {
                measurement: ["usage_idle", "usage_iowait", "usage_system", "usage_user"],
                metrics_collection_interval: 5,
            },
            disk: {
                measurement: ["total", "used", "used_percent", "inodes_used", "inodes_total"],
                metrics_collection_interval: 60,
            },
            swap: {
                measurement: ["free", "used", "used_percent"],
            },
            diskio: {
                measurement: ["reads", "writes", "io_time", "read_time", "write_time"],
            },
            processes: {
                measurement: [
                    "running",
                    "blocked",
                    "dead",
                    "idle",
                    "sleeping",
                    "total",
                    "total_threads",
                ],
                metrics_collection_interval: 5,
            },
        },
    },
    logs: {
        logs_collected: {
            files: {
                collect_list: [
                    {
                        file_path: "/var/log/messages",
                        log_group_name: "/ec2/{instance_id}/messages",
                        timezone: "UTC",
                    },
                    {
                        file_path:
                            "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log",
                        log_group_name: "/ec2/{instance_id}/amazon-cloudwatch-agent",
                        timezone: "UTC",
                    },
                ],
            },
        },
    },
});
