// Re-run mimo validity for §4 only, with the hardened VALIDITY_HEADER regex
import { runArgumentValidityPass } from '../src/lib/server/ai/hermeneutic/argument-validity.ts';
import { pool, query } from '../src/lib/server/db/index.ts';
import { writeFileSync } from 'node:fs';

const CASE_ID = 'aa23d66e-9cd8-4583-9d14-6120dc343b10';
const PARA_ID = '96556e05-9b69-482b-ace7-174252284536'; // §4

const t0 = Date.now();
const r = await runArgumentValidityPass(CASE_ID, PARA_ID, {
	modelOverride: { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' },
	maxTokens: 8000,
});
const dt = (Date.now() - t0) / 1000;
console.log(`§4 mimo validity rerun: ${dt.toFixed(1)}s  skipped=${r.skipped}  updated=${r.updatedCount}  in=${r.tokens?.input ?? '?'} out=${r.tokens?.output ?? '?'}`);

// Snapshot the final mimo assessments for §4 (and append to existing mimo result file)
const rows = (await query(
	`SELECT paragraph_element_id, arg_local_id, claim, validity_assessment
	 FROM argument_nodes WHERE paragraph_element_id = $1
	 ORDER BY position_in_paragraph`,
	[PARA_ID]
)).rows;

writeFileSync('/tmp/mimo-validity-p4-rerun.json', JSON.stringify({
	wall_seconds: dt,
	tokens: r.tokens, model: r.model, provider: r.provider,
	updated_count: r.updatedCount,
	assessments: rows,
}, null, 2));
console.log('→ /tmp/mimo-validity-p4-rerun.json');

await pool.end();
