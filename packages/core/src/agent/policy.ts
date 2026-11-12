import path from 'node:path';

import { RiskLevel } from '@orbit/protocol';
import { z } from 'zod';

export type PolicyDecision = 'allow' | 'ask' | 'deny';

export interface PolicyRequest {
  tool: string;
  risk: RiskLevel;
  args: Record<string, unknown>;
}

/**
 * Decide whether a tool call may run: `allow` runs it, `deny` refuses it, `ask` pauses the run
 * until the user decides. Must be pure and synchronous so decisions are replayable.
 */
export type Policy = (request: PolicyRequest) => PolicyDecision;

/** Read-only tools run freely, everything else is refused. Used when nothing else is configured. */
export const readOnlyPolicy: Policy = ({ risk }) => (risk === 'read' ? 'allow' : 'deny');

// --- declarative rules -------------------------------------------------------------------------

/**
 * One rule. A rule applies when every matcher it lists matches; a matcher left out matches
 * anything. Rules are read top to bottom and the first one that applies decides.
 */
export const PolicyRule = z.object({
  id: z.string().min(1),
  /** Tool names, e.g. ["write_file"]. */
  tools: z.array(z.string().min(1)).min(1).optional(),
  risks: z.array(RiskLevel).min(1).optional(),
  /** Globs matched against the call's `path` argument (`*` within a folder, `**` across folders). */
  paths: z.array(z.string().min(1)).min(1).optional(),
  action: z.enum(['allow', 'ask', 'deny']),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyConfig = z.object({
  rules: z.array(PolicyRule),
  /** What happens when no rule applies. Refusing is the safe default. */
  fallback: z.enum(['ask', 'deny']).default('deny'),
});
export type PolicyConfig = z.input<typeof PolicyConfig>;

/** Read freely, ask before writing, refuse the rest. */
export const defaultPolicyConfig: PolicyConfig = {
  rules: [
    { id: 'read-auto', risks: ['read'], action: 'allow' },
    { id: 'write-ask', risks: ['write'], action: 'ask' },
  ],
  fallback: 'deny',
};

/** Turn a glob into a regular expression over `/`-separated workspace paths. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?'; // "**/" also matches no folder at all
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * The call's `path` argument as a clean workspace-relative path, or null when there is none or it
 * leaves the workspace. Cleaning matters: "docs/../src/a.ts" must not satisfy a "docs/**" rule.
 */
export function pathOf(args: Record<string, unknown>): string | null {
  const value = args['path'];
  if (typeof value !== 'string' || value === '') return null;
  const clean = path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
  if (clean === '..' || clean.startsWith('../') || path.posix.isAbsolute(clean)) return null;
  return clean;
}

function matches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (rule.tools && !rule.tools.includes(request.tool)) return false;
  if (rule.risks && !rule.risks.includes(request.risk)) return false;
  if (rule.paths) {
    const target = pathOf(request.args);
    if (target === null) return false;
    if (!rule.paths.some((glob) => globToRegExp(glob).test(target))) return false;
  }
  return true;
}

/**
 * Build a policy from rules. Two things are fixed in code and cannot be changed by configuration:
 * a `dangerous` call is always refused, and an `allow` rule never applies to one.
 */
export function createPolicy(input: PolicyConfig): Policy {
  const config = PolicyConfig.parse(input);
  return (request) => {
    if (request.risk === 'dangerous') return 'deny';
    const rule = config.rules.find((candidate) => matches(candidate, request));
    return rule ? rule.action : config.fallback;
  };
}
