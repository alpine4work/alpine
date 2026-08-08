import {ApiMessageStreamPartPayload} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

export type MockAgentRecording = ReadonlyArray<MockAgentRecordingAction>;

export type MockAgentRecordingAction =
    | {
          readonly type: "Wait";
          readonly milliseconds: number;
      }
    | {
          readonly type: "Ping";
      }
    | {
          readonly type: "PutPart";
          readonly index: number;
          readonly payload: ApiMessageStreamPartPayload;
      };
