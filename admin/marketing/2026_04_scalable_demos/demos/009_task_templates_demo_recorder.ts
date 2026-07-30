import {
    taskTemplatesDemoRecordingHeight,
    taskTemplatesDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/009_task_templates_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session, {
        title: "{{Bot name}}",
        /* eslint-disable cyberworlds/string-quotes */
        notes: `
Duplicate this task and add these items to the database when adding a new bot for a customer.

## Bot

~~~json
{
  "partitionKey": "Bot#{{Bot ID}}",
  "sortKey": "a0#Attributes",
  "createdTime": "{{Created time (ISO 8601)}}",
  "name": "{{Bot name}}",
  "webhookUrl": null
}
~~~

## API key

~~~json
{
  "partitionKey": "ApiKey#{{API key}}",
  "sortKey": "a0#Attributes",
  "botId": "{{Bot ID}}",
  "createdTime": "{{Created time (ISO 8601)}}",
  "index1PartitionKey": "BotApiKeys#{{Bot ID}}",
  "index1SortKey": "0",
  "space": {
    "accountId": "{{Bot ID}}",
    "scope": {"type": "Space"}
  }
}
~~~

## Account

~~~json
{
  "partitionKey": "Account#{{Bot ID}}",
  "sortKey": "a0#Attributes",
  "botId": "{{Bot ID}}",
  "createdTime": "{{Created time (ISO 8601)}}",
  "name": "{{Bot name}}",
  "nameVersion": "0",
  "reactionCharacter": "8"
}
~~~
        `,
        /* eslint-enable cyberworlds/string-quotes */
    });

    await recorder.record({
        instructions: markdown`
This shows how you can turn any task in Alpine into a template. Using a dev ops example. Our text
should focus on how you can create templates by adding \u201C{{Variable}}\u201Ds not specifically
about bot templates or anything like that.

1. Drag the Chrome window so the corner radiuses aren\u2019t visible.

2. Start recording.

3. Duplicate the task.

4. Type \u201CCaleb\u2019s bot\u201D, \u201C123\u201D, \u201C2026-04-20\u201D, and \u201Cabc\u201D.

5. Press duplicate.

6. Scroll the duplicated task a bit.
        `,
        session,
        path: `/task/${task.id}`,
        viewport: {
            width: taskTemplatesDemoRecordingWidth,
            height: taskTemplatesDemoRecordingHeight,
        },
    });
});
