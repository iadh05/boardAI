// M1-15: records raw streaming responses from Ollama's OpenAI-compatible endpoint, byte for byte,
// so the ai-gateway (M1-16) can be tested against what the provider really sends — no network.
//
//   node scripts/record-fixture.ts [model]   (default qwen3.5:9b; writes scripts/fixtures/*.sse)
//
// Needs a running Ollama — never part of `pnpm test`.

import { mkdirSync, writeFileSync } from 'node:fs';

const model = process.argv[2] ?? 'qwen3.5:9b';
const dir = new URL('./fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

const tools = [
  {
    type: 'function',
    function: {
      name: 'add_node',
      description: 'Propose a new component on the board.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['api', 'cache', 'database', 'queue', 'service'] },
          label: { type: 'string' },
          near: { type: 'string' },
        },
        required: ['kind', 'label'],
      },
    },
  },
];

const messages = [
  {
    role: 'system',
    content: 'You review system designs and propose changes by calling tools. Keep changes small.',
  },
  {
    role: 'user',
    content:
      '<board>\nn1 [api] "API" -> n2\nn2 [database] "Postgres"\n</board>\n\nEvery read hits the database. Propose the fix.',
  },
];

// reasoning_effort "none" is the only switch that turns Qwen3.5's thinking off on this endpoint
// (`think: false` and chat_template_kwargs are ignored — see docs/spikes/M1-15-qwen.md).
const recordings = {
  'openai-tool-call.sse': { tools, reasoning_effort: 'none' },
  'openai-tool-call-thinking.sse': { tools },
  'openai-text-only.sse': { reasoning_effort: 'none' },
};

for (const [file, extra] of Object.entries(recordings)) {
  const res = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages:
        file === 'openai-text-only.sse'
          ? [{ role: 'user', content: 'In one sentence: why put a cache in front of a database?' }]
          : messages,
      ...extra,
    }),
  });
  const raw = await res.text();
  writeFileSync(new URL(file, dir), raw);
  process.stdout.write(`${file}: ${res.status}, ${raw.length} bytes\n`);
}
