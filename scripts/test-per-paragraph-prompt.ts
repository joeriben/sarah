// Smoke test for per-paragraph prompt assembly. Guards against the H2
// paragraph pass presenting variable input context as output-like sections.
import {
	buildSystemPrefix,
	buildSystemSuffix,
	buildUserMessage,
	type CaseContext,
	type ParagraphContext,
} from '../src/lib/server/ai/hermeneutic/per-paragraph.ts';
import { pool } from '../src/lib/server/db/index.ts';

function assert(condition: unknown, message: string): void {
	if (!condition) {
		console.error('FAIL:', message);
		process.exit(1);
	}
}

const caseCtx: CaseContext = {
	caseId: 'case',
	projectId: 'project',
	centralDocumentId: 'document',
	documentTitle: 'Testarbeit',
	fullText: '',
	brief: {
		name: 'brief',
		work_type: 'BA',
		criteria: 'Fragestellung und Argumentationsgang rekonstruieren.',
		persona: 'Du bist kritischer Gutachter.',
		includeFormulierend: false,
	},
	mainHeadings: [
		'Einleitung',
		'Die epochaltypischen Schlüsselprobleme nach Klafki',
		'Schluss',
	],
	mainParagraphCount: 12,
	mainHeadingCount: 3,
};

const paraCtx: ParagraphContext = {
	paragraphId: 'paragraph',
	charStart: 0,
	charEnd: 10,
	text: 'Aktueller Absatz.',
	subchapterHeadingId: 'heading',
	subchapterLabel: 'Die epochaltypischen Schlüsselprobleme nach Klafki',
	subchapterStart: 0,
	subchapterEnd: 100,
	positionInSubchapter: 2,
	subchapterTotalParagraphs: 5,
	predecessorText: 'Vorheriger Absatz.',
	successorText: 'Nächster Absatz.',
	completedKontextualisierungen: [{
		sectionLabel: 'Einleitung',
		content: '## REFLEKTIEREND\nAlt-Memo mit Markdown-Header.',
	}],
	reflectiveChain: [{
		positionInSubchapter: 1,
		content: '[OUTLINE & POSITION]\nAlt-Memo mit ehemaligem Container-Marker.',
	}],
};

const prefix = buildSystemPrefix(caseCtx);
const suffix = buildSystemSuffix(paraCtx, caseCtx);
const user = buildUserMessage(paraCtx, caseCtx);

assert(prefix.includes('## REFLEKTIEREND'), 'stable prefix must keep the output section spec');
assert(suffix === '', 'variable system suffix must remain empty');
assert(user.includes('(aktuelle Stelle)'), 'user context must mark the current outline position');
assert(!user.includes('← AKTUELL HIER'), 'legacy current-position marker must not appear');
assert(!user.includes('[BISHERIGE GUTACHTERLICHE LEKTÜRE'), 'legacy completed-context container must not appear');
assert(!user.includes('[REFLEKTIERENDE KETTE IM AKTUELLEN'), 'legacy chain container must not appear');
assert(!/^#{1,6}\s+/m.test(user), 'user context must not contain line-start markdown headings');

console.log('PASS per-paragraph prompt assembly');

await pool.end();
