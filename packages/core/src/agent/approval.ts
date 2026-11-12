export interface ApprovalItem {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  /** What would change, e.g. a diff. */
  preview: string;
}

export interface ApprovalRequest {
  runId: string;
  approvalId: string;
  items: ApprovalItem[];
}

/** The user's answer per call. A call that is missing from the answer counts as refused. */
export type ApprovalAnswers = Record<string, 'allow' | 'deny'>;

/**
 * Whoever can ask a person. The run waits on `request`; aborting `signal` must make it reject so a
 * cancelled run does not hang on an answer nobody will give.
 */
export interface Approver {
  request(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswers>;
}

/** The safe default when nobody is available to ask: refuse everything. */
export const denyAllApprover: Approver = {
  request: async () => ({}),
};
