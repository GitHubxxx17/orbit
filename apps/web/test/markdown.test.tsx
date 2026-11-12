import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/components/markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

// The text comes from a model and can repeat anything it read in a file, so what it renders to
// must never be able to run script.
describe('Markdown', () => {
  it('renders ordinary Markdown', () => {
    const html = render('# Title\n\nSome **bold** text and `code`.\n\n- one\n- two');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('<li');
  });

  it('shows raw HTML as text instead of running it', () => {
    const html = render('before <script>alert(1)</script> <img src=x onerror=alert(1)> after');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a javascript: link target', () => {
    const html = render('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('opens real links safely in a new tab', () => {
    const html = render('[docs](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });

  it('renders a fenced block with its language and a copy button', () => {
    const html = render('```ts\nconst a = 1;\n```');
    expect(html).toContain('const a = 1;');
    expect(html).toContain('>ts<');
    expect(html).toContain('aria-label="复制代码"');
  });

  it('renders a GFM table', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
  });
});
