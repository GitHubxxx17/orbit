import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AgentInput, AgentList, AgentProfile, ToolInfo } from '@orbit/protocol';
import { z } from 'zod';

/** A request the user can fix: an unknown tool, a missing model, an empty name. */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

/** The id of the agent that is always there. */
export const DEFAULT_AGENT_ID = 'default';

const BUILTIN: AgentProfile = {
  id: DEFAULT_AGENT_ID,
  name: '默认智能体',
  description: '使用全部工具和默认提示词',
  instructions: '',
  modelId: null,
  tools: null,
  builtin: true,
};

const StoredAgent = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  instructions: z.string(),
  modelId: z.string().nullable(),
  tools: z.array(z.string()).nullable(),
});
type StoredAgent = z.infer<typeof StoredAgent>;

const AgentsFile = z.object({ agents: z.array(StoredAgent) });

/**
 * Agent profiles in one JSON file. They hold no secrets (a model is referred to by id), but the
 * file is still private to the current user and written through a temp file.
 */
export class AgentStore {
  constructor(private readonly file: string) {}

  read(): StoredAgent[] {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return AgentsFile.parse(raw).agents;
    } catch {
      return [];
    }
  }

  write(agents: StoredAgent[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

export interface AgentManagerOptions {
  store: AgentStore;
  /** The tools that exist now; a profile may only name these. */
  tools: () => ToolInfo[];
  /** Whether a saved model with this id exists. */
  hasModel: (id: string) => boolean;
  newId?: () => string;
}

/** What a run needs from a profile. */
export interface ResolvedAgent {
  id: string;
  name: string;
  instructions: string;
  modelId: string | null;
  tools: string[] | null;
  builtin: boolean;
}

const asProfile = (agent: StoredAgent): AgentProfile => ({ ...agent, builtin: false });

/** The agent profiles: the built-in one first, then the user's own. */
export class AgentManager {
  constructor(private readonly options: AgentManagerOptions) {}

  list(): AgentList {
    return { agents: [BUILTIN, ...this.options.store.read().map(asProfile)] };
  }

  /** The profile for a run; the built-in one when no id is given. Undefined for an unknown id. */
  resolve(id?: string): ResolvedAgent | undefined {
    return this.list().agents.find((agent) => agent.id === (id ?? DEFAULT_AGENT_ID));
  }

  /** The tools an agent can be given, for the editor. */
  tools(): ToolInfo[] {
    return this.options.tools();
  }

  /** Add an agent (`id` omitted) or change one. */
  save(id: string | undefined, input: AgentInput): AgentList {
    const stored = this.options.store.read();
    if (id === DEFAULT_AGENT_ID) throw new AgentError('内置智能体不能修改');
    const existing = id === undefined ? undefined : stored.find((agent) => agent.id === id);
    if (id !== undefined && !existing) throw new AgentError('找不到这个智能体');

    const tools = input.tools ?? null;
    if (tools) {
      const known = new Set(this.options.tools().map((tool) => tool.name));
      const unknown = tools.filter((name) => !known.has(name));
      if (unknown.length > 0) throw new AgentError(`没有这些工具：${unknown.join('、')}`);
    }
    const modelId = input.modelId ?? null;
    if (modelId !== null && !this.options.hasModel(modelId)) {
      throw new AgentError('找不到所选的模型');
    }

    const saved: StoredAgent = {
      id: existing?.id ?? (this.options.newId ?? randomUUID)(),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      instructions: input.instructions?.trim() ?? '',
      modelId,
      tools: tools ? [...new Set(tools)] : null,
    };
    this.options.store.write(
      existing
        ? stored.map((agent) => (agent.id === saved.id ? saved : agent))
        : [...stored, saved],
    );
    return this.list();
  }

  remove(id: string): AgentList {
    if (id === DEFAULT_AGENT_ID) throw new AgentError('内置智能体不能删除');
    const stored = this.options.store.read();
    if (!stored.some((agent) => agent.id === id)) throw new AgentError('找不到这个智能体');
    this.options.store.write(stored.filter((agent) => agent.id !== id));
    return this.list();
  }
}
