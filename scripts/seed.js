import pg from 'pg';
import { hash } from 'argon2';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';

async function seed() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();

	// ── Admin user ──
	let userId;
	const existing = await client.query("SELECT id FROM users WHERE username = 'admin'");
	if (existing.rows.length > 0) {
		userId = existing.rows[0].id;
		console.log(`  Admin user already exists: ${userId}`);
	} else {
		const passwordHash = await hash('adminadmin', { type: 2 }); // argon2id
		const userResult = await client.query(
			`INSERT INTO users (username, email, password_hash, display_name, role, must_change_password)
			 VALUES ('admin', 'admin@localhost', $1, 'Administrator', 'admin', TRUE)
			 RETURNING id`,
			[passwordHash]
		);
		userId = userResult.rows[0].id;
		console.log(`  Created admin user: ${userId}`);
	}

	// ── Sample Project (empty, for user experiments) ──
	const sampleExists = await client.query(
		"SELECT id FROM projects WHERE name = 'Sample Project'"
	);
	if (sampleExists.rows.length === 0) {
		const projResult = await client.query(
			`INSERT INTO projects (name, description, created_by)
			 VALUES ('Sample Project', 'A sample project for testing transact-qda', $1)
			 RETURNING id`,
			[userId]
		);
		await client.query(
			`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
			[projResult.rows[0].id, userId]
		);
		console.log(`  Created sample project: ${projResult.rows[0].id}`);
	}

	// ── Clarke Abstract Maps (Demo) ──
	const clarkeExists = await client.query(
		"SELECT id FROM projects WHERE name = 'Clarke Abstract Maps (Demo)'"
	);
	if (clarkeExists.rows.length > 0) {
		console.log('  Clarke demo project already exists, skipping.');
	} else {
		await seedClarkeDemoProject(client, userId);
	}

	await client.end();
	console.log('Seed complete.');
}

// ── Helper: create a naming with initial designation ──
async function createNaming(client, projectId, userId, researcherId, inscription, designation = 'cue') {
	const res = await client.query(
		`INSERT INTO namings (project_id, inscription, created_by)
		 VALUES ($1, $2, $3) RETURNING id`,
		[projectId, inscription, userId]
	);
	const id = res.rows[0].id;
	await client.query(
		`INSERT INTO naming_acts (naming_id, designation, "by")
		 VALUES ($1, $2, $3)`,
		[id, designation, researcherId]
	);
	return id;
}

// ── Helper: create a map (naming + self-referential perspective appearance) ──
async function createMap(client, projectId, userId, researcherId, label, mapType, extraProps = {}) {
	const mapId = await createNaming(client, projectId, userId, researcherId, label, 'cue');
	await client.query(
		`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
		 VALUES ($1, $1, 'perspective', $2)`,
		[mapId, JSON.stringify({ mapType, readOnly: true, ...extraProps })]
	);
	return mapId;
}

// ── Helper: place an element on a map ──
async function placeOnMap(client, namingId, mapId, mode = 'entity', properties = {}) {
	await client.query(
		`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
		 VALUES ($1, $2, $3, $4)`,
		[namingId, mapId, mode, JSON.stringify(properties)]
	);
}

// ── Helper: create a formation (naming + appearance + classification memo) ──
async function createFormation(client, projectId, userId, researcherId, mapId, inscription, swRole, props) {
	const id = await createNaming(client, projectId, userId, researcherId, inscription, 'characterization');
	await placeOnMap(client, id, mapId, 'entity', props);

	// Classification memo
	const memoId = await createNaming(client, projectId, userId, researcherId, `Formation: ${swRole}`, 'cue');
	await client.query(
		`INSERT INTO memo_content (naming_id, content) VALUES ($1, '')`,
		[memoId]
	);
	await client.query(
		`INSERT INTO participations (id, naming_id, participant_id) VALUES ($1, $2, $3)`,
		[memoId, id, memoId]
	);
	return id;
}

// ── Helper: create a directed relation between two namings on a map ──
async function createRelation(client, projectId, userId, researcherId, mapId, sourceId, targetId, inscription) {
	const relId = await createNaming(client, projectId, userId, researcherId, inscription, 'characterization');
	await client.query(
		`INSERT INTO participations (id, naming_id, participant_id) VALUES ($1, $2, $3)`,
		[relId, sourceId, targetId]
	);
	await client.query(
		`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, properties)
		 VALUES ($1, $2, 'relation', $3, $4, '{}')`,
		[relId, mapId, sourceId, targetId]
	);
	return relId;
}

// ════════════════════════════════════════════════════════════════
// Clarke Abstract Maps — Demo Project
// Clarke et al. (2018): Situational Analysis in Practice.
// Read-only template. Copy the project to make changes.
// ════════════════════════════════════════════════════════════════
async function seedClarkeDemoProject(client, userId) {
	// Project
	const projRes = await client.query(
		`INSERT INTO projects (name, description, created_by)
		 VALUES ('Clarke Abstract Maps (Demo)',
		         'Demo-Projekt (read-only Template). Clarke et al. 2018, Figures 5.1, 6.1. Zum Üben: Projekt kopieren.',
		         $1)
		 RETURNING id`,
		[userId]
	);
	const projectId = projRes.rows[0].id;
	await client.query(
		`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
		[projectId, userId]
	);
	console.log(`  Created Clarke demo project: ${projectId}`);

	// Researcher naming (every project needs one)
	const researcherId = await createNaming(client, projectId, userId, null, 'admin (Researcher)', 'cue');
	// Fix: the researcher naming_act needs a "by" — use itself
	await client.query(
		`UPDATE naming_acts SET "by" = $1 WHERE naming_id = $1`,
		[researcherId]
	);

	// ────────────────────────────────────────────────
	// Fig. 5.1: Abstract Situational Map
	// ────────────────────────────────────────────────
	const sitMapId = await createMap(client, projectId, userId, researcherId,
		'Abstract Situational Map (Fig. 5.1)', 'situational');
	console.log('  Seeding Fig. 5.1 (Situational Map)...');

	// Elements — Clarke's abstract categories
	const sitElements = {
		'Individual A':                       { x: 520, y: 260 },
		'Individual B':                       { x: 60,  y: 370 },
		'Individual R':                       { x: 540, y: 570 },
		'Social Group A':                     { x: 380, y: 100 },
		'Social Group C':                     { x: 310, y: 280 },
		'Organization #1':                    { x: 560, y: 160 },
		'Organization #2':                    { x: 420, y: 200 },
		'Organization #3':                    { x: 290, y: 180 },
		'Nonhuman Actant A':                  { x: 40,  y: 40  },
		'Nonhuman Element Q':                 { x: 80,  y: 200 },
		'Nonhuman Element Z':                 { x: 200, y: 390 },
		'Key Event #1':                       { x: 340, y: 420 },
		'Key Event #2':                       { x: 160, y: 250 },
		'Hot Issue #1':                       { x: 50,  y: 530 },
		'Hot Issue #2':                       { x: 400, y: 350 },
		'Idea/Concept 1':                     { x: 430, y: 490 },
		'Idea/Concept 2':                     { x: 180, y: 80  },
		'Sociocultural Aspect #1':            { x: 330, y: 60  },
		'Sociocultural Aspect #2':            { x: 570, y: 50  },
		'Discourse on "N"':                   { x: 60,  y: 470 },
		'Discourse on "B"':                   { x: 220, y: 490 },
		'Public Discourse on Organization A': { x: 540, y: 420 },
		'Spatial Aspect':                     { x: 620, y: 490 },
		'Infrastructural Element #1':         { x: 250, y: 570 },
	};

	const sitIds = {};
	for (const [inscription, pos] of Object.entries(sitElements)) {
		sitIds[inscription] = await createNaming(client, projectId, userId, researcherId, inscription);
		await placeOnMap(client, sitIds[inscription], sitMapId, 'entity', pos);
	}

	// Relations (all from Organization #1)
	const sitRelations = [
		['Organization #1', 'Nonhuman Element Z',                'depends on for operations'],
		['Organization #1', 'Public Discourse on Organization A', 'is subject of public discourse'],
		['Organization #1', 'Infrastructural Element #1',         'relies on infrastructure'],
		['Organization #1', 'Sociocultural Aspect #2',            'shapes organizational culture'],
	];
	for (const [src, tgt, inscription] of sitRelations) {
		await createRelation(client, projectId, userId, researcherId, sitMapId,
			sitIds[src], sitIds[tgt], inscription);
	}

	// ────────────────────────────────────────────────
	// Fig. 6.1: Abstract Map of Social Worlds in Arenas
	// ────────────────────────────────────────────────
	const swaMapId = await createMap(client, projectId, userId, researcherId,
		'Abstract Map of Social Worlds in Arenas (Fig. 6.1)', 'social-worlds');
	console.log('  Seeding Fig. 6.1 (SW/A Map)...');

	// Formations: { inscription, swRole, x, y, rx, ry, rotation? }
	const formations = [
		['The X Arena',      'arena',        { x: 480, y: 440, rx: 400, ry: 360 }],
		['Social World #1',  'social-world', { x: 250, y: 100, rx: 200, ry: 75,  rotation: -10 }],
		['Social World #2',  'social-world', { x: 140, y: 240, rx: 130, ry: 55,  rotation: -25 }],
		['Social World #3',  'social-world', { x: 170, y: 340, rx: 110, ry: 50,  rotation: -15 }],
		['Organization A',   'organization', { x: 400, y: 260, rx: 110, ry: 100 }],
		['Social World #4',  'social-world', { x: 330, y: 430, rx: 170, ry: 80,  rotation: 10 }],
		['Social World #5',  'social-world', { x: 200, y: 560, rx: 160, ry: 80,  rotation: -30 }],
		['Social World #6',  'social-world', { x: 260, y: 670, rx: 150, ry: 70,  rotation: -20 }],
		['Social World #7',  'social-world', { x: 490, y: 760, rx: 130, ry: 110, rotation: 5 }],
		['Organization B',   'organization', { x: 490, y: 750, rx: 65,  ry: 38 }],
		['Social World #8',  'social-world', { x: 740, y: 730, rx: 170, ry: 85,  rotation: 15 }],
		['Social World #9',  'social-world', { x: 750, y: 520, rx: 155, ry: 75,  rotation: -10 }],
		['Social World #10', 'social-world', { x: 760, y: 240, rx: 135, ry: 95,  rotation: 15 }],
		['Social World #11', 'social-world', { x: 640, y: 100, rx: 180, ry: 75,  rotation: -5 }],
	];

	for (const [inscription, swRole, props] of formations) {
		await createFormation(client, projectId, userId, researcherId, swaMapId, inscription, swRole, props);
	}

	// ────────────────────────────────────────────────
	// Fig. 7.1: Abstract Positional Map
	// Clarke et al. 2018, Ch. 7
	// ────────────────────────────────────────────────
	const posMapId = await createMap(client, projectId, userId, researcherId,
		'Abstract Positional Map (Fig. 7.1)', 'positional');
	console.log('  Seeding Fig. 7.1 (Positional Map)...');

	// Axes — generic discursive dimensions per Clarke's abstract example
	const axisX = await createNaming(client, projectId, userId, researcherId,
		'Position on Issue X', 'characterization');
	await placeOnMap(client, axisX, posMapId, 'entity', { isAxis: true, axisDimension: 'x' });

	const axisY = await createNaming(client, projectId, userId, researcherId,
		'Position on Issue Y', 'characterization');
	await placeOnMap(client, axisY, posMapId, 'entity', { isAxis: true, axisDimension: 'y' });

	// Positions — scattered across the field (0–800 per axis, y stored as negative)
	// Clarke's abstract map shows positions A–H in different regions
	const positions = [
		// Q1: high X / high Y — multiple positions, some clustered
		['Position A', { x: 620, y: -650, designation: 'characterization' }],
		['Position B', { x: 700, y: -720, designation: 'characterization' }],
		['Position C', { x: 580, y: -580, designation: 'characterization' }],
		// Q2: low X / high Y — sparse
		['Position D', { x: 150, y: -680, designation: 'characterization' }],
		// Q3: low X / low Y — empty (silence!)
		// Q4: high X / low Y — some positions
		['Position E', { x: 650, y: -200, designation: 'characterization' }],
		['Position F', { x: 550, y: -120, designation: 'characterization' }],
		// Middle region
		['Position G', { x: 380, y: -420, designation: 'characterization' }],
		['Position H', { x: 280, y: -350, designation: 'cue' }],
	];

	for (const [inscription, props] of positions) {
		const posId = await createNaming(client, projectId, userId, researcherId,
			inscription, props.designation);
		await placeOnMap(client, posId, posMapId, 'entity', { x: props.x, y: props.y });
	}

	// Absent position — Q3 is empty, mark the structural silence
	const absenceId = await createNaming(client, projectId, userId, researcherId,
		'Missing Position in Data', 'cue');
	await placeOnMap(client, absenceId, posMapId, 'entity', {
		x: 150, y: -150, absent: true
	});

	console.log('  Clarke demo project complete (3 maps, read-only).');
}

seed().catch((e) => {
	console.error('Seed failed:', e);
	process.exit(1);
});
