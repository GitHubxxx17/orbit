import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { ChatSection } from '@/components/chat-section';
import { AppearanceSection } from '@/components/appearance-section';
import { McpSection } from '@/components/mcp-section';
import { ModelsSection } from '@/components/models-section';
import { Button } from '@/components/ui/button';
import type { Appearance } from '@/lib/appearance';
import type { Preferences } from '@/lib/preferences';

interface Props {
  onBack: () => void;
  /** The saved models changed; the app should read the server info and model list again. */
  onChanged: () => void;
  appearance: Appearance;
  onAppearance: (appearance: Appearance) => void;
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
}

const SECTIONS = [
  { id: 'model', label: '模型' },
  { id: 'appearance', label: '外观' },
  { id: 'chat', label: '聊天' },
  { id: 'mcp', label: 'MCP' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsView({
  onBack,
  onChanged,
  appearance,
  onAppearance,
  preferences,
  onPreferences,
}: Props) {
  const [section, setSection] = useState<SectionId>('model');

  return (
    <div className="flex h-screen bg-background text-foreground">
      <nav aria-label="设置" className="flex w-60 shrink-0 flex-col border-r bg-sidebar p-3">
        <Button variant="ghost" className="mb-3 w-full justify-start" onClick={onBack}>
          <ArrowLeft aria-hidden data-icon="inline-start" />
          返回
        </Button>
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
            className={`rounded-lg px-2.5 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              section === id
                ? 'bg-muted font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'mcp' && <McpSection />}
      {section === 'appearance' && (
        <AppearanceSection appearance={appearance} onChange={onAppearance} />
      )}
      {section === 'chat' && <ChatSection preferences={preferences} onChange={onPreferences} />}
      {section === 'model' && <ModelsSection onChanged={onChanged} />}
    </div>
  );
}
