import {createAwsApp} from "~/admin/aws/aws_app.js";

async function main() {
    const app = await createAwsApp();
    app.synth();
}

main().then(
    () => {
        process.exitCode = 0;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
