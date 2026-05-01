// Smoke test: does deepseek-v4-pro on Mammouth return a parseable JSON object?
import { chat } from '../src/lib/server/ai/client.ts';

const r = await chat({
	system: 'Du antwortest ausschließlich mit einem JSON-Objekt. Kein Text davor oder danach.',
	messages: [{ role: 'user', content: 'Gib zurück: {"hello":"world","n":42}' }],
	maxTokens: 200,
	modelOverride: { provider: 'mammouth', model: 'deepseek-v4-pro' },
});
console.log('--- model:', r.model);
console.log('--- provider:', r.provider);
console.log('--- input:', r.inputTokens, 'output:', r.outputTokens);
console.log('--- text length:', r.text.length);
console.log('--- raw text BEGIN ---');
console.log(r.text);
console.log('--- raw text END ---');
console.log('--- stop_reason:', r.stopReason);
process.exit(0);
