import type { RiskLevel } from '@orbit/protocol';

export interface PolicyRequest {
  tool: string;
  risk: RiskLevel;
  args: Record<string, unknown>;
}

/** Decide whether a tool call may run. Must be pure and synchronous so decisions are replayable. */
export type Policy = (request: PolicyRequest) => 'allow' | 'deny';

/** The default: read-only tools run freely, everything else is refused. */
export const readOnlyPolicy: Policy = ({ risk }) => (risk === 'read' ? 'allow' : 'deny');
