import {
  checkReport,
  describeChecks,
  factsFromEvents,
  MAX_CLAIMS,
  REPORT_TOOL,
  ReportArgs,
} from '@orbit/protocol';

import { defineTool, type Tool } from './tool.js';

/**
 * The tool the agent uses to state its conclusions together with the tool calls that prove them.
 * It changes nothing (risk `read`); its value is the record in the event log and the feedback it
 * returns: claims without real evidence are named, so the agent can fix them or say it did not
 * verify them. The UI recomputes the same check from the log (see `@orbit/protocol` claims).
 */
export function reportTool(): Tool {
  return defineTool({
    name: REPORT_TOOL,
    description:
      'Call this after your last tool call and before your final answer to report your ' +
      'conclusions. Each claim is one fact you verified and ' +
      'lists the ids of the tool calls that prove it. Claims with no valid evidence are shown to ' +
      `the user as unverified. At most ${MAX_CLAIMS} claims.`,
    risk: 'read',
    schema: ReportArgs,
    execute: async (args, context) => {
      const facts = factsFromEvents(context.events?.() ?? []);
      return describeChecks(checkReport(args, facts, context.callId ?? ''));
    },
  });
}
