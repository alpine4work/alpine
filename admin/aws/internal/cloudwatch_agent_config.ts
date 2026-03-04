/* eslint-disable no-template-curly-in-string */
export const cloudwatchAgentConfig = JSON.stringify({
    agent: {
        metrics_collection_interval: 10,
    },
    metrics: {
        append_dimensions: {
            AutoScalingGroupName: "${aws:AutoScalingGroupName}",
            InstanceId: "${aws:InstanceId}",
        },
        aggregation_dimensions: [["AutoScalingGroupName"]],
        metrics_collected: {
            mem: {
                measurement: ["total", "used", "used_percent"],
                metrics_collection_interval: 5,
            },
            disk: {
                measurement: ["used_percent", "inodes_free"],
                metrics_collection_interval: 20,
                resources: ["/"],
            },
            swap: {
                measurement: ["used_percent"],
            },
        },
    },
    logs: {
        logs_collected: {
            files: {
                collect_list: [
                    {
                        file_path: "/var/log/messages",
                        log_group_name: "/ec2/instance/messages",
                        timezone: "UTC",
                        retention_in_days: 14,
                    },
                    {
                        file_path: "/var/log/syslog",
                        log_group_name: "/ec2/instance/syslog",
                        timezone: "UTC",
                        retention_in_days: 14,
                    },
                    {
                        file_path:
                            "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log",
                        log_group_name: "/ec2/instance/amazon-cloudwatch-agent",
                        timezone: "UTC",
                        retention_in_days: 14,
                    },
                    {
                        file_path: "/var/log/ecs/ecs-init.log",
                        log_group_name: "/ec2/instance/ecs-agent",
                        timezone: "UTC",
                        retention_in_days: 14,
                    },
                ],
            },
        },
    },
});
