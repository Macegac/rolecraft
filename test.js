// Rolecraft test runner.
// =====================================================================
// HOW IT WORKS
//
//   There is no build step. The app's code lives in plain script files
//   under js/, loaded in order by index.html. To test UTILITY, this runner:
//
//     1. Reads js/util/utility.js as plain text.
//     2. Extracts the `const UTILITY = { ... };` block via line markers
//        (start: `        const UTILITY = {`, end: next `        };`).
//     3. Evals that block in a fresh Node `vm` sandbox and pulls out
//        the resulting UTILITY object.
//     4. Runs assertions against UTILITY's methods.
//
//   UTILITY's helpers are pure JS (no DOM, no fetch, no localStorage),
//   so the vm sandbox needs no stubs.
//
// HOW TO RUN
//
//   npm test          (or: node test.js)
//
//   Zero dependencies. Uses Node's built-in `node:test` and `node:assert`.
//
// HOW TO ADD A TEST
//
//   Find the section comment for the helper you're testing (e.g.
//   `── parseSearchQuery ──`) and add a `test('description', () => {...})`
//   alongside the existing ones. Use `deepEq(actual, expected)` for arrays
//   and objects (it strips the vm-sandbox prototype before comparing);
//   use `assert.equal` / `assert.ok` for primitives.
//
//   Discipline: when fixing a bug, write a failing red test first, then
//   the source fix that turns it green. See `.agents/rules/instructions.md`.
//
// WHAT'S NOT TESTED HERE
//
//   - DOM-bound helpers (escapeHTML, safeImageSet, ...)        — need a DOM stub.
//   - Blob / FileReader helpers (base64ToBlob, ...)            — Node lacks these natively.
//   - localStorage / IndexedDB code (DBService, StateManager)  — needs storage stubs.
//   - Provider HTTP code (callOpenRouter, ...)                 — needs fetch mocks.
//   - End-to-end Architect runs                                — would need a headless browser.
//
//   These were skipped intentionally. Adding them later doesn't require
//   redoing this layer — just add a sibling test file or extend this one.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

// Values built inside the vm sandbox have prototypes from a different realm,
// so node:assert/strict's prototype check fails on otherwise-identical objects.
// Round-trip through JSON to compare by structure only.
function deepEq(actual, expected, msg) {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
}

const HTML_PATH = path.join(__dirname, 'index.html');
const UTILITY_PATH = path.join(__dirname, 'js', 'util', 'utility.js');
const UTILITY_SOURCE = fs.readFileSync(UTILITY_PATH, 'utf8');

// Every script file the app loads, for whole-codebase source checks.
function listSourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

// Extract a top-level service block declared as `        const NAME = {` and
// closed by the next line that is exactly `        };` (8-space indent). Every
// service in this file (UTILITY, APIService, StateManager, etc.) follows that
// convention, so the cheap line-anchored close is reliable.
function extractBlock(name) {
    // Split on either line ending to keep the anchored markers exact.
    const lines = UTILITY_SOURCE.split(/\r?\n/);
    const start = lines.findIndex(l => l === `        const ${name} = {`);
    if (start === -1) throw new Error(`extractBlock: could not find 'const ${name} = {'`);
    const end = lines.indexOf('        };', start + 1);
    if (end === -1) throw new Error(`extractBlock: could not find close '        };' after ${name}`);
    return lines.slice(start, end + 1).join('\n');
}

function loadUtility() {
    const block = extractBlock('UTILITY');
    // The block declares `const UTILITY = {...};`. Append the bare identifier so
    // vm.runInNewContext returns it as the completion value.
    return vm.runInNewContext(block + '\nUTILITY', {});
}

const UTILITY = loadUtility();

// ─── toStringArray ────────────────────────────────────────────────────────

test('toStringArray: nullish input returns empty array', () => {
    deepEq(UTILITY.toStringArray(null), []);
    deepEq(UTILITY.toStringArray(undefined), []);
});

test('toStringArray: comma string splits and trims', () => {
    deepEq(UTILITY.toStringArray('warrior, dwarf , gruff'), ['warrior', 'dwarf', 'gruff']);
});

test('toStringArray: array of mixed values is cleaned', () => {
    deepEq(UTILITY.toStringArray(['  a', 'b', '', null, 'c ']), ['a', 'b', 'c']);
});

test('toStringArray: bare scalar wraps to single-element array', () => {
    deepEq(UTILITY.toStringArray('solo'), ['solo']);
    deepEq(UTILITY.toStringArray(42), ['42']);
});

test('toStringArray: object input returns empty array (defensive)', () => {
    deepEq(UTILITY.toStringArray({ tags: 'no' }), []);
});

// ─── normalizeStoryShape ──────────────────────────────────────────────────

test('normalizeStoryShape: coerces story.tags string into array', () => {
    const story = { tags: 'fantasy, dwarf' };
    UTILITY.normalizeStoryShape(story);
    deepEq(story.tags, ['fantasy', 'dwarf']);
});

test('normalizeStoryShape: coerces nested character.tags string into array', () => {
    const story = { characters: [{ name: 'Thorne', tags: 'jolly, dwarven' }] };
    UTILITY.normalizeStoryShape(story);
    deepEq(story.characters[0].tags, ['jolly', 'dwarven']);
});

test('normalizeStoryShape: missing array fields default to []', () => {
    const story = {};
    UTILITY.normalizeStoryShape(story);
    for (const k of ['tags', 'characters', 'scenarios', 'static_entries', 'dynamic_entries', 'narratives']) {
        assert.ok(Array.isArray(story[k]), `expected ${k} to be an array`);
    }
});

test('normalizeStoryShape: tolerates null / non-object input without throwing', () => {
    assert.doesNotThrow(() => UTILITY.normalizeStoryShape(null));
    assert.doesNotThrow(() => UTILITY.normalizeStoryShape(undefined));
    assert.doesNotThrow(() => UTILITY.normalizeStoryShape('not a story'));
});

test('normalizeStoryShape: ensures per-character extra_portraits and dynamic_knowledge are arrays', () => {
    const story = { characters: [{ name: 'X' }] };
    UTILITY.normalizeStoryShape(story);
    assert.ok(Array.isArray(story.characters[0].extra_portraits));
    assert.ok(Array.isArray(story.characters[0].dynamic_knowledge));
});

test('normalizeStoryShape: populates default visual settings when missing', () => {
    const story = {
        scenarios: [{ id: 'sc1', name: 'Start' }]
    };
    UTILITY.normalizeStoryShape(story);
    assert.equal(story.font, "'Inter', sans-serif");
    assert.equal(story.chatTextColor, '#cdc6b6');
    assert.equal(story.bubbleOpacity, 0.35);
    assert.equal(story.scenarios[0].prompts.font, "'Inter', sans-serif");
    assert.equal(story.scenarios[0].prompts.bubbleOpacity, 0.35);
});

// ─── extractStructuredHeadings (the case-mismatch bug) ────────────────────

test('extractStructuredHeadings: result is exposed under both original case and lowercase', () => {
    const sample = `### Model Instructions
Speak softly.

### Tags
warrior, dwarf

### Color Hex
#71717a`;
    const r = UTILITY.extractStructuredHeadings(sample, ['Model Instructions', 'Tags', 'Color Hex']);
    assert.equal(r['Model Instructions'], 'Speak softly.');
    assert.equal(r['model instructions'], 'Speak softly.');
    assert.equal(r['Tags'], 'warrior, dwarf');
    assert.equal(r['tags'], 'warrior, dwarf');
    assert.equal(r['Color Hex'], '#71717a');
});

test('extractStructuredHeadings: missing heading returns empty string', () => {
    const r = UTILITY.extractStructuredHeadings('### Tags\na, b', ['Tags', 'Color Hex']);
    assert.equal(r['Color Hex'], '');
    assert.equal(r['color hex'], '');
});

test('extractStructuredHeadings: empty / null input returns empty object', () => {
    deepEq(UTILITY.extractStructuredHeadings('', ['Foo']), {});
    deepEq(UTILITY.extractStructuredHeadings(null, ['Foo']), {});
});

test('extractStructuredHeadings: tolerates bracket-style markup [KEY]', () => {
    // analyzeTurn / character skeleton prompts ask the LLM for `[KEY]` headers
    // rather than `### KEY`. The regex's optional-bracket prefix has to handle both.
    const sample = `[Emotion]
happy

[Location]
The market square

[Stats]
Health|+5`;
    const r = UTILITY.extractStructuredHeadings(sample, ['Emotion', 'Location', 'Stats']);
    assert.equal(r['Emotion'], 'happy');
    assert.equal(r['Location'], 'The market square');
    assert.equal(r['Stats'], 'Health|+5');
    assert.equal(r['emotion'], 'happy', 'lowercase alias must be populated');
});

// ─── extractDelimitedList ─────────────────────────────────────────────────

test('extractDelimitedList: null/empty input returns empty array', () => {
    deepEq(UTILITY.extractDelimitedList(null), []);
    deepEq(UTILITY.extractDelimitedList(''), []);
});

test('extractDelimitedList: parses pipe-delimited rows by keys', () => {
    const text = `- Thorne | Innkeeper | jovial dwarf
- Mira | User | curious traveler`;
    const r = UTILITY.extractDelimitedList(text, '|', ['name', 'role', 'archetype']);
    assert.equal(r.length, 2);
    assert.equal(r[0].name, 'Thorne');
    assert.equal(r[0].role, 'Innkeeper');
    assert.equal(r[0].archetype, 'jovial dwarf');
    assert.equal(r[1].name, 'Mira');
});

test('extractDelimitedList: missing trailing fields default to empty string', () => {
    const r = UTILITY.extractDelimitedList('- Solo', '|', ['name', 'role', 'archetype']);
    assert.equal(r[0].name, 'Solo');
    assert.equal(r[0].role, '');
    assert.equal(r[0].archetype, '');
});

test('extractDelimitedList: bare list (no delimiter) returns trimmed strings', () => {
    const r = UTILITY.extractDelimitedList('- Locations\n- Factions\n- History');
    deepEq(r, ['Locations', 'Factions', 'History']);
});

test('extractDelimitedList: parses unbulleted pipe rows (LLM-followed prompt format)', () => {
    // Several prompts (auto-knowledge, archivist, stat tracker, relationship matrix)
    // ask the LLM for "Title | Content" rows with no bullet markers.
    const text = `Old Mill | A creaking watermill on the edge of town.
Red Guard | The captain's elite unit.`;
    const r = UTILITY.extractDelimitedList(text, '|', ['title', 'content']);
    assert.equal(r.length, 2);
    assert.equal(r[0].title, 'Old Mill');
    assert.equal(r[0].content, 'A creaking watermill on the edge of town.');
    assert.equal(r[1].title, 'Red Guard');
});

test('extractDelimitedList: skips intro/prose lines that lack the delimiter', () => {
    // Intro chatter from the LLM should be filtered when a delimiter is required.
    const text = `Sure! Here are the entries:
Old Mill | A creaking watermill.
Red Guard | The captain's elite unit.`;
    const r = UTILITY.extractDelimitedList(text, '|', ['title', 'content']);
    assert.equal(r.length, 2);
    assert.equal(r[0].title, 'Old Mill');
});

test('extractDelimitedList: comma-separated single line in bare-list mode', () => {
    // The in-story scenario prompt asks the LLM for "comma-separated list of topics"
    // on a single line. Without bullet markers, the old gate dropped everything.
    const r = UTILITY.extractDelimitedList('The Old Mill, The Red Guard, The Great Fire');
    deepEq(r, ['The Old Mill', 'The Red Guard', 'The Great Fire']);
});

test('extractDelimitedList: strips Key: prefixes from each delimited part (production roster format)', () => {
    // The Concept Roster prompt asks the LLM for: `- Name: X | Role: Y | Archetype: Z`.
    // Each delimited part starts with a `Key:` label that the helper must strip.
    const text = `- Name: Thorne | Role: User | Archetype: The Protagonist (a brave dwarf)
- Name: Mira | Role: PrimaryAI | Archetype: The Companion`;
    const r = UTILITY.extractDelimitedList(text, '|', ['name', 'role', 'archetype']);
    assert.equal(r.length, 2);
    assert.equal(r[0].name, 'Thorne');
    assert.equal(r[0].role, 'User');
    assert.equal(r[0].archetype, 'The Protagonist (a brave dwarf)');
    assert.equal(r[1].name, 'Mira');
    assert.equal(r[1].role, 'PrimaryAI');
});

test('extractDelimitedList: stat-row format (name|delta) parses cleanly', () => {
    // analyzeTurn prompt explicitly asks for `<stat_name>|<delta>` rows.
    const r = UTILITY.extractDelimitedList('Health|-5\nMorale|+10', '|', ['name', 'delta']);
    assert.equal(r.length, 2);
    assert.equal(r[0].name, 'Health');
    assert.equal(r[0].delta, '-5');
    assert.equal(r[1].name, 'Morale');
    assert.equal(r[1].delta, '+10');
});

// ─── extractAndParseJSON ──────────────────────────────────────────────────

test('extractAndParseJSON: null/empty input returns null', () => {
    assert.equal(UTILITY.extractAndParseJSON(null), null);
    assert.equal(UTILITY.extractAndParseJSON(''), null);
});

test('extractAndParseJSON: strips ```json fences', () => {
    const r = UTILITY.extractAndParseJSON('```json\n{"name":"x"}\n```');
    deepEq(r, { name: 'x' });
});

test('extractAndParseJSON: recovers from trailing prose', () => {
    const r = UTILITY.extractAndParseJSON('Sure thing! {"ok": true} (let me know if you need more)');
    deepEq(r, { ok: true });
});

test('extractAndParseJSON: tolerates trailing commas', () => {
    const r = UTILITY.extractAndParseJSON('{"a": 1, "b": 2,}');
    deepEq(r, { a: 1, b: 2 });
});

// ─── stripThinking ────────────────────────────────────────────────────────

test('stripThinking: removes <think>...</think> blocks', () => {
    const r = UTILITY.stripThinking('hello <think>internal monologue</think> world');
    assert.equal(r, 'hello  world');
});

test('stripThinking: removes <thought>, <thinking>, <reasoning>, <scratchpad>, [THOUGHTS], [REASONING], [THINK] blocks', () => {
    assert.equal(UTILITY.stripThinking('a <thought>t1</thought> b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a <thinking>t2</thinking> b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a <reasoning>t3</reasoning> b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a <scratchpad>t4</scratchpad> b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a [THOUGHTS]t5[/THOUGHTS] b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a [REASONING]t6[/REASONING] b'), 'a  b');
    assert.equal(UTILITY.stripThinking('a [THINK]t7[/THINK] b'), 'a  b');
});

test('stripThinking: removes unclosed <think> tag at end of string', () => {
    assert.equal(UTILITY.stripThinking('Here is the start <think>cut off midway'), 'Here is the start');
    assert.equal(UTILITY.stripThinking('<think>all cut off'), '');
});

test('stripThinking: passes through non-strings unchanged', () => {
    assert.equal(UTILITY.stripThinking(null), null);
    assert.equal(UTILITY.stripThinking(undefined), undefined);
});

// ─── extractThinking ──────────────────────────────────────────────────────

test('extractThinking: extracts thoughts and cleans content', () => {
    const res = UTILITY.extractThinking('Hello <think>analyzing character persona...</think>world!');
    assert.equal(res.thinking, 'analyzing character persona...');
    assert.equal(res.content, 'Hello world!');
});

test('extractThinking: handles <thought>, <thinking>, <reasoning>, <scratchpad>, and bracket tags', () => {
    const res1 = UTILITY.extractThinking('<thought>deep reflection</thought>Greetings.');
    assert.equal(res1.thinking, 'deep reflection');
    assert.equal(res1.content, 'Greetings.');

    const res2 = UTILITY.extractThinking('<thinking>evaluating move</thinking>I strike!');
    assert.equal(res2.thinking, 'evaluating move');
    assert.equal(res2.content, 'I strike!');

    const res3 = UTILITY.extractThinking('<scratchpad>internal plot planning</scratchpad>The story unfolds.');
    assert.equal(res3.thinking, 'internal plot planning');
    assert.equal(res3.content, 'The story unfolds.');

    const res4 = UTILITY.extractThinking('<reasoning>deductive reasoning</reasoning> elementary.');
    assert.equal(res4.thinking, 'deductive reasoning');
    assert.equal(res4.content, 'elementary.');

    const res5 = UTILITY.extractThinking('[THOUGHTS]bracket thoughts[/THOUGHTS]Response.');
    assert.equal(res5.thinking, 'bracket thoughts');
    assert.equal(res5.content, 'Response.');

    const res6 = UTILITY.extractThinking('[REASONING]bracket reasoning[/REASONING]Response 2.');
    assert.equal(res6.thinking, 'bracket reasoning');
    assert.equal(res6.content, 'Response 2.');

    const res7 = UTILITY.extractThinking('<think>only thoughts here</think>');
    assert.equal(res7.thinking, 'only thoughts here');
    assert.equal(res7.content, '');
});

test('extractThinking: handles unclosed think tag at end of text', () => {
    const res = UTILITY.extractThinking('Leading text <think>incomplete thought tokens');
    assert.equal(res.thinking, 'incomplete thought tokens');
    assert.equal(res.content, 'Leading text');
});

test('extractThinking: returns empty thinking when no tags present', () => {
    const res = UTILITY.extractThinking('Plain dialogue without thoughts.');
    assert.equal(res.thinking, '');
    assert.equal(res.content, 'Plain dialogue without thoughts.');
});

test('extractThinking: handles null or non-string inputs safely', () => {
    deepEq(UTILITY.extractThinking(null), { thinking: '', content: '' });
    deepEq(UTILITY.extractThinking(undefined), { thinking: '', content: '' });
});

// ─── emptyReplyReason ─────────────────────────────────────────────────────

test('emptyReplyReason: says why a reply had no words, the same way for story replies and the Workshop', () => {
    assert.match(UTILITY.emptyReplyReason('length', 'pondering'), /used its whole reply on thinking/);
    assert.match(UTILITY.emptyReplyReason('length', ''), /hit the length limit before any text/);
    assert.match(UTILITY.emptyReplyReason('stop', 'pondering'), /thought about its reply but returned no words/);
    assert.match(UTILITY.emptyReplyReason('stop', null), /returned an empty reply\. It may have declined/);
    const narrative = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    assert.ok(narrative.includes('UTILITY.emptyReplyReason(finishReason, thinkingText)'), 'story replies use the shared wording');
    assert.ok(!narrative.includes('never got to the words'), 'and no longer keep a copy of their own');
});


// ─── hex color math ───────────────────────────────────────────────────────

test('hexToRgba: converts 7-char hex with alpha', () => {
    assert.equal(UTILITY.hexToRgba('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
});

test('hexToRgba: converts 4-char shorthand hex', () => {
    assert.equal(UTILITY.hexToRgba('#abc', 1), 'rgba(170,187,204,1)');
});

test('darkenHex: darkening by 0% returns the same color', () => {
    assert.equal(UTILITY.darkenHex('#808080', 0), '#808080');
});

test('darkenHex: darkening clamps at black for large percentages', () => {
    assert.equal(UTILITY.darkenHex('#000000', 50), '#000000');
});

test('darkenHex: 50% reduces channel values toward zero', () => {
    // 0xff − round(2.55 × 50) = 255 − 127 = 128 = 0x80.
    // (2.55 × 50 is 127.4999… in IEEE-754, not 127.5, so Math.round rounds down.)
    assert.equal(UTILITY.darkenHex('#ffffff', 50), '#808080');
});

// ─── compileTriggerRegex ──────────────────────────────────────────────────

test('compileTriggerRegex: empty keyword returns never-match regex', () => {
    const r = UTILITY.compileTriggerRegex('');
    assert.equal(r.test('anything at all'), false);
});

test('compileTriggerRegex: matches whole word case-insensitively', () => {
    const r = UTILITY.compileTriggerRegex('dragon');
    assert.equal(r.test('A Dragon roars.'), true);
    assert.equal(r.test('DRAGONFRUIT is healthy'), false, 'must not mid-word match');
});

test('compileTriggerRegex: escapes regex specials in the keyword', () => {
    const r = UTILITY.compileTriggerRegex('a.b');
    assert.equal(r.test('a.b'), true);
    assert.equal(r.test('axb'), false, 'literal . must not match arbitrary char');
});

// ─── parseLoreTrigger ─────────────────────────────────────────────────────

test('parseLoreTrigger: empty string returns no groups, zero chance', () => {
    deepEq(UTILITY.parseLoreTrigger(''), { groups: [], chance: 0, chanceOperator: 'OR' });
    deepEq(UTILITY.parseLoreTrigger(null), { groups: [], chance: 0, chanceOperator: 'OR' });
});

test('parseLoreTrigger: comma-separated keywords become OR groups', () => {
    const r = UTILITY.parseLoreTrigger('dragon, sword');
    assert.equal(r.groups.length, 2);
    assert.equal(r.groups[0].type, 'OR');
    deepEq(r.groups[0].keywords, ['dragon']);
    deepEq(r.groups[1].keywords, ['sword']);
});

test('parseLoreTrigger: AND keyword becomes AND group with multiple keywords', () => {
    const r = UTILITY.parseLoreTrigger('dragon AND fire');
    assert.equal(r.groups[0].type, 'AND');
    deepEq(r.groups[0].keywords, ['dragon', 'fire']);
});

test('parseLoreTrigger: XOR with two keywords becomes XOR group', () => {
    const r = UTILITY.parseLoreTrigger('day XOR night');
    assert.equal(r.groups[0].type, 'XOR');
    deepEq(r.groups[0].keywords, ['day', 'night']);
});

test('parseLoreTrigger: extracts standalone chance percentage', () => {
    const r = UTILITY.parseLoreTrigger('dragon, 30%');
    assert.equal(r.chance, 30);
    assert.equal(r.chanceOperator, 'OR');
    // Chance percent is consumed from the trigger string, so the only group is `dragon`.
    assert.equal(r.groups.length, 1);
    deepEq(r.groups[0].keywords, ['dragon']);
});

test('parseLoreTrigger: AND-prefixed chance switches operator', () => {
    const r = UTILITY.parseLoreTrigger('dragon, AND 50%');
    assert.equal(r.chance, 50);
    assert.equal(r.chanceOperator, 'AND');
});

test('parseLoreTrigger: AND/XOR operators are case-insensitive', () => {
    const lower = UTILITY.parseLoreTrigger('dragon and fire');
    assert.equal(lower.groups[0].type, 'AND');
    deepEq(lower.groups[0].keywords, ['dragon', 'fire']);

    const mixed = UTILITY.parseLoreTrigger('day Xor night');
    assert.equal(mixed.groups[0].type, 'XOR');
    deepEq(mixed.groups[0].keywords, ['day', 'night']);
});

test('parseLoreTrigger: chance-prefix `and` is recognized in any case', () => {
    // The chance regex carries the /i flag; lowercase `and 50%` must still flip
    // chanceOperator from default OR to AND. Locks in the case-insensitive contract.
    const r = UTILITY.parseLoreTrigger('dragon, and 50%');
    assert.equal(r.chance, 50);
    assert.equal(r.chanceOperator, 'AND');
});

// ─── testLoreEntries (deterministic with chance=0) ────────────────────────

test('testLoreEntries: triggers entry whose keyword appears in content', () => {
    const entries = [
        { id: 'e1', triggers: 'dragon', content: 'lore about dragons' },
        { id: 'e2', triggers: 'sword', content: 'lore about swords' }
    ];
    const r = UTILITY.testLoreEntries('A red dragon swoops in.', entries);
    assert.equal(r && r.id, 'e1');
});

test('testLoreEntries: returns null when nothing matches and chance is 0', () => {
    const entries = [{ id: 'e1', triggers: 'unicorn', content: '...' }];
    assert.equal(UTILITY.testLoreEntries('A dragon swoops in.', entries), null);
});

test('testLoreEntries: AND group requires all keywords present', () => {
    const entries = [{ id: 'e1', triggers: 'dragon AND fire', content: '...' }];
    assert.equal(UTILITY.testLoreEntries('the dragon roars', entries), null, 'only one of the AND keywords');
    const r = UTILITY.testLoreEntries('the dragon breathes fire', entries);
    assert.equal(r && r.id, 'e1');
});

test('testLoreEntries: triggers GM-style rule mapping with probability and keyword expressions', () => {
    const rule1 = { id: 'r1', triggers: 'stolen, 100%' };
    const r1 = UTILITY.testLoreEntries('I have stolen the key.', [rule1]);
    assert.equal(r1 && r1.id, 'r1');

    const rule2 = { id: 'r2', triggers: '100%' };
    const r2 = UTILITY.testLoreEntries('Any message', [rule2]);
    assert.equal(r2 && r2.id, 'r2');
});

// ─── lowestLoreIndexByEntry ──────────────────

test('lowestLoreIndexByEntry: rewinds to the earliest stage when an entry revealed twice', () => {
    const removed = [
        { type: 'lore_reveal', dynamic_entry_id: 'e1', previous_index: 3 },
        { type: 'lore_reveal', dynamic_entry_id: 'e1', previous_index: 1 },
        { type: 'lore_reveal', dynamic_entry_id: 'e2', previous_index: 2 }
    ];
    deepEq(UTILITY.lowestLoreIndexByEntry(removed), { e1: 1, e2: 2 });
});

test('lowestLoreIndexByEntry: keeps stage 0 (must not be dropped as falsy)', () => {
    const removed = [{ type: 'lore_reveal', dynamic_entry_id: 'e1', previous_index: 0 }];
    deepEq(UTILITY.lowestLoreIndexByEntry(removed), { e1: 0 });
});

test('lowestLoreIndexByEntry: ignores chat messages and pre-upgrade reveals', () => {
    const removed = [
        { type: 'chat', content: 'hello', dynamic_entry_id: 'e1', previous_index: 5 },
        { type: 'lore_reveal', dynamic_entry_id: 'e2' },
        { type: 'lore_reveal', previous_index: 4 },
        null
    ];
    deepEq(UTILITY.lowestLoreIndexByEntry(removed), {});
});

test('lowestLoreIndexByEntry: returns an empty map for empty or missing input', () => {
    deepEq(UTILITY.lowestLoreIndexByEntry([]), {});
    deepEq(UTILITY.lowestLoreIndexByEntry(undefined), {});
});

// ─── canCombineAt ────────────────────

test('canCombineAt: allows combining a reply with the chat message before it', () => {
    const history = [
        { type: 'chat', content: 'He lifted the sword.' },
        { type: 'chat', content: 'The thieves laughed.' }
    ];
    assert.equal(UTILITY.canCombineAt(history, 1), true);
});

test('canCombineAt: refuses index 0, which has nothing before it', () => {
    const history = [{ type: 'chat', content: 'He lifted the sword.' }];
    assert.equal(UTILITY.canCombineAt(history, 0), false);
});

test('canCombineAt: refuses lore reveals and system events on either side', () => {
    const lorePrev = [
        { type: 'lore_reveal', content: 'The vault remembers.' },
        { type: 'chat', content: 'She stepped back.' }
    ];
    assert.equal(UTILITY.canCombineAt(lorePrev, 1), false, 'lore reveal as the earlier message');

    const eventLater = [
        { type: 'chat', content: 'She stepped back.' },
        { type: 'system_event', content: 'The door seals.' }
    ];
    assert.equal(UTILITY.canCombineAt(eventLater, 1), false, 'system event as the later message');
});

test('canCombineAt: refuses empty content on either side', () => {
    const history = [
        { type: 'chat', content: '' },
        { type: 'chat', content: 'The thieves laughed.' }
    ];
    assert.equal(UTILITY.canCombineAt(history, 1), false);
});

test('canCombineAt: refuses bad input instead of throwing', () => {
    assert.equal(UTILITY.canCombineAt(undefined, 1), false);
    assert.equal(UTILITY.canCombineAt([], 1), false);
    assert.equal(UTILITY.canCombineAt([{ type: 'chat', content: 'a' }], 5), false);
    assert.equal(UTILITY.canCombineAt([{ type: 'chat', content: 'a' }], 1.5), false);
});

// ─── collapseErrors ────────────────────

test('collapseErrors: groups repeats into one row with a count', () => {
    const rows = UTILITY.collapseErrors([
        { message: 'Connection timed out.', ts: 100 },
        { message: 'Connection timed out.', ts: 200 },
        { message: 'Connection timed out.', ts: 300 }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 3);
    assert.equal(rows[0].firstTs, 100);
    assert.equal(rows[0].lastTs, 300);
});

test('collapseErrors: orders distinct errors most recent first', () => {
    const rows = UTILITY.collapseErrors([
        { message: 'old failure', ts: 100 },
        { message: 'newer failure', ts: 500 },
        { message: 'middle failure', ts: 300 }
    ]);
    deepEq(rows.map(r => r.message), ['newer failure', 'middle failure', 'old failure']);
});

test('collapseErrors: a repeat refreshes its position, not its first-seen time', () => {
    const rows = UTILITY.collapseErrors([
        { message: 'flaky call', ts: 100 },
        { message: 'other failure', ts: 200 },
        { message: 'flaky call', ts: 900 }
    ]);
    assert.equal(rows[0].message, 'flaky call');
    assert.equal(rows[0].count, 2);
    assert.equal(rows[0].firstTs, 100, 'first sighting is preserved');
    assert.equal(rows[0].lastTs, 900);
});

test('collapseErrors: skips junk entries and survives no input', () => {
    deepEq(UTILITY.collapseErrors([]), []);
    deepEq(UTILITY.collapseErrors(undefined), []);
    const rows = UTILITY.collapseErrors([null, { ts: 1 }, { message: '', ts: 2 }, { message: 'real', ts: 3 }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, 'real');
});

// ─── filterVisualLore ────────────────────

const VL = [
    { id: 'a', title: 'Crimson Surcoat', category: 'item', description: 'A crimson surcoat with a worn hem.', created: 100 },
    { id: 'b', title: 'Squire Dagger', category: 'item', description: 'A dull training dagger.', created: 300 },
    { id: 'c', title: 'The Keep', category: 'world', description: 'A cold stone hall.', created: 200 }
];

test('filterVisualLore: returns everything newest first when unfiltered', () => {
    deepEq(UTILITY.filterVisualLore(VL, 'all', '').map(i => i.id), ['b', 'c', 'a']);
});

test('filterVisualLore: narrows to one category', () => {
    deepEq(UTILITY.filterVisualLore(VL, 'world', '').map(i => i.id), ['c']);
    deepEq(UTILITY.filterVisualLore(VL, 'item', '').map(i => i.id), ['b', 'a']);
});

test('filterVisualLore: query matches the description, not just the title', () => {
    deepEq(UTILITY.filterVisualLore(VL, 'all', 'worn hem').map(i => i.id), ['a'],
        'the phrase worn hem appears only in the description');
    deepEq(UTILITY.filterVisualLore(VL, 'all', 'dagger').map(i => i.id), ['b']);
});

test('filterVisualLore: query is case-insensitive and combines with category', () => {
    deepEq(UTILITY.filterVisualLore(VL, 'all', 'CRIMSON').map(i => i.id), ['a']);
    deepEq(UTILITY.filterVisualLore(VL, 'world', 'crimson'), [], 'category wins over a title match');
});

test('filterVisualLore: treats a missing category as other, and survives junk', () => {
    const messy = [null, { id: 'x', title: 'Odd', description: 'no category', created: 1 }];
    deepEq(UTILITY.filterVisualLore(messy, 'other', '').map(i => i.id), ['x']);
    deepEq(UTILITY.filterVisualLore(messy, 'item', ''), []);
    deepEq(UTILITY.filterVisualLore(undefined, 'all', ''), []);
});

// ─── createDefaultMapGrid ─────────────────────────────────────────────────

test('createDefaultMapGrid: returns an 8x8 grid with empty content', () => {
    const grid = UTILITY.createDefaultMapGrid();
    assert.equal(grid.length, 64);
    assert.equal(grid[0].coords.x, 0);
    assert.equal(grid[0].coords.y, 0);
    assert.equal(grid[63].coords.x, 7);
    assert.equal(grid[63].coords.y, 7);
    assert.equal(grid[0].name, '');
    assert.ok(Array.isArray(grid[0].local_static_entries));
});

// ─── findPath ─────────────────────────────────────────────────────────────

test('findPath: same start and end returns single-cell path', () => {
    const grid = UTILITY.createDefaultMapGrid();
    const path = UTILITY.findPath(grid, { x: 2, y: 2 }, { x: 2, y: 2 });
    assert.equal(path.length, 1);
    assert.equal(path[0].x, 2);
    assert.equal(path[0].y, 2);
});

test('findPath: orthogonal adjacent cells produce length-2 path', () => {
    const grid = UTILITY.createDefaultMapGrid();
    const path = UTILITY.findPath(grid, { x: 0, y: 0 }, { x: 0, y: 1 });
    assert.equal(path.length, 2);
    deepEq(path[0], { x: 0, y: 0 });
    deepEq(path[1], { x: 0, y: 1 });
});

test('findPath: returns Manhattan-distance + 1 length on open grid', () => {
    const grid = UTILITY.createDefaultMapGrid();
    const path = UTILITY.findPath(grid, { x: 0, y: 0 }, { x: 3, y: 4 });
    // Manhattan distance is 7 steps, path includes start cell -> 8 nodes.
    assert.equal(path.length, 8);
});

test('findPath: returns empty array when start coords missing from grid', () => {
    const grid = UTILITY.createDefaultMapGrid();
    deepEq(UTILITY.findPath(grid, { x: 99, y: 99 }, { x: 0, y: 0 }), []);
});

// ─── weightedChoice ───────────────────────────────────────────────────────

test('weightedChoice: empty input returns null', () => {
    assert.equal(UTILITY.weightedChoice([], []), null);
});

test('weightedChoice: mismatched lengths returns null', () => {
    assert.equal(UTILITY.weightedChoice(['a', 'b'], [1]), null);
});

test('weightedChoice: single-element list always returns that element', () => {
    assert.equal(UTILITY.weightedChoice(['only'], [1]), 'only');
});

test('weightedChoice: zero total weight still returns one of the items', () => {
    const out = UTILITY.weightedChoice(['a', 'b', 'c'], [0, 0, 0]);
    assert.ok(['a', 'b', 'c'].includes(out));
});

// ─── parseSearchQuery ─────────────────────────────────────────────────────

test('parseSearchQuery: empty query reports isEmpty=true', () => {
    deepEq(UTILITY.parseSearchQuery(''), { isEmpty: true });
    deepEq(UTILITY.parseSearchQuery('   '), { isEmpty: true });
    deepEq(UTILITY.parseSearchQuery(null), { isEmpty: true });
});

test('parseSearchQuery: regex form /pattern/flags', () => {
    const r = UTILITY.parseSearchQuery('/dragon.*fire/i');
    assert.equal(r.isRegex, true);
    assert.ok(r.regex.test('dragon breathes fire'));
});

test('parseSearchQuery: invalid regex falls back to text-token parsing', () => {
    const r = UTILITY.parseSearchQuery('/[unclosed/');
    assert.equal(r.isRegex, false);
    assert.ok(Array.isArray(r.tokens));
});

test('parseSearchQuery: tokenizes negation, phrases, and field prefixes', () => {
    const r = UTILITY.parseSearchQuery('dragon -boring "fire breath" tag:adventure');
    assert.equal(r.isRegex, false);
    deepEq(r.tokens, [
        { text: 'dragon',     isNegative: false, isPhrase: false, field: null  },
        { text: 'boring',     isNegative: true,  isPhrase: false, field: null  },
        { text: 'fire breath', isNegative: false, isPhrase: true, field: null  },
        { text: 'adventure',  isNegative: false, isPhrase: false, field: 'tag' }
    ]);
});

// ─── matchStory ───────────────────────────────────────────────────────────

test('matchStory: empty query matches every story', () => {
    const story = { id: '1', name: 'Test', search_index: 'whatever' };
    assert.equal(UTILITY.matchStory(story, { isEmpty: true }), true);
});

test('matchStory: regex query tests against search_index then name', () => {
    const story = { id: '1', name: 'Dragon Tale', search_index: '' };
    const q = UTILITY.parseSearchQuery('/dragon/i');
    assert.equal(UTILITY.matchStory(story, q), true);
});

test('matchStory: regex with global flag must work on every story (no lastIndex carryover)', () => {
    // /pattern/g sets lastIndex on RegExp.prototype.test; reusing the same
    // regex across stories without resetting causes stateful false negatives.
    const stories = [
        { id: '1', name: 'A', search_index: 'dragon' },
        { id: '2', name: 'B', search_index: 'dragon' },
        { id: '3', name: 'C', search_index: 'dragon' }
    ];
    const q = UTILITY.parseSearchQuery('/dragon/g');
    for (const s of stories) {
        assert.equal(UTILITY.matchStory(s, q), true, `story ${s.id} should match`);
    }
});

test('matchStory: positive token must appear in search_index', () => {
    const story = { id: '1', name: 'Tale', search_index: 'a story about a dragon' };
    const q = UTILITY.parseSearchQuery('dragon');
    assert.equal(UTILITY.matchStory(story, q), true);
    const q2 = UTILITY.parseSearchQuery('elephant');
    assert.equal(UTILITY.matchStory(story, q2), false);
});

test('matchStory: negative token excludes stories containing it', () => {
    const story = { id: '1', name: 'Tale', search_index: 'boring dragon story' };
    const q = UTILITY.parseSearchQuery('-boring');
    assert.equal(UTILITY.matchStory(story, q), false);
});

test('matchStory: tag: field matches story tags and character tags', () => {
    const story = {
        id: '1',
        name: 'Tale',
        tags: ['epic'],
        characters: [{ tags: ['mage'] }],
        search_index: ''
    };
    assert.equal(UTILITY.matchStory(story, UTILITY.parseSearchQuery('tag:epic')), true);
    assert.equal(UTILITY.matchStory(story, UTILITY.parseSearchQuery('tag:mage')), true);
    assert.equal(UTILITY.matchStory(story, UTILITY.parseSearchQuery('tag:noir')), false);
});

test('matchStory: character: field matches character names', () => {
    const story = { id: '1', name: 'X', characters: [{ name: 'Thorne' }, { name: 'Mira' }], search_index: '' };
    assert.equal(UTILITY.matchStory(story, UTILITY.parseSearchQuery('char:thorne')), true);
    assert.equal(UTILITY.matchStory(story, UTILITY.parseSearchQuery('char:zog')), false);
});

// ─── estimateTokens ───────────────────────────────────────────────────────

test('estimateTokens: returns 0 for empty or null input', () => {
    assert.equal(UTILITY.estimateTokens(''), 0);
    assert.equal(UTILITY.estimateTokens(null), 0);
    assert.equal(UTILITY.estimateTokens(undefined), 0);
});

test('estimateTokens: approximates word tokens correctly', () => {
    assert.equal(UTILITY.estimateTokens('hello world test'), 4);
    assert.equal(UTILITY.estimateTokens('a'), 2);
});

// ─── truncateShortDescription ─────────────────────────────────────────────

test('truncateShortDescription: returns empty string for null / empty input', () => {
    assert.equal(UTILITY.truncateShortDescription(''), '');
    assert.equal(UTILITY.truncateShortDescription(null), '');
    assert.equal(UTILITY.truncateShortDescription(undefined), '');
});

test('truncateShortDescription: extracts first sentence when short enough', () => {
    const result = UTILITY.truncateShortDescription('A brave hero. Also a poet.');
    assert.equal(result, 'A brave hero.');
});

test('truncateShortDescription: works with exclamation and question marks', () => {
    const excl = UTILITY.truncateShortDescription('What a twist! More story here.');
    assert.equal(excl, 'What a twist!');
    const quest = UTILITY.truncateShortDescription('Who goes there? Nobody knows.');
    assert.equal(quest, 'Who goes there?');
});

test('truncateShortDescription: handles period-less descriptions without bloating (key bug regression)', () => {
    // This is the exact scenario that caused the bloat bug: a long description
    // with no periods means .split('.')[0] returns the entire string.
    const longNoPeriods = 'A mysterious wandering adventurer\nDrawn to the crossroads by ancient power\nSeeking the fragments of a shattered crown across Aethermoor';
    const result = UTILITY.truncateShortDescription(longNoPeriods);
    // Must be bounded — old code returned the full ~130-char string as-is (plus a trailing ".")
    assert.ok(result.length <= 165, `Expected <= 165 chars, got ${result.length}: "${result}"`);
});

test('truncateShortDescription: hard-truncates with ellipsis when no sentence boundary found before maxLen', () => {
    // 200 chars of text with no punctuation
    const noPunct = 'abcdefghij '.repeat(20).trim(); // 209 chars
    const result = UTILITY.truncateShortDescription(noPunct, 160);
    assert.ok(result.endsWith('...'), `Expected ellipsis, got: "${result}"`);
    assert.ok(result.length <= 164, `Expected <= 164 chars, got ${result.length}`);
});

test('truncateShortDescription: text shorter than maxLen is returned as-is when no sentence boundary', () => {
    const short = 'A witty rogue without punctuation';
    const result = UTILITY.truncateShortDescription(short);
    assert.equal(result, short);
});

test('truncateShortDescription: first sentence over maxLen falls back to hard truncation', () => {
    // A single very long sentence (>160 chars) ending in a period
    const longSentence = 'A ' + 'very '.repeat(40) + 'long sentence.'; // ~202 chars + period
    const result = UTILITY.truncateShortDescription(longSentence, 160);
    // Cannot end with just the long sentence - must be truncated
    assert.ok(result.length <= 164, `Expected <= 164 chars, got ${result.length}`);
    assert.ok(result.endsWith('...'), `Expected ellipsis, got: "${result}"`);
});

// ─── sanitizeEvolvedPersona ──────────────────────────────────────────────────

test('sanitizeEvolvedPersona: returns null for nullish/empty/too short/no change input', () => {
    assert.equal(UTILITY.sanitizeEvolvedPersona(null), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona(undefined), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona(''), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona('  '), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona('Short'), null); // too short
    assert.equal(UTILITY.sanitizeEvolvedPersona('No major changes.'), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona('Original persona unchanged.'), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona('No changes detected.'), null);
    assert.equal(UTILITY.sanitizeEvolvedPersona('null'), null);
});

test('sanitizeEvolvedPersona: returns clean persona unmodified when no preambles exist', () => {
    const validPersona = 'Pac is a middle-aged man with brown hair and brown eyes. He is kind, smart, and has a witty sense of humor.';
    assert.equal(UTILITY.sanitizeEvolvedPersona(validPersona), validPersona);
});

test('sanitizeEvolvedPersona: strips intro preambles and ends with colon', () => {
    const rawInput = 'Here is the updated persona:\nPac is a middle-aged man with brown hair. He is smart.';
    const expected = 'Pac is a middle-aged man with brown hair. He is smart.';
    assert.equal(UTILITY.sanitizeEvolvedPersona(rawInput), expected);
});

test('sanitizeEvolvedPersona: strips outro postambles', () => {
    const rawInput = 'Pac is a middle-aged man with brown hair. He is smart.\nHope this updated persona helps let me know!';
    const expected = 'Pac is a middle-aged man with brown hair. He is smart.';
    assert.equal(UTILITY.sanitizeEvolvedPersona(rawInput), expected);
});

test('sanitizeEvolvedPersona: discards persona if length exceeds 2000 characters', () => {
    const longPersona = 'Pac is a dad. '.repeat(200); // 2800 characters
    assert.equal(UTILITY.sanitizeEvolvedPersona(longPersona), null);
});

test('sanitizeEvolvedPersona: discards persona if it contains multiple dialogue transcript lines', () => {
    const transcriptPersona = 'Pac: "Hello there."\nUser: "Hi, Pac."\nPac is a middle-aged man with brown hair.';
    assert.equal(UTILITY.sanitizeEvolvedPersona(transcriptPersona, ['Pac']), null);
});

// ─── parseLorebook & exportLorebook ──────────────────────────────────────────

test('parseLorebook: nullish/invalid input returns empty entries', () => {
    deepEq(UTILITY.parseLorebook(null), { static_entries: [], dynamic_entries: [] });
    deepEq(UTILITY.parseLorebook(''), { static_entries: [], dynamic_entries: [] });
    deepEq(UTILITY.parseLorebook('invalid json'), { static_entries: [], dynamic_entries: [] });
    deepEq(UTILITY.parseLorebook('{}'), { static_entries: [], dynamic_entries: [] });
});

test('parseLorebook: parses flat array of entries', () => {
    const json = JSON.stringify([
        { comment: "Static 1", content: "Static content", constant: true, order: 10 },
        { comment: "Dynamic 1", content: "Dynamic content", constant: false, key: ["dwarf", "gimli"], order: 5 }
    ]);
    const res = UTILITY.parseLorebook(json);
    assert.equal(res.static_entries.length, 1);
    assert.equal(res.dynamic_entries.length, 1);
    
    // Dynamic 1 has lower order (5) than Static 1 (10)
    // Wait, let's verify if they are processed in order.
    assert.equal(res.dynamic_entries[0].title, "Dynamic 1");
    assert.equal(res.dynamic_entries[0].triggers, "dwarf, gimli");
    deepEq(res.dynamic_entries[0].content_fields, ["Dynamic content"]);
    
    assert.equal(res.static_entries[0].title, "Static 1");
    assert.equal(res.static_entries[0].content, "Static content");
});

test('parseLorebook: parses SillyTavern schema and maps probability', () => {
    const json = JSON.stringify({
        entries: {
            "0": { comment: "Elves", content: "Elf lore", constant: false, keys: "elf, legolas", probability: 50, order: 1 },
            "1": { comment: "Dwarves", content: "Dwarf lore", constant: false, key: ["dwarf"], chance: 25, order: 2 },
            "2": { comment: "World", content: "World lore", constant: true, order: 0 }
        }
    });
    const res = UTILITY.parseLorebook(json);
    assert.equal(res.static_entries.length, 1);
    assert.equal(res.dynamic_entries.length, 2);

    assert.equal(res.static_entries[0].title, "World");
    assert.equal(res.static_entries[0].content, "World lore");

    // Dynamic entries are sorted by order: Elves (1) then Dwarves (2)
    assert.equal(res.dynamic_entries[0].title, "Elves");
    assert.equal(res.dynamic_entries[0].triggers, "elf, legolas, AND 50%");
    
    assert.equal(res.dynamic_entries[1].title, "Dwarves");
    assert.equal(res.dynamic_entries[1].triggers, "dwarf, AND 25%");
});

test('parseLorebook: parses Chub.ai character_book schema', () => {
    const json = JSON.stringify({
        character_book: {
            entries: [
                { displayName: "Gimli", content: "A dwarf warrior", constant: false, key: "gimli", order: 1 }
            ]
        }
    });
    const res = UTILITY.parseLorebook(json);
    assert.equal(res.dynamic_entries.length, 1);
    assert.equal(res.dynamic_entries[0].title, "Gimli");
    assert.equal(res.dynamic_entries[0].triggers, "gimli");
    deepEq(res.dynamic_entries[0].content_fields, ["A dwarf warrior"]);
});

test('exportLorebook: exports static and dynamic entries to SillyTavern format', () => {
    const statics = [
        { title: "Static Lore", content: "Always active info" }
    ];
    const dynamics = [
        { title: "Dynamic Lore", triggers: "dwarf, AND 75%", content_fields: ["Triggered info"] }
    ];

    const jsonStr = UTILITY.exportLorebook(statics, dynamics);
    const parsed = JSON.parse(jsonStr);

    assert.ok(parsed.entries);
    const entries = Object.values(parsed.entries);
    assert.equal(entries.length, 2);

    // Static Entry
    const stEntry = entries.find(e => e.constant === true);
    assert.ok(stEntry);
    assert.equal(stEntry.comment, "Static Lore");
    assert.equal(stEntry.content, "Always active info");
    assert.equal(stEntry.probability, 100);

    // Dynamic Entry
    const dyEntry = entries.find(e => e.constant === false);
    assert.ok(dyEntry);
    assert.equal(dyEntry.comment, "Dynamic Lore");
    assert.equal(dyEntry.content, "Triggered info");
    assert.deepEqual(dyEntry.key, ["dwarf"]);
    assert.equal(dyEntry.probability, 75);
});

// ─── tokenizeHtml ───────────────────────────────────────────────────────────

test('tokenizeHtml: correctly splits tags, entities, and characters', () => {
    const html = 'Hello <b>world!</b> &amp; standard';
    const tokens = UTILITY.tokenizeHtml(html);
    const expected = [
        { type: 'text', value: 'H' },
        { type: 'text', value: 'e' },
        { type: 'text', value: 'l' },
        { type: 'text', value: 'l' },
        { type: 'text', value: 'o' },
        { type: 'text', value: ' ' },
        { type: 'tag', value: '<b>' },
        { type: 'text', value: 'w' },
        { type: 'text', value: 'o' },
        { type: 'text', value: 'r' },
        { type: 'text', value: 'l' },
        { type: 'text', value: 'd' },
        { type: 'text', value: '!' },
        { type: 'tag', value: '</b>' },
        { type: 'text', value: ' ' },
        { type: 'entity', value: '&amp;' },
        { type: 'text', value: ' ' },
        { type: 'text', value: 's' },
        { type: 'text', value: 't' },
        { type: 'text', value: 'a' },
        { type: 'text', value: 'n' },
        { type: 'text', value: 'd' },
        { type: 'text', value: 'a' },
        { type: 'text', value: 'r' },
        { type: 'text', value: 'd' }
    ];
    deepEq(tokens, expected);
});

test('tokenizeHtml: handles empty/nullish input', () => {
    deepEq(UTILITY.tokenizeHtml(null), []);
    deepEq(UTILITY.tokenizeHtml(''), []);
});

test('tokenizeHtml: handles malformed tags and entities', () => {
    deepEq(UTILITY.tokenizeHtml('<b text'), [{ type: 'text', value: '<' }, { type: 'text', value: 'b' }, { type: 'text', value: ' ' }, { type: 'text', value: 't' }, { type: 'text', value: 'e' }, { type: 'text', value: 'x' }, { type: 'text', value: 't' }]);
    deepEq(UTILITY.tokenizeHtml('&amp text'), [{ type: 'text', value: '&' }, { type: 'text', value: 'a' }, { type: 'text', value: 'm' }, { type: 'text', value: 'p' }, { type: 'text', value: ' ' }, { type: 'text', value: 't' }, { type: 'text', value: 'e' }, { type: 'text', value: 'x' }, { type: 'text', value: 't' }]);
});

// ─── parseStateUpdateString & parseAndStripStateIndicators ───────────────────

test('parseStateUpdateString: parses resource changes', () => {
    deepEq(UTILITY.parseStateUpdateString('+Rusted Key'), { type: 'resource', name: 'Rusted Key', change: 1 });
    deepEq(UTILITY.parseStateUpdateString('+10 Gold'), { type: 'resource', name: 'Gold', change: 10 });
    deepEq(UTILITY.parseStateUpdateString('-5 Iron Ore'), { type: 'resource', name: 'Iron Ore', change: -5 });
    deepEq(UTILITY.parseStateUpdateString('-Silver'), { type: 'resource', name: 'Silver', change: -1 });
});

test('parseStateUpdateString: parses quest actions', () => {
    deepEq(UTILITY.parseStateUpdateString('Quest Complete: Escape the Dungeon'), { type: 'quest', title: 'Escape the Dungeon', status: 'completed', objective: '', isUpdate: false });
    deepEq(UTILITY.parseStateUpdateString('Quest Update: Escape the Dungeon (Objective: Find exit)'), { type: 'quest', title: 'Escape the Dungeon', status: 'active', objective: 'Find exit', isUpdate: true });
    deepEq(UTILITY.parseStateUpdateString('Quest fail: Escape the Dungeon'), { type: 'quest', title: 'Escape the Dungeon', status: 'failed', objective: '', isUpdate: false });
    deepEq(UTILITY.parseStateUpdateString('Quest start: Escape the Dungeon (assigned: Marcus)'), { type: 'quest', title: 'Escape the Dungeon', status: 'active', objective: '', characterName: 'Marcus', isUpdate: false });
    deepEq(UTILITY.parseStateUpdateString('Quest Update: Escape the Dungeon (assigned: Marcus) (Objective: Find exit)'), { type: 'quest', title: 'Escape the Dungeon', status: 'active', objective: 'Find exit', characterName: 'Marcus', isUpdate: true });
});

test('parseStateUpdateString: parses relationship changes', () => {
    deepEq(UTILITY.parseStateUpdateString('Relationship: Alice +5'), { type: 'relationship', charName: 'Alice', track: 'Affection', changeVal: 5, isRelative: true });
    deepEq(UTILITY.parseStateUpdateString('Relationship: Alice Affection +10%'), { type: 'relationship', charName: 'Alice', track: 'Affection', changeVal: 10, isRelative: true });
    deepEq(UTILITY.parseStateUpdateString('Relationship: Alice attraction 75'), { type: 'relationship', charName: 'Alice', track: 'attraction', changeVal: 75, isRelative: false });
});

test('parseAndStripStateIndicators: strips tags and returns clean text and changes', () => {
    const text = 'You found a key! [STATE: +Rusted Key] Good job.';
    const result = UTILITY.parseAndStripStateIndicators(text);
    assert.equal(result.cleanedText, 'You found a key!  Good job.');
    assert.equal(result.changes.length, 1);
    deepEq(result.changes[0], { type: 'resource', name: 'Rusted Key', change: 1 });
});

// ─── parseGMEvaluationsXML ───────────────────────────────────────────────────

test('parseGMEvaluationsXML: parses valid rule evaluations and proposals from XML', () => {
    const xml = `
    <evaluation>
        <rule_id>rule-123</rule_id>
        <rule_name>Weight Limit Check</rule_name>
        <status>triggered</status>
        <description>The character is carrying too many heavy metal bars, exceeding the 50kg limit.</description>
        <consequence>The character becomes encumbered, slowing their movement speed.</consequence>
        <proposals>
            <resource name="Gold" delta="-10" />
            <character_stat character_name="Pac" stat="speed" value="slow" />
            <relationship character_a="Pac" character_b="Gimli" delta="-5" />
            <narration>Pac groans under the heavy load as the gold slips from his pack.</narration>
        </proposals>
    </evaluation>
    `;
    const res = UTILITY.parseGMEvaluationsXML(xml);
    assert.equal(res.length, 1);
    assert.equal(res[0].rule_id, 'rule-123');
    assert.equal(res[0].rule_name, 'Weight Limit Check');
    assert.equal(res[0].status, 'triggered');
    assert.equal(res[0].description, 'The character is carrying too many heavy metal bars, exceeding the 50kg limit.');
    assert.equal(res[0].consequence, 'The character becomes encumbered, slowing their movement speed.');
    
    const prop = res[0].proposals;
    assert.ok(prop);
    deepEq(prop.resources, [{ name: 'Gold', delta: -10 }]);
    deepEq(prop.character_stats, [{ character_name: 'Pac', stat: 'speed', value: 'slow' }]);
    deepEq(prop.relationships, [{ character_a: 'Pac', character_b: 'Gimli', delta: -5 }]);
    assert.equal(prop.narration, 'Pac groans under the heavy load as the gold slips from his pack.');
});

test('parseGMEvaluationsXML: returns empty array for null/empty/invalid input', () => {
    deepEq(UTILITY.parseGMEvaluationsXML(null), []);
    deepEq(UTILITY.parseGMEvaluationsXML(''), []);
    deepEq(UTILITY.parseGMEvaluationsXML('not xml at all'), []);
});

test('parseInventoryLine: parses various formats', () => {
    deepEq(UTILITY.parseInventoryLine('Gold|10'), { name: 'Gold', delta: 10 });
    deepEq(UTILITY.parseInventoryLine('-1 Key'), { name: 'Key', delta: -1 });
    deepEq(UTILITY.parseInventoryLine('+Potion of Healing'), { name: 'Potion of Healing', delta: 1 });
    deepEq(UTILITY.parseInventoryLine('Iron Sword -1'), { name: 'Iron Sword', delta: -1 });
    assert.equal(UTILITY.parseInventoryLine('none'), null);
});

test('parseQuestLine: parses various formats', () => {
    deepEq(UTILITY.parseQuestLine('start|Find Thorne|Go to the inn'), { action: 'start', title: 'Find Thorne', objective: 'Go to the inn' });
    deepEq(UTILITY.parseQuestLine('complete|Find Thorne'), { action: 'complete', title: 'Find Thorne', objective: '' });
    deepEq(UTILITY.parseQuestLine('update: Escape the Dungeon (Objective: Find the cell key)'), { action: 'update', title: 'Escape the Dungeon', objective: 'Find the cell key' });
    deepEq(UTILITY.parseQuestLine('complete: Escape the Dungeon'), { action: 'complete', title: 'Escape the Dungeon', objective: '' });
    // Assigned character parsing formats
    deepEq(UTILITY.parseQuestLine('start|Marcus|Find Thorne|Go to the inn'), { action: 'start', characterName: 'Marcus', title: 'Find Thorne', objective: 'Go to the inn' });
    deepEq(UTILITY.parseQuestLine('complete|Marcus|Find Thorne'), { action: 'complete', characterName: 'Marcus', title: 'Find Thorne', objective: '' });
    deepEq(UTILITY.parseQuestLine('start: Escape the Dungeon (assigned: Marcus)'), { action: 'start', characterName: 'Marcus', title: 'Escape the Dungeon', objective: '' });
    deepEq(UTILITY.parseQuestLine('update: Escape the Dungeon (assigned: Marcus) (Objective: Find exit)'), { action: 'update', characterName: 'Marcus', title: 'Escape the Dungeon', objective: 'Find exit' });
});

test('parseRelationshipLine: parses various formats', () => {
    deepEq(UTILITY.parseRelationshipLine('Thorne|Affection|+5'), { charName: 'Thorne', track: 'Affection', changeVal: 5 });
    deepEq(UTILITY.parseRelationshipLine('Thorne standing +10%'), { charName: 'Thorne', track: 'standing', changeVal: 10 });
    deepEq(UTILITY.parseRelationshipLine('Thorne: +5'), { charName: 'Thorne', track: 'Affection', changeVal: 5 });
});

test('parseStatLine: parses various formats', () => {
    deepEq(UTILITY.parseStatLine('Thorne|Health|-5'), { charName: 'Thorne', name: 'Health', delta: -5 });
    deepEq(UTILITY.parseStatLine('Thorne: Health -5'), { charName: 'Thorne', name: 'Health', delta: -5 });
    deepEq(UTILITY.parseStatLine('Health -5'), { charName: '', name: 'Health', delta: -5 });
});

// ─── getEntryCategory & cleanFactContent ─────────────────────────────────────

test('getEntryCategory: classifies titles correctly', () => {
    assert.equal(UTILITY.getEntryCategory('[Event] Arrival in Town'), 'event');
    assert.equal(UTILITY.getEntryCategory('Character: Alistair'), 'character');
    assert.equal(UTILITY.getEntryCategory('Item: Healing Potion'), 'item');
    assert.equal(UTILITY.getEntryCategory('World: Whispering Woods'), 'world');
    assert.equal(UTILITY.getEntryCategory('Relationship: Alistair & Elara'), 'relationship');
    assert.equal(UTILITY.getEntryCategory('The Whispering Woods (World)'), 'world');
    assert.equal(UTILITY.getEntryCategory('Alistair\'s Sword'), 'other');
});

test('cleanFactContent: strips category prefixes and trailing annotations', () => {
    assert.equal(UTILITY.cleanFactContent('Character: Pac is a wizard.'), 'Pac is a wizard.');
    assert.equal(UTILITY.cleanFactContent('Event details: Arrival in town.'), 'Arrival in town.');
    assert.equal(UTILITY.cleanFactContent('He is nice. (Character Details)'), 'He is nice.');
    assert.equal(UTILITY.cleanFactContent('She is happy (Relationship Update)'), 'She is happy');
    assert.equal(UTILITY.cleanFactContent('- Pac is a wizard. -'), 'Pac is a wizard.');
});

// ─── migrateGameState ────────────────────────────────────────────────────────
test('migrateGameState: handles nullish/empty/invalid input gracefully', () => {
    const emptyGs = UTILITY.migrateGameState(null);
    deepEq(emptyGs.resources, []);
    deepEq(emptyGs.relationships, []);
    deepEq(emptyGs.journal, []);

    const emptyObj = UTILITY.migrateGameState({});
    deepEq(emptyObj.resources, []);
    deepEq(emptyObj.relationships, []);
    deepEq(emptyObj.journal, []);
});

test('migrateGameState: migrates legacy simple string resources and journal entries', () => {
    const legacyGs = {
        resources: ['Rusted Key', 'Gold Coin'],
        journal: ['Escape the dungeon', 'Find Thorne'],
        relationships: []
    };
    const migrated = UTILITY.migrateGameState(legacyGs);
    assert.equal(migrated.resources.length, 2);
    assert.equal(migrated.resources[0].name, 'Rusted Key');
    assert.equal(migrated.resources[0].value, 1);
    assert.equal(migrated.resources[0].type, 'Misc');
    assert.equal(migrated.resources[0].rarity, 'Common');

    assert.equal(migrated.journal.length, 2);
    assert.equal(migrated.journal[0].title, 'Escape the dungeon');
    assert.equal(migrated.journal[0].objective, 'Escape the dungeon');
    assert.equal(migrated.journal[0].status, 'active');
});

test('migrateGameState: migrates/retains existing rich fields, setting default values', () => {
    const rawGs = {
        resources: [
            { name: 'Excalibur', value: 1, description: 'Legendary sword', type: 'Weapon', rarity: 'Legendary' }
        ],
        journal: [
            { title: 'Slay the Dragon', status: 'completed', objective: 'Strike down the beast', objectives: [{ text: 'Locate lair', status: 'completed' }] }
        ],
        relationships: [
            { characterName: 'Gimli', value: 75, track: 'Trust', stance: 'Loyal companion' }
        ]
    };
    const migrated = UTILITY.migrateGameState(rawGs);
    
    // Check Excalibur
    assert.equal(migrated.resources[0].name, 'Excalibur');
    assert.equal(migrated.resources[0].rarity, 'Legendary');
    assert.ok(migrated.resources[0].id);

    // Check Slay the Dragon
    assert.equal(migrated.journal[0].status, 'completed');
    assert.equal(migrated.journal[0].objectives[0].text, 'Locate lair');

    // Check Gimli
    assert.equal(migrated.relationships[0].characterName, 'Gimli');
    assert.equal(migrated.relationships[0].track, 'Trust');
    assert.equal(migrated.relationships[0].stance, 'Loyal companion');
    deepEq(migrated.relationships[0].history, []);
});

test('getDefaultSystemPrompts: includes prompt_adjacent_locations_gen default value', () => {
    const prompts = UTILITY.getDefaultSystemPrompts();
    assert.ok(prompts.prompt_adjacent_locations_gen);
    assert.ok(prompts.prompt_adjacent_locations_gen.includes('{target_coords}'));
    assert.ok(prompts.prompt_adjacent_locations_gen.includes('{surrounding_locations}'));
});

// ─── parseJournalExtractions ──────────────────────────────────────────

test('parseJournalExtractions: empty/null input returns empty array', () => {
    deepEq(UTILITY.parseJournalExtractions(''), []);
    deepEq(UTILITY.parseJournalExtractions(null), []);
});

test('parseJournalExtractions: parses plot and reflection lines correctly', () => {
    const text = `
    [PLOT] The group entered the ancient ruins.
    [REFLECTION: Arthur] Arthur felt a deep sense of dread.
    [PLOT] They discovered a glowing magical artifact.
    [REFLECTION: Merlin] Merlin was fascinated by the artifact's ancient runes.
    [INVALID] Some invalid line that should be ignored.
    `;
    const expected = [
        { type: 'plot', content: 'The group entered the ancient ruins.' },
        { type: 'reflection', character_name: 'Arthur', content: 'Arthur felt a deep sense of dread.' },
        { type: 'plot', content: 'They discovered a glowing magical artifact.' },
        { type: 'reflection', character_name: 'Merlin', content: "Merlin was fascinated by the artifact's ancient runes." }
    ];
    deepEq(UTILITY.parseJournalExtractions(text), expected);
});

test('lookbehind assertions check: ensures no (?<= or (?<! exist in index.html or js/', () => {
    const files = [HTML_PATH, ...listSourceFiles(path.join(__dirname, 'js'))];
    const matches = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const lookbehindRegex = /\(\?<=|\(\?<!/g;
        let match;
        while ((match = lookbehindRegex.exec(text)) !== null) {
            const lineNum = text.substring(0, match.index).split('\n').length;
            const lineContent = text.split('\n')[lineNum - 1].trim();
            matches.push(`${path.relative(__dirname, file)}:${lineNum}: ${lineContent}`);
        }
    }
    assert.deepEqual(matches, [], `Found lookbehind assertions:\n${matches.join('\n')}`);
});

// ─── AutoBackup Helpers ──────────────────────────────────────────────────

test('buildBackupPayload: builds structured payload from arrays', () => {
    const stories = [{ id: 's1', title: 'Test Story' }];
    const nars = [{ id: 'n1', title: 'Test Narrative' }];
    const folders = [{ id: 'f1', name: 'Test Folder' }];
    const payload = UTILITY.buildBackupPayload(stories, nars, folders, '2.0');

    assert.equal(payload.version, '2.0');
    assert.equal(payload.storiesCount, 1);
    assert.equal(payload.narrativesCount, 1);
    assert.equal(payload.foldersCount, 1);
    assert.ok(payload.timestamp);
});

test('validateBackupData: validates structure and detects empty state', () => {
    const invalid = UTILITY.validateBackupData(null);
    assert.equal(invalid.valid, false);

    const empty = UTILITY.validateBackupData({ stories: [], narratives: [] });
    assert.equal(empty.valid, false);

    const valid = UTILITY.validateBackupData({ stories: [{ id: 's1' }], narratives: [] });
    assert.equal(valid.valid, true);
    assert.equal(valid.storiesCount, 1);
});

test('sanitizeBackupForLocalStorage: strips image properties and prunes large chat histories', () => {
    const payload = {
        stories: [{ id: 's1', characterImages: { a: 'blob' } }],
        narratives: [{ id: 'n1', chat_history: Array(100).fill({ role: 'user', content: 'hello' }) }]
    };
    const sanitized = UTILITY.sanitizeBackupForLocalStorage(payload, 500);
    assert.ok(sanitized);
    assert.equal(sanitized.stories[0].characterImages, undefined);
    assert.ok(sanitized.narratives[0].chat_history.length <= 50);
});

test('isBackupNewerOrRicher: compares backup vs current state correctly', () => {
    const backup = {
        timestamp: new Date().toISOString(),
        stories: [{ id: 's1' }],
        narratives: [{ id: 'n1' }]
    };
    // Primary DB is empty
    assert.equal(UTILITY.isBackupNewerOrRicher(backup, [], []), true);
    // Primary DB has same count (intact, backup not needed)
    assert.equal(UTILITY.isBackupNewerOrRicher(backup, [{ id: 's1' }], [{ id: 'n1' }]), false);
    // Primary DB has more data
    assert.equal(UTILITY.isBackupNewerOrRicher(backup, [{ id: 's1' }, { id: 's2' }], [{ id: 'n1' }, { id: 'n2' }]), false);
});

test('resolvePromptText: extracts plain text from strings, objects, and nested structures', () => {
    assert.equal(UTILITY.resolvePromptText('hello world'), 'hello world');
    assert.equal(UTILITY.resolvePromptText({ text: 'prompt text', images: [] }), 'prompt text');
    assert.equal(UTILITY.resolvePromptText({ prompt: 'prompt text', model: 'gemini' }), 'prompt text');
    assert.equal(UTILITY.resolvePromptText({ prompt: { text: 'nested prompt' } }), 'nested prompt');
    assert.equal(UTILITY.resolvePromptText(null), '');
    assert.equal(UTILITY.resolvePromptText(undefined), '');
});

test('getEntryCategory: resolves category from title tag or entry object category property', () => {
    assert.equal(UTILITY.getEntryCategory('[Event] Battle of Waterloo'), 'event');
    assert.equal(UTILITY.getEntryCategory('[Character: Arthur]'), 'character');
    assert.equal(UTILITY.getEntryCategory('[Item] Excalibur'), 'item');
    assert.equal(UTILITY.getEntryCategory('[World] Camelot'), 'world');
    assert.equal(UTILITY.getEntryCategory('[Relationship] Arthur & Guinevere'), 'relationship');
    assert.equal(UTILITY.getEntryCategory('Plain Lore Title'), 'other');
    assert.equal(UTILITY.getEntryCategory({ title: 'Plain Lore', category: 'world' }), 'world');
    assert.equal(UTILITY.getEntryCategory({ title: '[Event] Siege', category: 'event' }), 'event');
    assert.equal(UTILITY.getEntryCategory({ title: '[Item] Ring', category: 'other' }), 'item');
    assert.equal(UTILITY.getEntryCategory(null), 'other');
});

test('formatTitleWithCategory: applies and updates category tags on title strings correctly', () => {
    assert.equal(UTILITY.formatTitleWithCategory('Dragon Attack', 'event'), '[Event] Dragon Attack');
    assert.equal(UTILITY.formatTitleWithCategory('Arthur', 'character'), '[Character: Arthur]');
    assert.equal(UTILITY.formatTitleWithCategory('Excalibur', 'item'), '[Item] Excalibur');
    assert.equal(UTILITY.formatTitleWithCategory('Camelot', 'world'), '[World] Camelot');
    assert.equal(UTILITY.formatTitleWithCategory('Arthur & Guinevere', 'relationship'), '[Relationship] Arthur & Guinevere');
    assert.equal(UTILITY.formatTitleWithCategory('[Event] Dragon Attack', 'world'), '[World] Dragon Attack');
    assert.equal(UTILITY.formatTitleWithCategory('[Item] Magic Wand', 'other'), 'Magic Wand');
    assert.equal(UTILITY.formatTitleWithCategory('', 'event'), '[Event] Untitled');
});

// ─── normalizeVisionEndpoint ──────────────────────────────────────────────

test('normalizeVisionEndpoint: bare host gains a scheme', () => {
    assert.equal(UTILITY.normalizeVisionEndpoint('localhost:5001'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('192.168.1.40:1234'), 'http://192.168.1.40:1234');
});

test('normalizeVisionEndpoint: existing scheme is preserved, including https', () => {
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('https://vision.example.com'), 'https://vision.example.com');
});

test('normalizeVisionEndpoint: trailing slashes are stripped', () => {
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001///'), 'http://localhost:5001');
});

test('normalizeVisionEndpoint: a pasted chat-completions path collapses to the origin', () => {
    // People copy the full URL out of provider docs. All of these must reach the same base,
    // or VisionBridgeService would build http://host/v1/chat/completions/v1/chat/completions.
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/v1/chat/completions'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/v1/chat/completions/'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/chat/completions'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/v1'), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://localhost:5001/v1/'), 'http://localhost:5001');
});

test('normalizeVisionEndpoint: whitespace is tolerated', () => {
    assert.equal(UTILITY.normalizeVisionEndpoint('  http://localhost:5001  '), 'http://localhost:5001');
    assert.equal(UTILITY.normalizeVisionEndpoint('http://local host:5001'), 'http://localhost:5001');
});

test('normalizeVisionEndpoint: unusable input yields an empty string, never a bare scheme', () => {
    // The caller treats "" as "fall back to the default port". Returning "http://" would
    // instead produce a real fetch to a nonsense URL.
    assert.equal(UTILITY.normalizeVisionEndpoint(''), '');
    assert.equal(UTILITY.normalizeVisionEndpoint('   '), '');
    assert.equal(UTILITY.normalizeVisionEndpoint('/v1/chat/completions'), '');
    assert.equal(UTILITY.normalizeVisionEndpoint(null), '');
    assert.equal(UTILITY.normalizeVisionEndpoint(undefined), '');
    assert.equal(UTILITY.normalizeVisionEndpoint(42), '');
});

// ─── buildVisionContextBlock ──────────────────────────────────────────────

test('buildVisionContextBlock: nothing describable yields an empty string', () => {
    // "" is the signal that the bridge produced nothing, so callAI falls back to the
    // original no-vision notice. Any non-empty string here would be injected verbatim.
    assert.equal(UTILITY.buildVisionContextBlock([]), '');
    assert.equal(UTILITY.buildVisionContextBlock(['', '   ']), '');
    assert.equal(UTILITY.buildVisionContextBlock(null), '');
    assert.equal(UTILITY.buildVisionContextBlock('a string, not an array'), '');
});

test('buildVisionContextBlock: a single image is not numbered', () => {
    const out = UTILITY.buildVisionContextBlock(['A red bicycle leaning on a wall.']);
    assert.ok(out.includes('an image'), 'should read naturally for one image');
    assert.ok(out.includes('A red bicycle leaning on a wall.'));
    assert.ok(!out.includes('Image 1:'), 'single image should not be enumerated');
});

test('buildVisionContextBlock: multiple images are numbered in order', () => {
    const out = UTILITY.buildVisionContextBlock(['First scene.', 'Second scene.']);
    assert.ok(out.includes('2 images'));
    assert.ok(out.includes('Image 1: First scene.'));
    assert.ok(out.includes('Image 2: Second scene.'));
    assert.ok(out.indexOf('Image 1:') < out.indexOf('Image 2:'), 'order must match upload order');
});

test('buildVisionContextBlock: blank entries are dropped without disturbing numbering', () => {
    const out = UTILITY.buildVisionContextBlock(['Kept one.', '   ', 'Kept two.']);
    assert.ok(out.includes('2 images'));
    assert.ok(out.includes('Image 1: Kept one.'));
    assert.ok(out.includes('Image 2: Kept two.'));
    assert.ok(!out.includes('Image 3:'));
});

test('buildVisionContextBlock: entries are trimmed', () => {
    const out = UTILITY.buildVisionContextBlock(['  padded description  ']);
    assert.ok(out.includes('padded description'));
    assert.ok(!out.includes('  padded description  '));
});

test('buildVisionContextBlock: instructs the model never to reveal the mechanism', () => {
    // The whole point of silent injection. A character replying "based on the image
    // description provided" breaks immersion and would make the feature worse than useless.
    const out = UTILITY.buildVisionContextBlock(['A quiet street at dusk.']);
    assert.ok(out.includes('[VISUAL CONTEXT]'));
    assert.ok(/never mention this/i.test(out));
    assert.ok(/described to you/i.test(out));
});

// ─── appAssetUrl ─────────────────────────────────────────────────────────

test('appAssetUrl: with no page loaded, the path comes back unchanged', () => {
    assert.equal(UTILITY.appAssetUrl('assets/demo/user.png'), 'assets/demo/user.png');
});

test('appAssetUrl: resolves against the page address, including a GitHub Pages subfolder', () => {
    const pageUtility = vm.runInNewContext(extractBlock('UTILITY') + '\nUTILITY', {
        URL,
        document: { baseURI: 'https://example.github.io/rolecraft/index.html' },
    });
    assert.equal(pageUtility.appAssetUrl('assets/demo/user.png'), 'https://example.github.io/rolecraft/assets/demo/user.png');
});

test('appAssetUrl: resolved addresses start with http, so image code treats them as links not database keys', () => {
    const pageUtility = vm.runInNewContext(extractBlock('UTILITY') + '\nUTILITY', {
        URL,
        document: { baseURI: 'http://localhost:8781/' },
    });
    assert.ok(pageUtility.appAssetUrl('assets/demo/kael.png').startsWith('http'));
});

// ─── AgentSchema ─────────────────────────────────────────────────────────
// Loaded whole from its own file; it is pure, so the sandbox needs no stubs.

const AgentSchema = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'agent-schema.js'), 'utf8') + '\nAgentSchema', {});

test('AgentSchema.normalize: fills every field and clamps bad values', () => {
    const a = AgentSchema.normalize({ name: '  ', kind: 'weird', trigger: { probability: 250, everyMessages: -3 }, placement: { depth: 'x', role: 'narrator' } });
    assert.equal(a.name, 'Untitled agent');
    assert.equal(a.kind, 'note');
    assert.equal(a.trigger.probability, 100);
    assert.equal(a.trigger.everyMessages, 0);
    assert.equal(a.placement.depth, 4);
    assert.equal(a.placement.role, 'system');
    assert.equal(a.helper.display, 'card');
    assert.equal(a.defaultOn, false);
});

test('AgentSchema.normalize: keywords accept a comma string or an array', () => {
    deepEq(AgentSchema.normalize({ trigger: { keywords: 'kiss, fight ,' } }).trigger.keywords, ['kiss', 'fight']);
    deepEq(AgentSchema.normalize({ trigger: { keywords: [' kiss', ''] } }).trigger.keywords, ['kiss']);
});

// Shapes taken from real SillyBunny 1.7.0 agent files.
const SB_INLINE = {
    id: 'sb-1', name: 'Friction Mode', description: 'Adds friction', execution: 'inline', phase: 'pre',
    prompt: 'Make {{char}} push back on {{user}}.', enabled: true, modelOverride: '', connectionProfile: '',
    injection: { position: 1, depth: 4, role: 0, order: 90, scan: false },
    preProcess: { mode: 'inject' }, postProcess: { enabled: false, promptTransformEnabled: false },
    conditions: { triggerKeywords: [], triggerProbability: 100 }, regexScripts: []
};
const SB_COMPANION = {
    id: 'sb-2', name: 'Memory Shard', execution: 'companion', phase: 'post', prompt: 'Compress history.', enabled: false,
    injection: { position: 0, depth: 4, role: 1, order: 100 },
    companion: {
        trigger: 'auto', displayMode: 'panel', contextMessages: 30, includeCharacterCard: false, includeWorldInfo: false,
        includeHistory: true, historyDepth: 3, feedback: { enabled: true, depth: 1 }, batch: false, dependencies: []
    },
    preProcess: { mode: 'inject' }, postProcess: { enabled: false }, conditions: { triggerProbability: 100, triggerKeywords: [] }
};

test('AgentSchema.fromSillyBunny: an inline inject agent becomes a note agent with its placement', () => {
    const a = AgentSchema.fromSillyBunny(SB_INLINE);
    assert.equal(a.kind, 'note');
    assert.equal(a.defaultOn, true);
    deepEq(a.placement, { position: 'chat', depth: 4, role: 'system', order: 90 });
    assert.equal(a.source.app, 'sillybunny');
    deepEq(a.source.skipped, []);
});

test('AgentSchema.fromSillyBunny: a companion becomes a helper agent', () => {
    const a = AgentSchema.fromSillyBunny(SB_COMPANION);
    assert.equal(a.kind, 'helper');
    assert.equal(a.helper.display, 'panel');
    assert.equal(a.helper.contextMessages, 30);
    assert.equal(a.helper.priorNotes, 3);
    assert.equal(a.helper.feedForward, true);
    assert.equal(a.helper.includeCharacters, false);
    assert.equal(a.placement.position, 'top');
    assert.equal(a.placement.role, 'user');
});

test('AgentSchema.fromSillyBunny: unsupported features are listed and intercepts arrive switched off', () => {
    const a = AgentSchema.fromSillyBunny({ ...SB_INLINE, preProcess: { mode: 'intercept' }, regexScripts: [{}, {}], connectionProfile: 'GLM' });
    assert.equal(a.defaultOn, false);
    assert.equal(a.source.skipped.length, 3);
    assert.ok(a.source.skipped.some(s => s.includes('2 regex')));
});

test('AgentSchema.parseImport: reads a SillyBunny pack, a single agent, and a Rolecraft bundle', () => {
    const pack = AgentSchema.parseImport(JSON.stringify({ format: 'sillybunny-inchat-agents', version: 1, agents: [SB_INLINE, SB_COMPANION] }));
    assert.equal(pack.agents.length, 2);
    assert.ok(pack.agents.every(a => a.id === ''));

    const single = AgentSchema.parseImport(JSON.stringify(SB_INLINE));
    assert.equal(single.agents[0].name, 'Friction Mode');

    const own = AgentSchema.buildExport([AgentSchema.normalize({ id: 'x', name: 'Mine', prompt: 'Hi', builtin: 'event_master' })]);
    const back = AgentSchema.parseImport(JSON.stringify(own));
    assert.equal(back.agents[0].name, 'Mine');
    assert.equal(back.agents[0].builtin, '', 'an import can never claim to drive a built-in feature');
});

test('AgentSchema.parseImport: bad files explain themselves', () => {
    assert.throws(() => AgentSchema.parseImport('not json'), /not valid JSON/);
    assert.throws(() => AgentSchema.parseImport('{"hello": 1}'), /No agents found/);
});

test('AgentSchema.isOn: the story switch wins, otherwise the agent default', () => {
    const a = { id: 'a1', defaultOn: true };
    assert.equal(AgentSchema.isOn(a, {}), true);
    assert.equal(AgentSchema.isOn(a, { a1: false }), false);
    assert.equal(AgentSchema.isOn({ id: 'a2', defaultOn: false }, { a2: true }), true);
});

test('AgentSchema.shouldFire: schedule, keywords, then chance', () => {
    const base = AgentSchema.normalize({});
    assert.equal(AgentSchema.shouldFire(base, { messageCounter: 1, recentTexts: [], roll: 0.99 }), true);

    const every6 = AgentSchema.normalize({ trigger: { everyMessages: 6 } });
    assert.equal(AgentSchema.shouldFire(every6, { messageCounter: 5, recentTexts: [], roll: 0 }), false);
    assert.equal(AgentSchema.shouldFire(every6, { messageCounter: 12, recentTexts: [], roll: 0 }), true);
    assert.equal(AgentSchema.shouldFire(every6, { messageCounter: 0, recentTexts: [], roll: 0 }), false);

    const kw = AgentSchema.normalize({ trigger: { keywords: ['Kiss'], keywordDepth: 2 } });
    assert.equal(AgentSchema.shouldFire(kw, { recentTexts: ['a kiss', 'nothing', 'still nothing'], roll: 0 }), false);
    assert.equal(AgentSchema.shouldFire(kw, { recentTexts: ['old', 'she leans in to KISS him', 'x'], roll: 0 }), true);

    const chance = AgentSchema.normalize({ trigger: { probability: 25 } });
    assert.equal(AgentSchema.shouldFire(chance, { roll: 0.24 }), true);
    assert.equal(AgentSchema.shouldFire(chance, { roll: 0.25 }), false);
    assert.equal(AgentSchema.shouldFire(AgentSchema.normalize({ trigger: { probability: 0 } }), { roll: 0 }), false);
});

test('AgentSchema.expandMacros: both placeholder styles and random picks', () => {
    const ctx = { char: 'Wren', user: 'Player', pick: () => 1 };
    assert.equal(AgentSchema.expandMacros('{{char}} and {{user}}; {character} and {user}', ctx), 'Wren and Player; Wren and Player');
    assert.equal(AgentSchema.expandMacros('{{random::rain::snow}}', ctx), 'snow');
    assert.equal(AgentSchema.expandMacros('{{random:rain, snow}}', ctx), 'snow');
});

test('AgentSchema.layoutNotes: depth counts up from the newest message', () => {
    const notes = [
        { text: 'deep', position: 'chat', depth: 4, order: 100 },
        { text: 'last', position: 'chat', depth: 0, order: 100 },
        { text: 'first-in-order', position: 'chat', depth: 1, order: 10 },
        { text: 'also-depth-1', position: 'chat', depth: 1, order: 50 },
        { text: 'top', position: 'top', order: 100 },
        { text: 'before', position: 'before', order: 100 },
        { text: 'too-deep', position: 'chat', depth: 99, order: 100 },
        { text: '', position: 'chat', depth: 1 }
    ];
    const layout = AgentSchema.layoutNotes(notes, 6);
    deepEq(layout.end.map(n => n.text), ['last']);
    deepEq(layout.beforeMessage[5].map(n => n.text), ['first-in-order', 'also-depth-1']);
    deepEq(layout.beforeMessage[2].map(n => n.text), ['deep']);
    deepEq(layout.beforeMessage[0].map(n => n.text), ['too-deep']);
    deepEq(layout.top.map(n => n.text), ['top']);
    deepEq(layout.before.map(n => n.text), ['before']);
});

test('AgentSchema.layoutNotes: with no messages every chat note goes to the end', () => {
    const layout = AgentSchema.layoutNotes([{ text: 'x', position: 'chat', depth: 3 }], 0);
    deepEq(layout.end.map(n => n.text), ['x']);
});

test('AgentSchema.shouldFire: waits until the chat reaches the minimum size', () => {
    const shard = AgentSchema.normalize({ kind: 'helper', trigger: { minTokens: 30000 } });
    assert.equal(AgentSchema.shouldFire(shard, { chatTokens: 29999, roll: 0 }), false);
    assert.equal(AgentSchema.shouldFire(shard, { chatTokens: 30000, roll: 0 }), true);
});

test('AgentSchema.fromSillyBunny: a companion keeps its minimum context size; inline agents do not get one', () => {
    const shard = AgentSchema.fromSillyBunny({ ...SB_COMPANION, companion: { ...SB_COMPANION.companion, minContextTokens: 30000 } });
    assert.equal(shard.trigger.minTokens, 30000);
    assert.equal(AgentSchema.fromSillyBunny({ ...SB_INLINE, companion: { minContextTokens: 500 } }).trigger.minTokens, 0);
});

test('AgentSchema.estimateTokens: about four characters per token', () => {
    assert.equal(AgentSchema.estimateTokens(''), 0);
    assert.equal(AgentSchema.estimateTokens('abcd'), 1);
    assert.equal(AgentSchema.estimateTokens('abcde'), 2);
});

test('AgentSchema.fromSillyBunny: an inline tracker becomes a panel helper that feeds its state forward', () => {
    const tracker = {
        ...SB_INLINE, name: 'Time Tracker', category: 'tracker', enabled: true,
        postProcess: { enabled: true, type: 'extract' }, regexScripts: [{}],
        companion: { includeHistory: true, historyDepth: 3, contextMessages: 10 }
    };
    const a = AgentSchema.fromSillyBunny(tracker);
    assert.equal(a.kind, 'helper');
    assert.equal(a.defaultOn, true);
    assert.equal(a.helper.run, 'auto');
    assert.equal(a.helper.display, 'panel');
    assert.equal(a.helper.feedForward, true);
    assert.equal(a.helper.priorNotes, 3);
    assert.equal(a.source.skipped.length, 1, 'only the conversion note; its reply regex no longer applies');
    assert.ok(a.source.skipped[0].includes('Agent notes panel'));
});

test('AgentSchema.fromSillyBunny: a tracker set to intercept is not converted', () => {
    const a = AgentSchema.fromSillyBunny({ ...SB_INLINE, category: 'tracker', preProcess: { mode: 'intercept' } });
    assert.equal(a.kind, 'note');
    assert.equal(a.defaultOn, false);
});

test('AgentSchema.isEmptyResult: blank answers and tracker-none are not notes', () => {
    assert.equal(AgentSchema.isEmptyResult(''), true);
    assert.equal(AgentSchema.isEmptyResult('  tracker-none \n'), true);
    assert.equal(AgentSchema.isEmptyResult('Tracker-None.'), true);
    assert.equal(AgentSchema.isEmptyResult('[TIME|Day 2|Evening]'), false);
});

test('AgentSchema.createEventMaster: a hidden, feed-once helper placed one message back', () => {
    const em = AgentSchema.createEventMaster(35);
    assert.equal(em.builtin, 'event_master');
    assert.equal(em.kind, 'helper');
    assert.equal(em.trigger.probability, 35);
    assert.equal(em.helper.display, 'hidden');
    assert.equal(em.helper.feedForward, true);
    assert.equal(em.helper.feedOnce, true);
    deepEq(em.placement, { position: 'chat', depth: 1, role: 'system', order: 50 });
    assert.ok(em.prompt.includes('{{random::'), 'rolls a kind of surprise each run');
    assert.ok(em.prompt.includes('{{user}}'), 'keeps the user in charge of their own character');
});

test('AgentSchema.createEventMaster: its surprise roll expands to exactly one option', () => {
    const em = AgentSchema.createEventMaster();
    const expanded = AgentSchema.expandMacros(em.prompt, { char: 'Wren', user: 'Player', pick: () => 0 });
    assert.ok(!expanded.includes('{{'));
    assert.ok(expanded.includes('This time the surprise is: A practical snag'));
    assert.ok(!expanded.includes('An interruption'));
});

test('AgentSchema.pickFeedNotes: feed-once skips notes already used', () => {
    const notes = [{ id: 'a', usedAt: 5 }, { id: 'b' }, { id: 'c', usedAt: 9 }];
    deepEq(AgentSchema.pickFeedNotes(notes, { feedOnce: true, feedCount: 1 }).map(n => n.id), ['b']);
    deepEq(AgentSchema.pickFeedNotes(notes, { feedOnce: false, feedCount: 2 }).map(n => n.id), ['b', 'c']);
    deepEq(AgentSchema.pickFeedNotes([{ id: 'a', usedAt: 1 }], { feedOnce: true, feedCount: 1 }), []);
});

// A character card carries more than a description. Anything the converter does not read is gone
// the moment the card is imported, and nothing reports it — the character just arrives incomplete.
test('importing a character card keeps who the character is', () => {
    const ie = fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8');
    assert.match(ie, /asPersona\(v2Data\.personality\)/,
        "a card's personality belongs with its description, not dropped");
    assert.match(ie, /v2Data\.post_history_instructions/,
        "a card's post-history instructions must reach the model somewhere");
    assert.match(ie, /story\.card_creator = String\(v2Data\.creator\)/,
        'who made the card should survive the import');
});

// Exporting a card is how a story gets shared. Anything the exporter writes blank is missing for
// whoever opens it, and for you if you ever import your own card back.
test('exporting a character card carries the lore and the extra openings', () => {
    const ie = fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8');
    assert.match(ie, /Array\.isArray\(entry\.content_fields\)/,
        'lore text lives in content_fields; reading entry.content exports empty entries');
    assert.doesNotMatch(ie, /alternate_greetings: \[\],/,
        'alternate_greetings must be built from the story, not hardcoded empty');
    assert.match(ie, /alternate_greetings: \(story\.scenarios \|\| \[\]\)/,
        "a story's other openings must be exported");
});

// Both card exporters had the same trap: lore text is in content_fields, and reading entry.content
// writes an entry with the right name and nothing in it.
test('both card exporters read lore text from where it is actually kept', () => {
    const ie = fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8');
    // Only dynamic entries keep their text in content_fields; static and world-map entries
    // really do use .content, so this checks the two dynamic-entry exporters specifically.
    const reads = ie.match(/Array\.isArray\(entry\.content_fields\)/g) || [];
    assert.equal(reads.length, 2, 'the V2 and BYAF exporters must both read content_fields');
    assert.doesNotMatch(ie, /\n\s*value: entry\.content \|\| "",/, 'BYAF lore must not read entry.content alone');
});

// Example turns arrive in one of two places depending on the format, so an exporter that only
// knows one of them sends the character out with its example dialogue missing.
test('card exporters find example turns wherever the import filed them', () => {
    const ie = fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8');
    assert.match(ie, /_exampleTurns\(story, narrative\) \{/, 'the shared helper must exist');
    assert.match(ie, /scenario\.example_dialogue : \[\]/, 'it must fall back to the scenario example dialogue');
    const uses = ie.match(/this\._exampleTurns\(story, narrative\)/g) || [];
    assert.equal(uses.length, 2, 'both the V2 and BYAF exporters must use it');
});

// Restoring a library replaces everything, so it has to be sure the file is really a library
// backup before it clears anything. A single story's .zip is also a valid zip full of valid JSON,
// and picking one by mistake used to empty the library and import nothing, silently.
test('restoring a library refuses anything that is not a library backup', () => {
    const story = fs.readFileSync(path.join(__dirname, 'js', 'services', 'story.js'), 'utf8');
    const fn = story.slice(story.indexOf('async importLibraryFromZip('));
    const body = fn.slice(0, fn.indexOf('\n            async ', 1));

    const guardAt = body.indexOf('if (!storiesFile)');
    const clearAt = body.indexOf('DBService.clearStore("stories")');
    assert.notEqual(guardAt, -1, 'a missing data/stories.json must be refused');
    assert.notEqual(clearAt, -1, 'expected the clear step to still be here');
    assert.ok(guardAt < clearAt, 'the check must happen before anything is cleared');

    assert.match(body, /if \(!Array\.isArray\(stories\)\)/, 'stories.json must be checked to be a list');
    const emptyAt = body.indexOf('if (stories.length === 0)');
    assert.notEqual(emptyAt, -1, 'an empty backup must be refused when there is something to lose');
    assert.ok(emptyAt < clearAt, 'the empty-backup check must also happen before clearing');
});

// Parts of a story are filed under a character's id rather than holding it in a field. Everyone
// gets a new id on import, so these have to be moved across with them or the story comes back with
// its personas reset, its stat bars empty and its secrets gone — with nothing reporting a problem.
test('importing a story carries character-keyed data across to the new ids', () => {
    const ie = fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8');
    assert.match(ie, /const CHARACTER_KEYED = \[/, 'the character-keyed structures must be listed');
    for (const key of ['evolved_characters', 'character_stats', 'livingPersonaCounters',
        'last_stat_deltas', 'swarmSecrets', 'swarmLastIntents', 'swarmNarrativeCapital']) {
        assert.ok(ie.includes(`'${key}'`), `${key} must be remapped on import`);
    }
    assert.match(ie, /remapCharacterKeyed\(n\.state\)/, 'every imported narrative must be remapped');
    assert.match(ie, /entry\.characterId = charIdMap\[entry\.characterId\]/,
        'journal entries that name a character must be remapped too');
});

// The story's own system prompt lives at state.system_prompt. A camelCase state.systemPrompt is a
// key nothing ever writes, so reading it silently falls through to a generic fallback — which is
// exactly what Swarm mode used to do with everyone's custom storyteller instructions.
test('prompts read the story system prompt under the name it is stored as', () => {
    const builder = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    const camel = builder.match(/state\.systemPrompt\b/g) || [];
    assert.equal(camel.length, 0,
        'prompt-builder reads state.systemPrompt, which nothing writes; it is state.system_prompt');
    assert.match(builder, /state\.system_prompt/, 'the story system prompt must be read somewhere');
});

// Stats come from the model, and a story restored from an old save or another app may hold a shape
// this never expected. Building a prompt must not be the thing that breaks.
test('a stats record that is not a list cannot break prompt building', () => {
    const builder = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    assert.match(builder, /if \(!Array\.isArray\(charStats\) \|\| charStats\.length === 0\) continue;/,
        '_buildStatsContext must check it really has a list before mapping over it');
});

// The cache marker is only meaningful to providers that split the prompt on it. Every other
// provider has to strip it, or the model gets a stray <|...|> token in the middle of the story.
test('every provider strips the cache marker before sending', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const bodies = api.split(/\n            async (?=(?:call|stream)[A-Za-z]*\()/).slice(1);
    const senders = bodies
        .map(b => ({ name: b.slice(0, b.indexOf('(')), body: b }))
        .filter(x => !['callAI'].includes(x.name));
    const leaking = senders.filter(x => !x.body.includes('ELLIPSIS_CACHE_BREAK')).map(x => x.name);
    assert.deepStrictEqual(leaking, [], `these send the cache marker to the model: ${leaking.join(', ')}`);
});

// A one-shot note is spent when a reply prompt carries it. Looking at the prompt preview builds a
// prompt that is never sent, so it has to leave the note pending — otherwise the reply the Event
// Master planned a surprise for silently arrives without one.
test('a preview prompt does not spend a feed-once note', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'agents.js'), 'utf8');
    assert.match(controller, /buildNoteLayout\(charToAct, messageCount, options = \{\}\)/,
        'buildNoteLayout must take an options argument');
    assert.match(controller, /if \(usedIds\.size && options\.preview !== true\)/,
        'a feed-once note may only be marked used when the prompt is really being sent');

    const builder = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    assert.match(builder, /buildPrompt\([^)]*options = \{\}\)/,
        'buildPrompt must take an options argument');
    assert.match(builder, /buildNoteLayout\([\s\S]{0,200}?\{ preview: options\.preview === true \}\)/,
        'buildPrompt must pass its preview flag through to the agents');

    const narrative = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    assert.match(narrative, /PromptBuilder\.buildPrompt\(charId, false, null, null, false, \{ preview: true \}\)/,
        'the prompt preview screen must ask for a preview build');
});

test('AgentSchema.legacyEventMasterSwitch: the old chance slider maps to on, off, or untouched', () => {
    assert.equal(AgentSchema.legacyEventMasterSwitch(20), true);
    assert.equal(AgentSchema.legacyEventMasterSwitch('15'), true);
    assert.equal(AgentSchema.legacyEventMasterSwitch(0), false);
    assert.equal(AgentSchema.legacyEventMasterSwitch(undefined), null);
    assert.equal(AgentSchema.legacyEventMasterSwitch('abc'), null);
});

// ─── AgentStarters ───────────────────────────────────────────────────────

const AgentStarters = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'agent-starters.js'), 'utf8') + '\nAgentStarters', { AgentSchema });

test('AgentStarters.list: every starter is complete, off by default, and has a unique stable key', () => {
    const list = AgentStarters.list();
    assert.ok(list.length >= 5);
    const keys = new Set(list.map(a => a.source.id));
    assert.equal(keys.size, list.length);
    assert.equal(new Set(list.map(a => a.name)).size, list.length);
    list.forEach(a => {
        assert.equal(a.defaultOn, false, a.name);
        assert.equal(a.source.app, 'rolecraft-starter', a.name);
        assert.equal(a.builtin, '', a.name + ' must stay deletable');
        assert.ok(a.prompt.trim().length > 80, a.name);
        assert.ok(!a.prompt.includes('{{') || /\{\{(char|user)\}\}/.test(a.prompt), a.name + ' uses only supported placeholders');
    });
});

test('AgentStarters.list: note agents never sit last in the prompt, where instructions get recited back', () => {
    AgentStarters.list().filter(a => a.kind === 'note').forEach(a => {
        assert.ok(a.placement.position !== 'chat' || a.placement.depth > 0, a.name);
    });
});

// ─── UndoStack ───────────────────────────────────────────────────────────

const UndoStack = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'undo-stack.js'), 'utf8') + '\nUndoStack', {});

const snap = (chat, counter = '1', lore = '[]') => ({ chat_history: chat, messageCounter: counter, static_entries: lore });

test('UndoStack.record: the first snapshot is the starting point, not a step', () => {
    const s = UndoStack.create();
    assert.equal(UndoStack.record(s, snap('[a]')), false);
    assert.equal(s.undo.length, 0);
});

test('UndoStack: a chat change becomes a step that undo and redo move across', () => {
    const s = UndoStack.create();
    UndoStack.record(s, snap('[a,b]'));
    assert.equal(UndoStack.record(s, snap('[a]', '0')), true, 'deleting b is a step');
    const back = UndoStack.undo(s);
    assert.equal(back.chat_history, '[a,b]');
    assert.equal(UndoStack.undo(s), null, 'nothing further back');
    assert.equal(UndoStack.redo(s).chat_history, '[a]');
    assert.equal(UndoStack.redo(s), null);
});

test('UndoStack: a knowledge-only change is not a step, but undo still takes it back and redo keeps the latest', () => {
    const s = UndoStack.create();
    UndoStack.record(s, snap('[a]', '1', '[]'));
    UndoStack.record(s, snap('[a,b]', '2', '[]'));
    assert.equal(UndoStack.record(s, snap('[a,b]', '2', '[fact]')), false, 'background knowledge update');
    assert.equal(s.undo.length, 1);
    assert.equal(UndoStack.undo(s).static_entries, '[]');
    assert.equal(UndoStack.redo(s).static_entries, '[fact]');
});

test('UndoStack: a new change after undoing clears redo', () => {
    const s = UndoStack.create();
    UndoStack.record(s, snap('[a]'));
    UndoStack.record(s, snap('[a,b]', '2'));
    UndoStack.undo(s);
    UndoStack.record(s, snap('[a,c]', '2'));
    assert.equal(s.redo.length, 0);
    assert.equal(UndoStack.undo(s).chat_history, '[a]');
});

test('UndoStack: old steps are dropped past the step limit and the size limit', () => {
    const s = UndoStack.create({ maxSteps: 3 });
    ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]'].forEach(c => UndoStack.record(s, snap(c)));
    assert.equal(s.undo.length, 3);
    assert.equal(s.undo[0].chat_history, '[3]');

    const big = UndoStack.create({ maxChars: 50 });
    ['x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30), 'w'.repeat(30)].forEach(c => UndoStack.record(big, snap(c)));
    assert.ok(big.undo.length >= 1 && big.undo.length < 3);
    assert.equal(big.undo[big.undo.length - 1].chat_history, 'z'.repeat(30), 'the most recent step always survives');
});

test('UndoStack: unchanged parts reuse the same stored text', () => {
    const s = UndoStack.create();
    const lore = JSON.stringify({ big: 'x'.repeat(1000) });
    UndoStack.record(s, snap('[a]', '1', lore));
    UndoStack.record(s, snap('[a,b]', '2', JSON.parse(JSON.stringify(lore))));
    assert.equal(s.current.static_entries, s.undo[0].static_entries);
});

// ─── DiagLog ─────────────────────────────────────────────────────────────

const loadDiagLog = () => vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'diag-log.js'), 'utf8') + '\nDiagLog', { Date });

test('DiagLog.redact: API keys and tokens never survive', () => {
    const log = loadDiagLog();
    log.setSecrets(['my-secret-openrouter-value']);
    const dirty = 'key sk-or-v1-abcdef1234567890 and Bearer abc.def-123456 url https://x.test/v1?key=AIzaSyAAAAAAAAAAAAAAAAAAAAAA&alt=1 plus my-secret-openrouter-value and ghp_abcdefghijklmnopqrstuvwx';
    const clean = log.redact(dirty);
    assert.ok(!clean.includes('sk-or-v1-abcdef'));
    assert.ok(!clean.includes('abc.def-123456'));
    assert.ok(!clean.includes('AIzaSy'));
    assert.ok(!clean.includes('my-secret-openrouter-value'));
    assert.ok(!clean.includes('ghp_abcdef'));
    assert.ok(clean.includes('&alt=1'), 'the rest of the line is kept');
});

test('DiagLog.add: secrets are scrubbed when written, not only when copied', () => {
    const log = loadDiagLog();
    log.add('ai', 'failed with Bearer sk-or-v1-zzzzzzzzzzzzzzzz', { text: 'prompt has sk-or-v1-yyyyyyyyyyyyyyyy' });
    const e = log.entries[0];
    assert.ok(!e.message.includes('zzzz'));
    assert.ok(!e.text.includes('yyyy'));
});

test('DiagLog.beginTurn: keeps only the last 5 turns', () => {
    const log = loadDiagLog();
    for (let turn = 1; turn <= 7; turn++) {
        log.beginTurn();
        log.add('send', `turn ${turn}`);
    }
    deepEq(log.entries.map(e => e.message), ['turn 3', 'turn 4', 'turn 5', 'turn 6', 'turn 7']);
});

test('DiagLog.format: story text only appears when switched on', () => {
    const log = loadDiagLog();
    log.beginTurn();
    log.add('reply', 'Wren replied (12 chars)', { textLabel: 'reply', text: 'SECRET STORY' });
    const without = log.format({ App: 'test' }, false);
    const withText = log.format({ App: 'test' }, true);
    assert.ok(without.includes('Wren replied (12 chars)'));
    assert.ok(!without.includes('SECRET STORY'));
    assert.ok(withText.includes('reply: SECRET STORY'));
    assert.ok(without.includes('Story text: not included'));
});

test('DiagLog: a runaway source cannot grow the diary without limit', () => {
    const log = loadDiagLog();
    for (let i = 0; i < 2000; i++) log.add('warn', `repeat ${i}`);
    assert.equal(log.entries.length, log.maxEntries);
    assert.equal(log.entries[log.entries.length - 1].message, 'repeat 1999');
});

test('callAI: the background timeout is long enough for an unstreamed whole-transcript call', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const budget = api.match(/CALL_TIMEOUT_MS:\s*(\d+)/);
    assert.ok(budget, 'the timeout budget is a named constant, not a magic number');
    assert.ok(Number(budget[1]) >= 120000, 'sixty seconds killed replies that were still on their way');
    assert.ok(!/let remainingMs = 60000/.test(api), 'the old hardcoded 60s budget is gone');
});

test('callAI: a timed-out background chore does not raise a red banner', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const abortBlock = api.slice(api.indexOf("if (error.name === 'AbortError')"), api.indexOf('const isNetworkError'));
    assert.ok(/if \(!silent && typeof UIManager/.test(abortBlock),
        'the timeout notice must honour silent, like the network-error path already does');
});

test('callAI: a timeout notice names the real provider instead of blaming a local backend', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    assert.ok(!/Check that your AI backend is running/.test(api),
        'that wording sent cloud users to check a backend that was answering fine');
    assert.ok(/_providerLabel\(state\.apiProvider\)/.test(api));
    assert.ok(/_isLocalProvider\(state\.apiProvider\)/.test(api),
        'only a local backend gets the "check that it is running" hint');
});

test('automatic post-turn chores are all marked silent', () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    for (const builder of [
        'buildTimelineExtractorPrompt',
        'buildRelationshipMatrixPrompt',
        'buildJournalExtractorPrompt',
        'buildArchivistCondensationPrompt'
    ]) {
        const at = nar.indexOf(builder);
        assert.ok(at > -1, `${builder} still exists`);
        const window = nar.slice(at, at + 400);
        assert.ok(/,\s*false,\s*null,\s*true\)/.test(window),
            `${builder} runs unasked every few messages; its failure must not interrupt the scene`);
    }
});

test('an empty reply is never committed as a blank message bubble', () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    const at = nar.indexOf('const genResult = await textGenPromise;');
    assert.ok(at > -1);
    const after = nar.slice(at, at + 2000);
    const guardAt = after.indexOf('if (!responseText || !responseText.trim())');
    const streamAt = after.indexOf('this.startStreamingResponse(');
    assert.ok(guardAt > -1, 'the empty reply must be caught');
    assert.ok(streamAt === -1 || guardAt < streamAt,
        'and caught before it reaches the screen, not after');
});

test('an empty reply says whether the model ran out of room', () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    assert.ok(nar.includes('UTILITY.emptyReplyReason(finishReason, thinkingText)')
        && UTILITY.emptyReplyReason('length', '') !== UTILITY.emptyReplyReason('stop', ''),
        'a reply cut off by the token cap reads differently from one the model declined');
    assert.ok(/emptyError\.reported = true/.test(nar),
        'marked reported so the catch below does not raise a second banner for it');
});

test('finish_reason is carried out of every OpenAI-compatible provider', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    assert.equal((api.match(/finish_reason \|\| choice\.native_finish_reason/g) || []).length, 3,
        'OpenRouter, NanoGPT and LM Studio each read it');
    assert.equal((api.match(/thinking: thinking\.trim\(\), finishReason \}/g) || []).length, 3);
    assert.ok(/return \{ text: cleanProse, thinking: this\.lastThinking, finishReason \}/.test(api),
        'and callAI passes it to the caller');
});

test('the output ceiling leaves room for a model that thinks before it answers', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const cap = api.match(/MAX_OUTPUT_TOKENS:\s*(\d+)/);
    assert.ok(cap, 'the ceiling is a named constant');
    assert.ok(Number(cap[1]) >= 4096, 'reasoning is billed against this budget too');
    assert.ok(!/max_tokens: 2048/.test(api), 'the old hardcoded 2048 ceiling is gone');
});

const StyleGuide = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'style-guide.js'), 'utf8') + '\nStyleGuide', {});

test('style guide: the ported preset carries both placements and its sampler', () => {
    assert.ok(StyleGuide.prefix.length > 5000, 'the prefix blocks came across');
    assert.ok(StyleGuide.lastMile.length > 3000, 'so did the ones injected next to the reply');
    assert.equal(StyleGuide.sampling.temperature, 0.7);
    assert.equal(StyleGuide.sampling.top_p, 0.8);
    assert.equal(StyleGuide.sampling.repetition_penalty, 1);
});

test('style guide: no SillyTavern macro survives the port', () => {
    const all = StyleGuide.prefix + StyleGuide.lastMile;
    assert.equal(all.match(/\{\{[^}]*\}\}/g), null,
        'a {{macro}} this app cannot substitute would reach the model as literal text');
    assert.ok(/\{user\}/.test(all), 'converted to the single-brace macro _getReplacer understands');
    assert.ok(!/\{\{trim\}\}|setvar::/.test(all));
});

test('style guide: the depth-0 blocks sit nearest the reply', () => {
    const banned = StyleGuide.lastMile.indexOf('<banlist>');
    const prose = StyleGuide.lastMile.indexOf('<prose_concepts>');
    assert.ok(prose > -1 && banned > -1);
    assert.ok(banned > prose,
        'the preset injects the banlist at depth 0 and prose concepts at depth 1, so the banlist lands later');
});

test('style guide: the custom reasoning template is carried but not wired in', () => {
    assert.ok(StyleGuide.reasoningTemplate.length > 500, 'kept for reference');
    for (const f of ['js/util/prompt-builder.js', 'js/services/api.js', 'js/controllers/narrative.js']) {
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        assert.ok(!/reasoningTemplate/.test(src),
            `${f} must not send it: it replaces a model's native thinking rather than stacking on it`);
    }
});

test('the intimacy pair only fires in an intimate scene', () => {
    const L = AgentStarters.list();
    const pair = [L.find(a => a.source.id === 'voice-holds'), L.find(a => a.source.id === 'something-slips')];
    const fires = (agent, texts) => AgentSchema.shouldFire(agent,
        { messageCounter: 1, recentTexts: texts, chatTokens: 0, roll: 0 });
    for (const agent of pair) {
        assert.ok(agent.trigger.keywords.length > 10, `${agent.name} is gated at all`);
        assert.equal(agent.trigger.keywordDepth, 8, 'stays alive across a scene, not just one reply');
        assert.equal(fires(agent, ['She kissed him before he could answer.']), true);
        assert.equal(fires(agent, ['They argued about the rent again.']), false);
        // Substring matching is why these words are not on the list.
        assert.equal(fires(agent, ['Their relationship was disturbed.', 'He barely touched his food.']), false,
            `${agent.name} must not fire on relationship/disturbed/barely`);
    }
});

test('the intimacy pair avoids keywords that hide inside ordinary words', () => {
    const L = AgentStarters.list();
    const words = L.find(a => a.source.id === 'something-slips').trigger.keywords;
    for (const trap of ['bed', 'hips', 'bare', 'lap', 'skin', 'neck', 'chest', 'heat']) {
        assert.ok(!words.includes(trap),
            `"${trap}" is a substring of an everyday word and would fire in ordinary scenes`);
    }
});

test('the new starters do not collide with an existing starter order', () => {
    const orders = AgentStarters.list().map(a => a.placement.order);
    assert.equal(new Set(orders).size, orders.length, 'every starter sorts to its own position');
});

test('Something Slips: fires on a fifth of replies, Voice Holds on all of them', () => {
    const slips = AgentStarters.list().find(a => a.source.id === 'something-slips');
    const holds = AgentStarters.list().find(a => a.source.id === 'voice-holds');
    assert.equal(holds.trigger.probability, 100);
    assert.equal(slips.trigger.probability, 20);
    assert.ok(slips.placement.order > holds.placement.order,
        'the slip has to land after the rule it breaks for that turn');
    const fired = n => AgentSchema.shouldFire(slips,
        { messageCounter: 1, recentTexts: ['She kissed him.'], chatTokens: 0, roll: n });
    assert.equal(fired(0.19), true);
    assert.equal(fired(0.21), false);
});

test('Something Slips: a different slip each time, and no macro survives', () => {
    const slips = AgentStarters.list().find(a => a.source.id === 'something-slips');
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
        const out = AgentSchema.expandMacros(slips.prompt, { char: 'Wren', user: 'Player' });
        assert.equal(out.match(/[{}]/g), null, 'a leftover brace would reach the model as literal text');
        const m = out.match(/let out: ([^.]+)\./);
        if (m) seen.add(m[1]);
    }
    assert.ok(seen.size >= 6, `the whole list should come up, saw ${seen.size}`);
});

test('Something Slips: no macro is nested inside the random list', () => {
    const slips = AgentStarters.list().find(a => a.source.id === 'something-slips');
    const block = slips.prompt.match(/\{\{random::[^}]*\}\}/);
    assert.ok(block, 'the random block parses at all');
    assert.ok(!/\{/.test(block[0].slice(10)),
        'expandMacros stops the random body at the first closing brace, so a nested macro would truncate the list');
});

test('style guide: carries the preset reply ceiling, not the app default', () => {
    assert.equal(StyleGuide.maxTokens, 15000,
        'reasoning is billed against this; 4096 is what made replies come back empty');
    assert.equal(StyleGuide.reasoning.effort, 'low');
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    assert.ok(api.includes('StyleGuide.maxTokens'), 'the preset ceiling is consulted');
    assert.ok(api.includes('|| APIService.MAX_OUTPUT_TOKENS'),
        'and the app default is the fallback when the guide is off');
});

test('style guide: a reasoning setting is never sent unless the guide asks for it', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const sends = api.match(/\{ reasoning: StyleGuide\.reasoning \}/g) || [];
    assert.equal(sends.length, 1);
    assert.ok(/state\.enableStyleGuide && typeof StyleGuide !== 'undefined' && StyleGuide\.reasoning/.test(api),
        'handing a reasoning object to a model that was not reasoning can switch thinking ON');
});

test('style guide: both halves go through the name replacer', () => {
    const pb = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    assert.ok(/replacer\(styleGuide\.prefix\)/.test(pb),
        'the guide is appended after the system prompt was already replaced, so it needs its own pass');
    assert.ok(/replacer\(StyleGuide\.lastMile\)/.test(pb));
    // 21 {user} macros reaching the model as literal text is the failure this guards.
    assert.ok(/\{user\}/.test(StyleGuide.prefix + StyleGuide.lastMile),
        'there is something for the replacer to do');
});

test('style guide: off by default, and off means absent', () => {
    const u = fs.readFileSync(path.join(__dirname, 'js', 'util', 'utility.js'), 'utf8');
    assert.ok(/enableStyleGuide: globals\.default_enableStyleGuide !== undefined \? globals\.default_enableStyleGuide : false/.test(u),
        'a new story does not get it unless asked');
    const pb = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    assert.ok(/state\.enableStyleGuide \? StyleGuide : null/.test(pb));
    assert.ok(/if \(state\.enableStyleGuide\) p \+=/.test(pb));
});

test('style guide: switching it on adopts the sampler it was tuned at', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    assert.ok(/state\.enableStyleGuide && typeof StyleGuide !== 'undefined' \? StyleGuide\.sampling/.test(api));
    const after = api.slice(api.indexOf('StyleGuide.sampling'), api.indexOf('StyleGuide.sampling') + 600);
    const spreadEnd = after.indexOf('}),');
    assert.ok(!/repetition_penalty/.test(after.slice(spreadEnd)),
        'nothing may be set after the spread or it would override the preset value');
});

test('style guide: the last-mile block is the last instruction before the reply', () => {
    const pb = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    const at = pb.indexOf('StyleGuide.lastMile');
    const anchorAt = pb.indexOf('+ components.charToAct.name + ":"', at);
    assert.ok(at > -1 && anchorAt > at);
});

test('style guide: layers onto the story prompt instead of replacing it', () => {
    const pb = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    assert.ok(/system_prompt: replacer\(modelInstructions\) \+ \(styleGuide \?/.test(pb),
        'turning it off must restore exactly what the story had');
});

test('style guide: the setting survives export and import', () => {
    const story = fs.readFileSync(path.join(__dirname, 'js', 'services', 'story.js'), 'utf8');
    assert.ok(/'enableStyleGuide'/.test(story),
        'otherwise a shared story silently loses it');
});

test("replies read the names: {{char}} and {{user}} from cards and the Workshop, and Rolecraft's own {character} and {user}", () => {
    const PB = vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8') + '\nPromptBuilder',
        { UTILITY: { stripThinking: t => t }, StateManager: { getState: () => ({ characters: [{ name: 'Mario', is_user: true }] }) } });
    const replace = PB._getReplacer({ name: 'Kael' });
    assert.equal(replace('{{char}} owes {{user}} a favour. {{Char}} and {{USER}}.'), 'Kael owes Mario a favour. Kael and Mario.');
    assert.equal(replace('{character} owes {user} a favour.'), 'Kael owes Mario a favour.');
    assert.ok(!replace('{{user}}').includes('{'), 'never "{Mario}"');
});

test('a leftover "is thinking" bubble never reaches the model', () => {
    const PB = vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8') + '\nPromptBuilder', { UTILITY: { stripThinking: t => t } });
    assert.equal(PB.isThinkingPlaceholder('Wren is thinking...'), true);
    assert.equal(PB.isThinkingPlaceholder('  Wren is thinking...  '), true);
    // A real reply that happens to use the phrase keeps its place.
    assert.equal(PB.isThinkingPlaceholder('She is thinking... about the offer, then looked away.'), false);
    assert.equal(PB.isThinkingPlaceholder('Wren is thinking about the offer.'), false);
    assert.equal(PB.isThinkingPlaceholder(''), false);
    assert.equal(PB.isThinkingPlaceholder(null), false);

    const kept = PB._getSmartHistorySlice([
        { content: 'Do you trust him?' },
        { content: 'Not for a second.' },
        { content: 'Wren is thinking...' }
    ], 8000, 'c1');
    assert.equal(kept.length, 2, 'the placeholder is dropped, the real turns stay');
});

test('a failed Director Mode regen puts the original reply back', () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    const swarm = nar.slice(nar.indexOf('_executeSwarmTurn'), nar.indexOf('async sendMessage()'));
    assert.ok(/originalContent = state\.chat_history\[targetMessageIndex\]\.content/.test(swarm),
        'it still takes a copy before overwriting with the placeholder');
    assert.ok(/if \(target\) target\.content = originalContent/.test(swarm),
        'and now puts it back on failure, which is what triggerAIResponse always did');
});

test('redo with a directive never targets the user own message', () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    const scan = nar.slice(nar.indexOf("if (isRegen || actionVal === 'regen')"), nar.indexOf('} else if (actionVal =='));
    assert.ok(/if \(char && char\.is_user\) break;/.test(scan),
        'taking the user message as the target cut the history off before it');
    assert.ok(scan.indexOf('char.is_user') < scan.indexOf('targetMessageIndex = i'),
        'the user check has to run before the target is accepted');
});

test('the reply ceiling does not depend on the style guide being on', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    const cap = api.match(/MAX_OUTPUT_TOKENS:\s*(\d+)/);
    assert.ok(cap && Number(cap[1]) >= 15000,
        'switching the guide off must not restore the ceiling that produced empty replies');
});

test('style guide: the preset REPAIR example sentences are not shipped', () => {
    const all = StyleGuide.prefix + '\n' + StyleGuide.lastMile;
    // The author gives this instruction five times in his own post: a quantized route starts
    // parroting these and writes a scene out of them instead of the user's story.
    for (const line of [
        'The boat leaves at dawn',
        'two men short and the tide turns',
        'expensive ticket buys a bed',
        'You ordered before I',
        'Grief cracked her voice',
        'took the stairs two at a time',
        'between cleaning days'
    ]) {
        assert.ok(!all.includes(line), `"${line}" is a demo sentence the model can mistake for story`);
    }
    // The rules they illustrated must survive.
    for (const block of ['<comparative_emphasis_killswitch>', '<inner_state_killswitch>',
        '<briefing_register_killswitch>', '<staccato_chop_killswitch>']) {
        assert.ok(all.includes(block), `${block} is still there`);
    }
    assert.ok(/Written as: the assertion alone/.test(all), 'and so is the instruction each one carried');
});

const ProviderBlacklist = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'provider-blacklist.js'), 'utf8') + '\nProviderBlacklist', {});
const HOUR = 3600000;
const T0 = 1700000000000;
const OPENINF = { slug: 'open-inference', name: 'OpenInference' };

test('ProviderBlacklist: a ban is temporary and lifts by itself', () => {
    const list = ProviderBlacklist.ban([], OPENINF, T0);
    assert.equal(list.length, 1);
    assert.equal(list[0].permanent, false);
    assert.equal(JSON.stringify(ProviderBlacklist.slugs(list, T0)), '["open-inference"]');
    assert.equal(JSON.stringify(ProviderBlacklist.slugs(list, T0 + 11 * HOUR)), '["open-inference"]');
    assert.equal(JSON.stringify(ProviderBlacklist.slugs(list, T0 + 13 * HOUR)), '[]', 'a bad day is not a life sentence');
    assert.equal(ProviderBlacklist.hoursLeft(list[0], T0 + 3 * HOUR), 9);
});

test('ProviderBlacklist: keep makes it permanent, release removes it', () => {
    const kept = ProviderBlacklist.keep(ProviderBlacklist.ban([], OPENINF, T0), 'open-inference');
    assert.equal(kept[0].permanent, true);
    assert.equal(JSON.stringify(ProviderBlacklist.slugs(kept, T0 + 24 * 365 * HOUR)), '["open-inference"]');
    assert.equal(ProviderBlacklist.release(kept, 'open-inference').length, 0);
});

test('ProviderBlacklist: banning again restarts the clock but never undoes a permanent ban', () => {
    const first = ProviderBlacklist.ban([], OPENINF, T0);
    const again = ProviderBlacklist.ban(first, OPENINF, T0 + 10 * HOUR);
    assert.equal(again.length, 1, 'no duplicate entry');
    assert.equal(JSON.stringify(ProviderBlacklist.slugs(again, T0 + 20 * HOUR)), '["open-inference"]');

    const kept = ProviderBlacklist.keep(first, 'open-inference');
    const rebanned = ProviderBlacklist.ban(kept, OPENINF, T0 + HOUR);
    assert.equal(rebanned[0].permanent, true);
});

test('ProviderBlacklist: nothing becomes permanent on its own', () => {
    const src = fs.readFileSync(path.join(__dirname, 'js', 'util', 'provider-blacklist.js'), 'utf8');
    assert.equal((src.match(/permanent: true/g) || []).length, 1, 'only keep() sets it');
    for (const f of ['js/controllers/narrative.js', 'js/services/api.js']) {
        const code = fs.readFileSync(path.join(__dirname, f), 'utf8');
        assert.ok(!/ProviderBlacklist\.keep\(/.test(code), `${f} must not promote a ban; only the Settings button does`);
    }
});

test('ProviderBlacklist.resolveSlug: the reported name is not the id OpenRouter wants', () => {
    const endpoints = [
        { provider_name: 'OpenInference', tag: 'open-inference/fp8' },
        { provider_name: 'Mancer 2', tag: 'mancer/fp8' },
        { provider_name: 'AtlasCloud', tag: 'atlas-cloud/fp4' },
        { provider_name: 'Azure', tag: 'azure/us' },
        { provider_name: 'NoTag' }
    ];
    const slug = name => (ProviderBlacklist.resolveSlug(name, endpoints) || {}).slug;
    assert.equal(slug('OpenInference'), 'open-inference');
    assert.equal(slug('open-inference'), 'open-inference', 'a slug resolves to itself');
    assert.equal(slug('Mancer 2'), 'mancer');
    assert.equal(slug('ATLASCLOUD'), 'atlas-cloud');
    assert.equal(slug('Azure'), 'azure', 'the region after the slash is not part of the id');
    assert.equal(ProviderBlacklist.resolveSlug('Nobody', endpoints), null, 'an unknown name blocks nothing');
    assert.equal(ProviderBlacklist.resolveSlug('', endpoints), null);
    assert.equal(ProviderBlacklist.resolveSlug('NoTag', endpoints), null);
});

test('ProviderBlacklist.matches: spots a blocked provider answering anyway', () => {
    const list = ProviderBlacklist.ban([], OPENINF, T0);
    assert.equal(ProviderBlacklist.matches(list, 'OpenInference'), true);
    assert.equal(ProviderBlacklist.matches(list, 'open-inference'), true);
    assert.equal(ProviderBlacklist.matches(list, 'StreamLake'), false);
    assert.equal(ProviderBlacklist.matches(list, ''), false);
});

test('OpenRouter requests: the blacklist only travels when something is blocked', () => {
    const api = fs.readFileSync(path.join(__dirname, 'js', 'services', 'api.js'), 'utf8');
    assert.ok(api.includes('...(blocked.length ? { provider: { ignore: blocked.map(e => e.slug) } } : {})'),
        'an empty list must leave the request exactly as it was');
    assert.ok(api.includes("res.headers.get('X-Provider-Name')"), 'the answering provider is read from the reply');
    assert.ok(!/['"]X-OpenRouter-Metadata['"]\s*:/.test(api),
        'OpenRouter refuses that request header from browsers, so sending it would fail every reply');
});

test('redo on a different provider: reachable from the hold menu and from Settings', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const item = html.slice(html.indexOf('data-action="regen-other-provider"'), html.indexOf('data-action="regen-other-provider"') + 200);
    assert.ok(item.includes('direct-regen-btn'), 'shown only when the menu was opened from the redo button');
    assert.ok(html.includes('id="openrouter-provider-blacklist"'));
    const dispatcher = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'action-dispatcher.js'), 'utf8');
    for (const action of ['regen-other-provider', 'provider-release', 'provider-keep']) {
        assert.ok(dispatcher.includes(`ActionHandler.register('${action}'`), `${action} has a handler`);
    }
});

test('the hold menu is measured before it is placed', () => {
    const handler = fs.readFileSync(path.join(__dirname, 'js', 'core', 'action-handler.js'), 'utf8');
    assert.ok(handler.includes('window.innerWidth - contextMenu.offsetWidth'), 'kept off the right edge of a phone');
    assert.ok(handler.includes('e.clientY - contextMenu.offsetHeight'), 'and above the press point however many items it has');
});

const NotePB = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8') + '\nPromptBuilder',
    { UTILITY: { stripThinking: t => t } });
const fillNames = text => text.replace('{character}', 'Wren').replace('{user}', 'Player');

test("author's note: nothing is added when the chat has none", () => {
    assert.equal(NotePB.authorNoteBlock({}, fillNames), '');
    assert.equal(NotePB.authorNoteBlock({ author_note: '' }, fillNames), '');
    assert.equal(NotePB.authorNoteBlock({ author_note: '   \n ' }, fillNames), '', 'only spaces is still no note');
    assert.equal(NotePB.authorNoteBlock({ author_note: 42 }, fillNames), '');
    assert.equal(NotePB.authorNoteBlock(null, fillNames), '');
});

test("author's note: sent as a rule that overrides, with names filled in", () => {
    const block = NotePB.authorNoteBlock({ author_note: '  {character} never uses pet names.  ' }, fillNames);
    assert.ok(block.includes("## AUTHOR'S NOTE"));
    assert.ok(block.includes('overrides anything above that conflicts with it'));
    assert.ok(block.endsWith('Wren never uses pet names.'), 'the rule itself is the last line, trimmed');
});

test("author's note: the last instruction in every kind of reply prompt", () => {
    const pb = fs.readFileSync(path.join(__dirname, 'js', 'util', 'prompt-builder.js'), 'utf8');
    const styleTail = pb.indexOf('replacer(StyleGuide.lastMile)');
    const note = pb.indexOf('p += this.authorNoteBlock(state, replacer);');
    const anchor = pb.indexOf('+ components.charToAct.name + ":"', note);
    assert.ok(styleTail > -1 && note > styleTail, "after the style guide's closing block, so the user's rule wins");
    assert.ok(anchor > note && anchor - note < 120, 'and straight before the name the reply starts from');
    assert.ok(pb.includes('instruction += this.authorNoteBlock(state, replacer);'), 'KoboldCPP templates carry it');
    assert.ok(pb.includes('prompt += this.authorNoteBlock(state, this._getReplacer(char));'), 'Director Mode carries it');
});

test("author's note: belongs to the chat, not the story", () => {
    const story = fs.readFileSync(path.join(__dirname, 'js', 'services', 'story.js'), 'utf8');
    assert.ok(story.includes("author_note: currentState.author_note || '',"),
        "a chat's saved record lists its fields one by one; an unlisted one is dropped on save");
    assert.ok(!story.includes("'author_note'"),
        'not in the story-level settings list, or every chat of a story would share one note');
});

test("author's note: the pencil has the image button's slot", () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const pencil = html.indexOf('id="author-note-btn" data-action="open-author-note"');
    const image = html.indexOf('id="upload-image-btn"');
    assert.ok(pencil > -1 && image > pencil, 'the pencil comes first, in the same button grid');
    assert.ok(html.slice(image, image + 220).includes('class="hidden '),
        'the image button is hidden, not deleted, so its wiring still finds it');
    assert.ok(html.includes('id="author-note-field"') && html.includes('id="author-note-dot"'));
    const dispatcher = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'action-dispatcher.js'), 'utf8');
    assert.ok(dispatcher.includes("ActionHandler.register('open-author-note'"));
});

function savedNotesPage({ answer = true } = {}) {
    const toasts = [];
    const asked = [];
    const classes = () => { const set = new Set(); return { toggle: (c, on) => on ? set.add(c) : set.delete(c), contains: c => set.has(c) }; };
    const select = {
        options: [], disabled: false, _value: '', classList: classes(),
        set innerHTML(_) { this.options = []; this._value = ''; },
        appendChild(o) { this.options.push(o); },
        get value() { return this._value; },
        set value(v) { this._value = this.options.some(o => o.value === v) ? v : ''; }
    };
    const els = {
        'author-note-saved': select,
        'author-note-remove': { classList: classes() },
        'author-note-field': { value: '' },
        'author-note-name': { value: '', focus() {} }
    };
    const globalSettings = {};
    let saves = 0;
    const NC = vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8') + '\nNarrativeController', {
            debounce: f => f,
            document: { getElementById: id => els[id], createElement: () => ({ value: '', textContent: '' }) },
            StateManager: { data: { globalSettings }, saveGlobalSettings: () => saves++ },
            ReactiveStore: { state: {} },
            UIManager: { showNotification: (m, kind) => toasts.push([m, kind]) },
            confirm: q => { asked.push(q); return answer; }
        });
    return { NC, els, globalSettings, toasts, asked, saves: () => saves, setAnswer: a => { answer = a; } };
}

test("saved author's notes: kept app-wide, loaded into the box, removed", () => {
    const p = savedNotesPage();
    p.NC.renderSavedAuthorNotes('');
    assert.equal(p.els['author-note-saved'].options[0].textContent, 'No saved notes yet');
    assert.ok(p.els['author-note-saved'].disabled, 'nothing to pick yet');

    p.els['author-note-field'].value = '  {character} stays cold toward {user}.  ';
    p.els['author-note-name'].value = ' Cold ';
    p.NC.addAuthorNoteToList();
    assert.deepEqual(JSON.parse(JSON.stringify(p.globalSettings.saved_author_notes)),
        [{ name: 'Cold', text: '{character} stays cold toward {user}.' }],
        'trimmed, placeholders kept as written so any character fills them');
    assert.equal(p.saves(), 1);
    assert.equal(p.els['author-note-saved'].value, 'Cold', 'the one just added is shown as picked');
    assert.ok(!p.els['author-note-saved'].disabled);

    p.els['author-note-field'].value = 'Write short replies.';
    p.els['author-note-name'].value = 'Brief';
    p.NC.addAuthorNoteToList();
    assert.deepEqual(p.els['author-note-saved'].options.map(o => o.textContent),
        ['Load a saved note...', 'Brief', 'Cold'], 'listed by name');

    p.els['author-note-field'].value = '';
    p.els['author-note-name'].value = '';
    p.NC.loadSavedAuthorNote('Cold');
    assert.equal(p.els['author-note-field'].value, '{character} stays cold toward {user}.');
    assert.equal(p.els['author-note-name'].value, 'Cold');
    assert.ok(p.els['author-note-remove'].classList.contains('hidden') === false, 'Remove shows for a picked note');

    p.els['author-note-saved'].value = 'Cold';
    p.NC.removeSavedAuthorNote();
    assert.deepEqual([...p.globalSettings.saved_author_notes.map(n => n.name)], ['Brief']);
    assert.ok(p.asked[0].includes('keep their copy'), 'says chats using it are not changed');
});

test("saved author's notes: same name asks before replacing; nothing saved without a name or text", () => {
    const p = savedNotesPage({ answer: false });
    p.els['author-note-field'].value = 'Old rule.';
    p.els['author-note-name'].value = 'Mood';
    p.NC.addAuthorNoteToList();

    p.els['author-note-field'].value = 'New rule.';
    p.els['author-note-name'].value = 'mood';
    p.NC.addAuthorNoteToList();
    assert.equal(p.asked.length, 1, 'a name that differs only in capitals is the same note');
    assert.equal(p.globalSettings.saved_author_notes[0].text, 'Old rule.', 'declined, so the old one stays');

    p.setAnswer(true);
    p.NC.addAuthorNoteToList();
    assert.deepEqual([...p.globalSettings.saved_author_notes.map(n => n.text)], ['New rule.'], 'replaced, not duplicated');

    const before = p.saves();
    p.els['author-note-name'].value = '';
    p.NC.addAuthorNoteToList();
    p.els['author-note-field'].value = '';
    p.els['author-note-name'].value = 'Empty';
    p.NC.addAuthorNoteToList();
    assert.equal(p.saves(), before, 'neither one was saved');
    assert.equal(p.globalSettings.saved_author_notes.length, 1);
});

test("saved author's notes: the editor shows which saved note a chat is using", () => {
    const nar = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'narrative.js'), 'utf8');
    const open = nar.slice(nar.indexOf('openAuthorNote() {'), nar.indexOf('closeAuthorNote() {'));
    assert.ok(open.includes('this.renderSavedAuthorNotes('), 'the list is refreshed every time the editor opens');
    assert.ok(open.includes('n.text === field.value.trim()'), "a chat whose note matches a saved one shows that one picked");
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const modal = html.slice(html.indexOf('id="author-note-modal"'));
    for (const id of ['author-note-saved', 'author-note-remove', 'author-note-name']) {
        assert.ok(modal.includes(`id="${id}"`), `${id} is inside the note editor`);
    }
});

// ─── tools/fake-ai.js, the stand-in AI server ────────────────────────────────
// The Workshop's AI code is tested against this instead of a real key, so these pin down what
// it relies on: the reply shapes, the stream format, misbehaving on request, and a log that
// never holds a key.

const os = require('node:os');
const FakeAI = require('./tools/fake-ai.js');

/** Runs fn against a fresh fake server on a free port, then shuts it down. */
async function withFakeAI(fn) {
    const log = path.join(os.tmpdir(), `rolecraft-fake-ai-${process.pid}.log`);
    const fake = await FakeAI.start({ port: 0, log, quiet: true });
    const url = `http://127.0.0.1:${fake.port}`;
    const ask = body => fetch(`${url}/api/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test-only' },
        body: JSON.stringify({ model: 'fake/model', ...body }),
    });
    try {
        await fn({ url, ask, log });
    } finally {
        await fake.close();
        fs.rmSync(log, { force: true });
    }
}

/** The data: lines of a streamed reply, parsed. "[DONE]" stays a string. */
function sseData(text) {
    return text.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6))
        .map(data => (data === '[DONE]' ? data : JSON.parse(data)));
}

test('fake AI server: a plain reply quotes the message and names its provider', async () => {
    await withFakeAI(async ({ ask }) => {
        const res = await ask({ messages: [{ role: 'system', content: 'Be brief. [[fake provider=Testco]]' }, { role: 'user', content: 'Hello there' }] });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('X-Provider-Name'), 'Testco');
        const data = await res.json();
        assert.equal(data.provider, 'Testco');
        assert.match(data.choices[0].message.content, /"Hello there"/);
        assert.ok(data.choices[0].message.reasoning, 'it thinks unless told not to');
        assert.equal(data.choices[0].finish_reason, 'stop');

        const quiet = await (await ask({ reasoning: { enabled: false }, messages: [{ role: 'user', content: 'Hi' }] })).json();
        assert.equal(quiet.choices[0].message.reasoning, null, 'reasoning switched off means no thinking');
    });
});

test('fake AI server: a stream sends all the thinking, then the reply, a finish reason and [DONE]', async () => {
    await withFakeAI(async ({ ask }) => {
        const res = await ask({ stream: true, messages: [{ role: 'user', content: 'Hello there [[fake delay=0 split]]' }] });
        assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
        const events = sseData(await res.text());
        assert.equal(events.at(-1), '[DONE]');
        const chunks = events.slice(0, -1);
        const deltas = chunks.map(c => c.choices[0].delta);
        const lastThought = deltas.findLastIndex(d => d.reasoning);
        assert.ok(lastThought >= 0 && lastThought < deltas.findIndex(d => d.content), 'the thinking all comes before the reply');
        assert.match(deltas.map(d => d.content).join(''), /"Hello there"/);
        assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
        assert.ok(chunks.at(-1).usage.total_tokens > 0);
    });
});

test('fake AI server: a stall can keep the line alive the way OpenRouter does', async () => {
    await withFakeAI(async ({ ask }) => {
        const text = await (await ask({ stream: true, messages: [{ role: 'user', content: 'Hi [[fake delay=0 stall=0.15 keepalive=0.05]]' }] })).text();
        assert.match(text, /^(: OPENROUTER PROCESSING\n\n)+data: /, 'keep-alive lines come before the first word');
    });
});

test('fake AI server: JSON on request, in fences, or broken until a retry adds a message', async () => {
    await withFakeAI(async ({ ask }) => {
        const reply = async body => (await (await ask(body)).json()).choices[0].message.content;
        assert.equal(JSON.parse(await reply({ response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Hi' }] })).fake, true);
        assert.match(await reply({ messages: [{ role: 'user', content: 'Hi [[fake fenced]]' }] }), /```json\n\{.*\}\n```/);

        const asked = [{ role: 'user', content: 'Hi [[fake badjson]]' }];
        const broken = await reply({ messages: asked });
        assert.throws(() => JSON.parse(broken));
        const retried = await reply({ messages: [...asked, { role: 'assistant', content: broken }, { role: 'user', content: 'Reply with JSON only.' }] });
        assert.equal(JSON.parse(retried).fake, true);
    });
});

test('fake AI server: fails on request, before the reply or partway through a stream', async () => {
    await withFakeAI(async ({ ask }) => {
        const refused = await ask({ messages: [{ role: 'user', content: '[[fake status=429]]' }] });
        assert.equal(refused.status, 429);
        assert.equal((await refused.json()).error.code, 429);

        const events = sseData(await (await ask({ stream: true, messages: [{ role: 'user', content: 'A long story [[fake midstream-error delay=0]]' }] })).text());
        assert.ok(!events.includes('[DONE]'), 'a dropped stream never says [DONE]');
        assert.equal(events.at(-1).choices[0].finish_reason, 'error');
        assert.ok(events.at(-1).error.message);
    });
});

test("fake AI server: answers the browser's permission check, and its log never holds the key", async () => {
    await withFakeAI(async ({ url, ask, log }) => {
        const check = await fetch(`${url}/v1/chat/completions`, {
            method: 'OPTIONS',
            headers: { Origin: 'http://localhost:8785', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
        });
        assert.equal(check.status, 204);
        assert.equal(check.headers.get('Access-Control-Allow-Headers'), 'authorization,content-type');
        assert.match(check.headers.get('Access-Control-Expose-Headers'), /X-Provider-Name/);

        await (await ask({ messages: [{ role: 'user', content: 'Hi' }] })).text();
        const logged = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert.equal(logged.length, 1, 'one line per chat request');
        assert.equal(logged[0].body.messages[0].content, 'Hi');
        assert.equal(logged[0].headers.authorization, '[hidden]');
        assert.ok(!fs.readFileSync(log, 'utf8').includes('sk-test-only'));
    });
});

test('fake AI server: thinking can come inside the reply, in <think> tags', async () => {
    await withFakeAI(async ({ ask }) => {
        const data = await (await ask({ messages: [{ role: 'user', content: 'Hi [[fake thinktags]]' }] })).json();
        assert.match(data.choices[0].message.content, /^<think>.+<\/think>\nThis is a made-up reply/);
        assert.equal(data.choices[0].message.reasoning, null);
    });
});

// ─── WorkshopAI: the Character Workshop's model connection ───────────────────
// The pure parts (settings, the request, the stream reader) are tested directly. chat() runs for
// real against tools/fake-ai.js, pointed there by swapping OpenRouter's address.

/** WorkshopAI with these settings, and the blacklist reading the same settings. */
function loadWorkshopAI(globalSettings = {}, { state = {}, page = 'http://localhost:8785/' } = {}) {
    const source = ['js/util/provider-blacklist.js', 'js/services/workshop-ai.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    return vm.runInNewContext(source + '\nWorkshopAI', {
        StateManager: { data: { globalSettings }, getState: () => state },
        UTILITY, fetch, TextDecoder, AbortController, URL, setTimeout, clearTimeout,
        window: { location: new URL(page) }
    });
}

/** WorkshopAI talking to the fake server as if it were OpenRouter. */
function workshopOnFake(url, globalSettings = {}) {
    const W = loadWorkshopAI({ openRouterKey: 'sk-test-only', ...globalSettings });
    W.BACKENDS.openrouter.url = `${url}/api`;
    return W;
}

const sentRequests = log => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));

test('WorkshopAI settings: DeepSeek V4.1 Flash on OpenRouter, thinking at medium, unless told otherwise', () => {
    const cfg = loadWorkshopAI().resolveSettings({});
    assert.equal(cfg.backend, 'openrouter');
    assert.equal(cfg.url, 'https://openrouter.ai/api');
    assert.equal(cfg.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(cfg.reasoning, 'medium');
    assert.equal(cfg.maxTokens, 16000);
    assert.equal(cfg.secondOpinionModel, 'deepseek/deepseek-v4-pro-0813');
    assert.equal(loadWorkshopAI().resolveSettings({ workshopReasoning: 'extreme', workshopBackend: 'nonsense' }).reasoning, 'medium', 'an unknown level falls back');
});

test('WorkshopAI settings: its own key first, then the main key, then one kept on the story', () => {
    const W = loadWorkshopAI();
    assert.equal(W.resolveSettings({ workshopOpenRouterKey: ' sk-own ', openRouterKey: 'sk-main' }).key, 'sk-own');
    assert.equal(W.resolveSettings({ workshopOpenRouterKey: '', openRouterKey: 'sk-main' }).key, 'sk-main');
    assert.equal(W.resolveSettings({}, { openRouterKey: 'sk-story' }).key, 'sk-story');
    assert.deepEqual(['own', 'main', 'missing'], [
        W.resolveSettings({ workshopOpenRouterKey: 'a' }).keySource, W.resolveSettings({ openRouterKey: 'b' }).keySource, W.resolveSettings({}).keySource]);
    assert.equal(W.resolveSettings({ workshopBackend: 'koboldcpp', openRouterKey: 'sk-main' }).key, '', 'a local server never gets the OpenRouter key');
});

test('WorkshopAI settings: local servers fall back to their usual port and take whole pasted addresses', () => {
    const W = loadWorkshopAI();
    assert.equal(W.resolveSettings({ workshopBackend: 'koboldcpp' }).url, 'http://localhost:5001');
    assert.equal(W.resolveSettings({ workshopBackend: 'lmstudio' }).url, 'http://localhost:1234');
    assert.equal(W.resolveSettings({ workshopBackend: 'ollama' }).url, 'http://localhost:11434');
    assert.equal(W.resolveSettings({ workshopBackend: 'ollama', workshopUrl: 'http://192.168.1.20:11434/v1/chat/completions' }).url, 'http://192.168.1.20:11434');
    assert.equal(W.resolveSettings({ workshopBackend: 'koboldcpp' }).model, '', 'no OpenRouter model name goes to a local server');
});

test('WorkshopAI request: OpenRouter gets the key, the app credit, an explicit reasoning object and the blacklist', () => {
    const W = loadWorkshopAI();
    const messages = [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Write it.' }];
    const { url, init } = W.buildRequest({ messages, json: true, temperature: 0.8 }, W.resolveSettings({ openRouterKey: 'sk-main' }),
        ['bad-host'], 'https://macegac.github.io/rolecraft/');
    const body = JSON.parse(init.body);
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.headers['Authorization'], 'Bearer sk-main');
    assert.equal(init.headers['HTTP-Referer'], 'https://macegac.github.io/rolecraft/');
    assert.equal(init.headers['X-Title'], 'Rolecraft');
    deepEq(body.messages, messages, 'the whole conversation, not one flattened prompt');
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 16000);
    assert.equal(body.temperature, 0.8);
    deepEq(body.reasoning, { effort: 'medium' });
    deepEq(body.provider, { ignore: ['bad-host'] });
    deepEq(body.response_format, { type: 'json_object' });

    const off = JSON.parse(W.buildRequest({ messages }, W.resolveSettings({ openRouterKey: 'k', workshopReasoning: 'off' }), []).init.body);
    deepEq(off.reasoning, { enabled: false }, 'off is said out loud, not left to the provider');
    assert.ok(!('provider' in off), 'an empty blacklist leaves the request alone');
    assert.ok(!('response_format' in off) && !('temperature' in off));
});

test('WorkshopAI request: local servers get a plain request with no key, no reasoning and no blacklist', () => {
    const W = loadWorkshopAI();
    for (const backend of ['koboldcpp', 'lmstudio', 'ollama']) {
        const { url, init } = W.buildRequest({ messages: [{ role: 'user', content: 'Hi' }], json: true },
            W.resolveSettings({ workshopBackend: backend, openRouterKey: 'sk-main' }), ['bad-host'], 'https://x.test/');
        const body = JSON.parse(init.body);
        assert.equal(url, `${W.BACKENDS[backend].url}/v1/chat/completions`);
        assert.ok(!init.headers['Authorization'], `${backend}: no key`);
        assert.ok(!('reasoning' in body) && !('provider' in body), `${backend}: no OpenRouter extras`);
        assert.equal(body.model, 'local-model', `${backend}: a stand-in name when none is set`);
        assert.equal('response_format' in body, backend === 'ollama', `${backend}: JSON mode only where the server takes it`);
    }
});

test('WorkshopAI request: from the https site, a home-network address is marked local so Chrome can allow it', () => {
    const W = loadWorkshopAI();
    deepEq(W.localNetworkOption('http://192.168.1.20:5001/v1/chat/completions', 'https:'), { targetAddressSpace: 'local' });
    deepEq(W.localNetworkOption('http://desktop-pc:5001/v1/chat/completions', 'https:'), { targetAddressSpace: 'local' });
    deepEq(W.localNetworkOption('http://localhost:5001/v1/chat/completions', 'https:'), {}, 'this device is allowed anyway');
    deepEq(W.localNetworkOption('http://127.0.0.1:5001/v1/chat/completions', 'https:'), {});
    deepEq(W.localNetworkOption('https://pc.example.ts.net/v1/chat/completions', 'https:'), {}, 'an https address needs nothing');
    deepEq(W.localNetworkOption('http://192.168.1.20:5001/v1/chat/completions', 'http:'), {}, 'an http page is not blocked to begin with');
});

test('WorkshopAI stream: lines and characters cut across chunks come out whole', async () => {
    const W = loadWorkshopAI();
    const events = [
        ': OPENROUTER PROCESSING',
        'data: {"provider":"Testco","choices":[{"delta":{"role":"assistant","content":""}}]}',
        'data: {"choices":[{"delta":{"content":"","reasoning":"Plan "}}]}',
        'data: {"choices":[{"delta":{"content":null,"reasoning_content":"first."}}]}',
        'data: {"choices":[{"delta":{"content":"Café "}}]}',
        'data: {"choices":[{"delta":{"content":"au lait ☕"}}]}',
        'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
        'data: [DONE]'
    ].map(line => line + '\n\n').join('');
    const bytes = new TextEncoder().encode(events);
    // One byte at a time: every line, and every two- and three-byte character, arrives in pieces.
    const body = new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
    const seen = [];
    let chunks = 0;
    const out = await W.readStream(body, { onDelta: d => seen.push(d.text), onChunk: () => chunks++ });
    assert.equal(out.text, 'Café au lait ☕');
    assert.equal(out.thinking, 'Plan first.');
    assert.equal(out.finishReason, 'stop');
    assert.equal(out.provider, 'Testco');
    assert.equal(chunks, bytes.length, 'every chunk counts as a sign of life, keep-alive lines included');
    assert.deepEqual(seen.filter(Boolean), ['Café ', 'Café au lait ☕'], 'the text so far, each time more arrives');
});

test('WorkshopAI stream: an error chunk part way through is a failure, not a short reply', async () => {
    const W = loadWorkshopAI();
    const text = 'data: {"choices":[{"delta":{"content":"Half a "}}]}\n\n'
        + 'data: {"provider":"Testco","error":{"code":502,"message":"Provider disconnected"},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}\n\n';
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    await assert.rejects(W.readStream(body), /stopped part way through \(Testco\): Provider disconnected/);
});

test('WorkshopAI chat: streams word by word from the fake server, with thinking and the provider', async () => {
    await withFakeAI(async ({ url, log }) => {
        const W = workshopOnFake(url);
        const texts = [];
        const reply = await W.chat({
            messages: [{ role: 'system', content: 'Rules. [[fake delay=0 provider=Testco]]' }, { role: 'user', content: 'Write the Appearance section.' }],
            onDelta: d => texts.push(d.text)
        });
        assert.match(reply.text, /"Write the Appearance section\."/);
        assert.ok(reply.thinking.length > 0);
        assert.equal(reply.provider, 'Testco');
        assert.equal(reply.finishReason, 'stop');
        assert.ok(texts.filter(Boolean).length > 5, 'many small updates, not one at the end');
        const sent = sentRequests(log)[0];
        assert.equal(sent.path, '/api/v1/chat/completions');
        assert.equal(sent.body.model, 'deepseek/deepseek-v4.1-flash');
        deepEq(sent.body.reasoning, { effort: 'medium' });
        assert.ok(!('provider' in sent.body), 'nothing blocked, so no blacklist');
        assert.equal(sent.headers['x-title'], 'Rolecraft');
    });
});

test('WorkshopAI chat: blocked providers travel with every OpenRouter request', async () => {
    await withFakeAI(async ({ url, log }) => {
        const W = workshopOnFake(url, { provider_blacklist: [{ slug: 'bad-host', name: 'Bad Host', permanent: true, addedAt: 0 }] });
        await W.chat({ messages: [{ role: 'user', content: 'Hi [[fake delay=0]]' }] });
        deepEq(sentRequests(log)[0].body.provider, { ignore: ['bad-host'] });
    });
});

test('WorkshopAI chat: JSON is cleaned out of fences, asked for once more when broken, and refused when cut off', async () => {
    await withFakeAI(async ({ url, log }) => {
        const W = workshopOnFake(url);
        const fenced = await W.chat({ json: true, messages: [{ role: 'user', content: 'Pins please [[fake fenced delay=0]]' }] });
        assert.equal(fenced.data.fake, true);
        assert.equal(fenced.attempts, 1);

        const retried = await W.chat({ json: true, messages: [{ role: 'user', content: 'Pins please [[fake badjson delay=0]]' }] });
        assert.equal(retried.data.fake, true);
        assert.equal(retried.attempts, 2);
        const again = sentRequests(log).at(-1).body;
        assert.equal(again.messages.at(-2).role, 'assistant', 'the model is shown what it sent');
        assert.match(again.messages.at(-1).content, /JSON only/);
        deepEq(again.response_format, { type: 'json_object' });

        await assert.rejects(W.chat({ json: true, messages: [{ role: 'user', content: 'Pins [[fake length delay=0]]' }] }),
            /length limit before its JSON was finished/);
    });
});

test('WorkshopAI chat: a silent line is given up on, but keep-alive lines keep it going', async () => {
    await withFakeAI(async ({ url }) => {
        const W = workshopOnFake(url);
        W.IDLE_MS = 150;
        await assert.rejects(W.chat({ messages: [{ role: 'user', content: 'Hi [[fake stall=0.5 delay=0]]' }] }), /went quiet/);
        const kept = await W.chat({ messages: [{ role: 'user', content: 'Hi [[fake stall=0.5 keepalive=0.05 delay=0]]' }] });
        assert.match(kept.text, /made-up reply/, 'each keep-alive line restarted the timer');
    });
});

test('WorkshopAI chat: Stop ends the request at once', async () => {
    await withFakeAI(async ({ url }) => {
        const W = workshopOnFake(url);
        const stop = new AbortController();
        const pending = W.chat({ messages: [{ role: 'user', content: 'A long story [[fake delay=50]]' }], signal: stop.signal, onDelta: () => stop.abort() });
        await assert.rejects(pending, err => err.name === 'AbortError');
    });
});

test('WorkshopAI chat: refusals, dropped streams and empty replies come back as plain-language errors', async () => {
    await withFakeAI(async ({ url }) => {
        const W = workshopOnFake(url);
        await assert.rejects(W.chat({ messages: [{ role: 'user', content: '[[fake status=429]]' }] }), /^Error: Too many requests right now.*\(Fake error 429/);
        await assert.rejects(W.chat({ messages: [{ role: 'user', content: '[[fake status=401]]' }] }), /OpenRouter did not accept the key/);
        await assert.rejects(W.chat({ messages: [{ role: 'user', content: 'Hi [[fake midstream-error delay=0]]' }] }), /stopped part way through \(Fake\)/);
        await assert.rejects(W.chat({ messages: [{ role: 'user', content: 'Hi [[fake empty delay=0]]' }] }), /thought about its reply but returned no words/);
        await assert.rejects(loadWorkshopAI().chat({ messages: [{ role: 'user', content: 'Hi' }] }), /needs an OpenRouter key/);
        await assert.rejects(loadWorkshopAI({ workshopBackend: 'koboldcpp', workshopUrl: 'http://127.0.0.1:9' }).chat({ messages: [{ role: 'user', content: 'Hi' }] }),
            /Could not reach KoboldCPP at http:\/\/127\.0\.0\.1:9/);
    });
});

test('WorkshopAI chat: a local server works too, and thinking sent inside <think> tags is split from the answer', async () => {
    await withFakeAI(async ({ url, log }) => {
        const W = loadWorkshopAI({ workshopBackend: 'koboldcpp', workshopUrl: url, openRouterKey: 'sk-main' });
        const texts = [];
        const tagged = await W.chat({ messages: [{ role: 'user', content: 'Hi [[fake delay=0 thinktags]]' }], onDelta: d => texts.push(d.text) });
        assert.match(tagged.text, /^This is a made-up reply/);
        assert.match(tagged.thinking, /The request is clear/);
        assert.ok(texts.every(t => !t.includes('<think>')), 'the tags never show while it streams either');

        const separate = await W.chat({ messages: [{ role: 'user', content: 'Hi [[fake delay=0 reasoning_content]]' }] });
        assert.ok(separate.thinking.length > 0, 'reasoning_content is read too');
        const sent = sentRequests(log)[0];
        assert.equal(sent.path, '/v1/chat/completions');
        assert.equal(sent.headers.authorization, undefined, 'no key goes to a local server');
        assert.ok(!('reasoning' in sent.body));
    });
});

test('WorkshopAI: leaves the story alone (its Stop button, its shared reply slots)', () => {
    const service = fs.readFileSync(path.join(__dirname, 'js', 'services', 'workshop-ai.js'), 'utf8');
    assert.ok(!service.includes('activeRequestAbortController'), "Send and Redo stop the story's request; they must not stop the Workshop's");
    assert.ok(!/\.(lastThinking|lastProvider)\s*=/.test(service), 'the chat reads those slots');
    assert.ok(!/APIService\.\w+\(/.test(service), 'it has its own connection');
});

test('Workshop model settings: wired into Settings → Model, the model browser, start-up and problem reports', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const modelTab = html.slice(html.indexOf('id="settings-model-content"'), html.indexOf('id="settings-image-gen-content"'));
    const app = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'app.js'), 'utf8');
    const globalKeys = app.slice(app.indexOf('MODEL_SETTING_KEYS: ['), app.indexOf(']', app.indexOf('MODEL_SETTING_KEYS: [')));
    for (const [id, key] of [['workshop-backend', 'workshopBackend'], ['workshop-url', 'workshopUrl'], ['workshop-model', 'workshopModel'],
        ['workshop-openrouter-key', 'workshopOpenRouterKey'], ['workshop-reasoning', 'workshopReasoning']]) {
        assert.ok(modelTab.includes(`id="${id}" data-setting-key="${key}"`), `${id} is in Settings → Model, saved as ${key}`);
        assert.ok(globalKeys.includes(`'${key}'`), `${key} is app-wide, not per story`);
        assert.ok(app.includes(`setListener('${id}', '${key}')`), `${id} saves as you type`);
    }
    assert.ok(app.includes("this.RUNTIME.modelBrowserMode === 'workshop'"), 'the model browser can pick the Workshop model');
    const filled = app.indexOf("setListener('workshop-reasoning', 'workshopReasoning')");
    const defaults = app.indexOf('WorkshopController.renderSettings()');
    assert.ok(defaults > filled && defaults - filled < 400,
        'defaults go in straight after the fields are filled, so set-up code failing further down cannot leave them blank');

    const controller = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    for (const action of new Set([...html.matchAll(/data-action(?:-change)?="(workshop-[a-z-]+)"/g), ...controller.matchAll(/data-action="(workshop-[a-z-]+)"/g)].map(m => m[1]))) {
        assert.ok(controller.includes(`ActionHandler.register('${action}'`), `${action} has a handler`);
    }
    const boot = fs.readFileSync(path.join(__dirname, 'js', 'boot.js'), 'utf8');
    assert.ok(boot.includes('WorkshopController.registerActions();'));
    const diagnostics = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'diagnostics.js'), 'utf8');
    assert.ok(/if \(typeof WorkshopAI !== 'undefined'\) \{\s*this\._wrap\(WorkshopAI, 'chat'/.test(diagnostics), 'every Workshop request goes in the problem report');
    assert.ok(diagnostics.includes("'Workshop model': this._workshop()"), 'and the report header names its model, never its key');
});

function workshopSettingsPage({ answer = true } = {}) {
    const toasts = [];
    const asked = [];
    const classes = () => {
        const set = new Set();
        return { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: c => set.has(c), add: c => set.add(c), remove: c => set.delete(c) };
    };
    const field = (value = '') => ({ value, placeholder: '', classList: classes(), focus() { } });
    const els = {
        'workshop-backend': field('openrouter'), 'workshop-url': field(), 'workshop-model': field(), 'workshop-reasoning': field(),
        'workshop-setup-name': field(), 'workshop-setups': { innerHTML: '' },
        'workshop-local-settings': field(), 'workshop-openrouter-settings': field(), 'workshop-reasoning-row': field(), 'workshop-browse-btn': field()
    };
    const globalSettings = {};
    let saves = 0;
    const source = ['js/core/dom.js', 'js/services/workshop-ai.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', {
        document: { getElementById: id => els[id] },
        StateManager: { data: { globalSettings }, getState: () => ({}), saveGlobalSettings: () => saves++ },
        UIManager: { showNotification: (m, kind) => toasts.push([m, kind]) },
        UTILITY,
        confirm: q => { asked.push(q); return answer; }
    });
    return { WC, els, globalSettings, toasts, asked, saves: () => saves, setAnswer: a => { answer = a; } };
}

test('Workshop settings: a choice never made shows the default in use, not a blank box', () => {
    const p = workshopSettingsPage();
    // What the settings binding leaves behind for a setting that was never chosen.
    p.els['workshop-backend'].value = '';
    p.els['workshop-reasoning'].value = '';
    p.WC.renderSettings();
    assert.equal(p.els['workshop-backend'].value, 'openrouter');
    assert.equal(p.els['workshop-reasoning'].value, 'medium');

    p.els['workshop-reasoning'].value = '';
    p.WC.updateSettingsVisibility();
    assert.equal(p.els['workshop-reasoning'].value, 'medium', 'and again whenever the rows are shown or hidden');
    assert.equal(p.saves(), 0, 'shown only; nothing is saved that was not chosen');
});

test('Workshop setups: saved by name, switched with one tap, replaced only when confirmed', () => {
    const p = workshopSettingsPage();
    p.els['workshop-backend'].value = 'koboldcpp';
    p.els['workshop-url'].value = 'http://192.168.1.20:5001';
    p.els['workshop-setup-name'].value = 'PC Kobold';
    p.WC.saveSetup();
    p.els['workshop-backend'].value = 'openrouter';
    p.els['workshop-url'].value = '';
    p.els['workshop-model'].value = 'deepseek/deepseek-v4-pro-0813';
    p.els['workshop-setup-name'].value = 'Pro';
    p.WC.saveSetup();
    deepEq(p.globalSettings.workshopSetups, [
        { name: 'PC Kobold', backend: 'koboldcpp', url: 'http://192.168.1.20:5001', model: '' },
        { name: 'Pro', backend: 'openrouter', url: '', model: 'deepseek/deepseek-v4-pro-0813' }], 'keys are never part of a setup');
    assert.equal(p.els['workshop-setup-name'].value, '', 'the name box empties for the next one');

    const savesBefore = p.saves();
    p.WC.useSetup('PC Kobold');
    assert.equal(p.saves(), savesBefore + 1, 'saved straight away');
    assert.equal(p.globalSettings.workshopBackend, 'koboldcpp');
    assert.equal(p.globalSettings.workshopUrl, 'http://192.168.1.20:5001');
    assert.equal(p.globalSettings.workshopModel, '');
    assert.equal(p.els['workshop-url'].value, 'http://192.168.1.20:5001', 'the fields show the switch');
    assert.ok(!p.els['workshop-local-settings'].classList.contains('hidden'), 'and the address field is showing');
    assert.ok(p.els['workshop-openrouter-settings'].classList.contains('hidden'), 'and the key field is not');
    assert.match(p.els['workshop-setups'].innerHTML, /border-indigo-400[^>]*title="KoboldCPP at http:\/\/192\.168\.1\.20:5001, default model"/, 'the setup in use is outlined');

    p.setAnswer(false);
    p.els['workshop-setup-name'].value = 'pc kobold';
    p.WC.saveSetup();
    assert.equal(p.asked.length, 1, 'the same name in other capitals asks first');
    assert.equal(p.globalSettings.workshopSetups.length, 2, 'declined, so nothing changed');

    p.setAnswer(true);
    p.WC.removeSetup('Pro');
    deepEq(p.globalSettings.workshopSetups.map(s => s.name), ['PC Kobold']);

    p.els['workshop-setup-name'].value = '';
    p.WC.saveSetup();
    assert.equal(p.toasts.at(-1)[0], 'Give the setup a name first.');
});

// ─── WorkshopStore: sections, history and variants ───────────────────────────

const WorkshopStore = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'services', 'workshop-store.js'), 'utf8') + '\nWorkshopStore', {});

/** The state with these section texts set, keyed by section id. */
function withTexts(state, texts) {
    return { ...state, sections: state.sections.map(s => (s.id in texts ? { ...s, text: texts[s.id] } : s)) };
}

test('WorkshopStore: eleven sections in card order, with Scenario aimed at the scenario field', () => {
    deepEq(WorkshopStore.sectionDefs.map(d => d.title), ['Appearance & body', 'Personality', 'Sexuality', 'Relationship to {{user}}',
        'Background', 'Voice', 'Scenario', 'Kinks & limits', 'Secrets & wants', 'Wardrobe', 'Likes & dislikes']);
    assert.equal(new Set(WorkshopStore.sectionDefs.map(d => d.id)).size, 11, 'every id is different');
    deepEq(WorkshopStore.sectionDefs.filter(d => d.target === 'scenario').map(d => d.id), ['scenario']);
    assert.ok(WorkshopStore.blankState().sections.every(s => s.text === '' && s.pins.length === 0 && !s.locked));
});

test('WorkshopStore: a commit holds only what changed, before and after, and stamps that section', () => {
    const ws0 = WorkshopStore.create({ state: { ...WorkshopStore.blankState(), concept: 'A medic on the night shift.' },
        original: { description: 'Old card text.', scenario: 'Old scenario.' }, now: 100, commitId: 'c0' });
    assert.equal(ws0.commits[0].changes.length, 14, 'the first commit holds every part: concept, notes, unsorted text and eleven sections');
    deepEq(ws0.original, { description: 'Old card text.', scenario: 'Old scenario.' });

    const untouched = JSON.stringify(ws0);
    const ws1 = WorkshopStore.commit(ws0, withTexts(WorkshopStore.active(ws0).state, { appearance: 'Tall, with ink-stained hands.' }),
        { summary: 'Wrote Appearance', now: 200, commitId: 'c1' });
    assert.equal(JSON.stringify(ws0), untouched, 'the Workshop passed in is left as it was');
    const c1 = ws1.commits.at(-1);
    deepEq(c1.changes.map(ch => ch.section), ['appearance']);
    assert.equal(c1.changes[0].before.text, '');
    assert.equal(c1.changes[0].after.text, 'Tall, with ink-stained hands.');
    assert.equal(c1.parent, 'c0');
    assert.equal(WorkshopStore.active(ws1).head, 'c1');
    const sections = WorkshopStore.active(ws1).state.sections;
    assert.equal(sections.find(s => s.id === 'appearance').at, 200, 'the changed section carries the time');
    assert.equal(sections.find(s => s.id === 'voice').at, 0, 'the others keep theirs');

    assert.equal(WorkshopStore.commit(ws1, WorkshopStore.active(ws1).state, { now: 300 }), ws1, 'nothing changed, nothing recorded');
    const timeOnly = { ...WorkshopStore.active(ws1).state, sections: sections.map(s => ({ ...s, at: 999 })) };
    assert.equal(WorkshopStore.commit(ws1, timeOnly, { now: 300 }), ws1, 'a time alone is not a change');
});

test('WorkshopStore: every point in the history rebuilds exactly as it was', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    const seen = { c0: JSON.stringify(WorkshopStore.active(ws).state) };
    [{ appearance: 'Tall.' }, { personality: 'Wry.' }, { appearance: 'Tall and lean.' }, { voice: 'Clipped.' }].forEach((texts, i) => {
        let next = withTexts(WorkshopStore.active(ws).state, texts);
        if (i === 1) next = { ...next, concept: 'A medic.', notes: 'Slow burn.' };
        ws = WorkshopStore.commit(ws, next, { now: 10 + i, commitId: `c${i + 1}` });
        seen[`c${i + 1}`] = JSON.stringify(WorkshopStore.active(ws).state);
    });
    for (const [id, state] of Object.entries(seen)) deepEq(WorkshopStore.stateAt(ws, id), JSON.parse(state), `${id} rebuilds`);
    assert.equal(WorkshopStore.stateAt(ws, 'nope'), null);
});

test('WorkshopStore: going back is a new commit, so the steps in between are kept', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { appearance: 'First take.' }), { now: 2, commitId: 'c1', summary: 'First take' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { appearance: 'Second take.' }), { now: 3, commitId: 'c2' });
    const back = WorkshopStore.restore(ws, 'c1', { now: 4, commitId: 'c3' });
    assert.equal(back.commits.length, 4, 'nothing removed');
    const c3 = back.commits.at(-1);
    assert.equal(c3.origin, 'restore');
    assert.equal(c3.from, 'c1');
    assert.equal(c3.parent, 'c2');
    assert.match(c3.summary, /First take/);
    assert.equal(WorkshopStore.active(back).state.sections[0].text, 'First take.');
    assert.equal(WorkshopStore.stateAt(back, 'c2').sections[0].text, 'Second take.', 'the later take can still be gone back to');
});

test('WorkshopStore: a variant branches from any point and grows on its own', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded.' }), { now: 2, commitId: 'c1' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded, then reckless.' }), { now: 3, commitId: 'c2' });

    ws = WorkshopStore.branch(ws, 'c1', { name: 'Softer', now: 4, variantId: 'v_soft' });
    assert.equal(ws.active, 'v_soft', 'the new variant is the one being worked on');
    assert.equal(WorkshopStore.active(ws).head, 'c1');
    assert.equal(WorkshopStore.active(ws).state.sections[1].text, 'Guarded.');

    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded, then gentle.' }), { now: 5, commitId: 'c3' });
    assert.equal(ws.commits.at(-1).parent, 'c1', 'its history forks at the branch point');
    assert.equal(ws.commits.at(-1).variant, 'v_soft');
    deepEq(WorkshopStore.lineage(ws, 'c3').map(c => c.id), ['c0', 'c1', 'c3']);

    ws = WorkshopStore.switchVariant(ws, 'v_main');
    assert.equal(WorkshopStore.active(ws).state.sections[1].text, 'Guarded, then reckless.', 'the main line is untouched');
    for (const v of ws.variants) deepEq(WorkshopStore.stateAt(ws, v.head), JSON.parse(JSON.stringify(v.state)), `${v.name} rebuilds from its head`);
    assert.equal(WorkshopStore.switchVariant(ws, 'nope'), ws);
});

test('WorkshopStore: variants are renamed, hidden and brought back, and the last one cannot go', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded.' }), { now: 2, commitId: 'c1' });
    ws = WorkshopStore.branch(ws, 'c1', { name: 'Softer', now: 3, variantId: 'v_soft' });

    ws = WorkshopStore.renameVariant(ws, 'v_soft', '  Gentler  ');
    assert.equal(WorkshopStore.active(ws).name, 'Gentler');
    assert.equal(WorkshopStore.renameVariant(ws, 'v_soft', '   '), ws, 'an empty name changes nothing');
    assert.equal(WorkshopStore.renameVariant(ws, 'v_soft', 'x'.repeat(80)).variants[1].name.length, 60);

    const gone = WorkshopStore.deleteVariant(ws, 'v_soft', 9);
    assert.equal(gone.variants.find(v => v.id === 'v_soft').deletedAt, 9, 'hidden, not removed');
    assert.equal(gone.active, 'v_main', 'deleting the one in use moves to another');
    assert.equal(gone.commits, ws.commits, 'its history stays');
    assert.equal(WorkshopStore.deleteVariant(gone, 'v_main'), gone, 'the last one left cannot go');
    assert.equal(WorkshopStore.switchVariant(gone, 'v_soft'), gone, 'a hidden variant cannot be used');

    const back = WorkshopStore.restoreVariant(gone, 'v_soft');
    assert.equal('deletedAt' in back.variants.find(v => v.id === 'v_soft'), false);
    assert.equal(back.active, 'v_main', 'bringing it back does not switch to it');
    assert.equal(WorkshopStore.active(WorkshopStore.switchVariant(back, 'v_soft')).state.sections[1].text, 'Guarded.');

    assert.equal(WorkshopStore.deleteVariant(ws, 'v_main', 9).active, 'v_soft', 'deleting one not in use leaves the one in use alone');
    let three = WorkshopStore.branch(ws, 'c0', { name: 'Darker', now: 4, variantId: 'v_dark' });
    three = WorkshopStore.switchVariant(three, 'v_main');
    assert.equal(WorkshopStore.deleteVariant(three, 'v_main', 9).active, 'v_dark', 'it moves to the newest of the others');
});

test('WorkshopStore: proposals stay with the variant they were written for', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.setPending(ws, 'appearance', { kind: 'write', text: 'For Main.', pinMap: {} });
    ws = WorkshopStore.branch(ws, 'c0', { name: 'Darker', now: 2, variantId: 'v_dark' });
    deepEq(ws.pending, {}, 'a new variant starts with none waiting');
    ws = WorkshopStore.setPending(ws, '_sort', { kind: 'sort', leftover: 'For Darker.' });

    ws = WorkshopStore.switchVariant(ws, 'v_main');
    assert.equal(ws.pending.appearance.text, 'For Main.', "Main's proposal is back");
    assert.equal(ws.pending._sort, undefined, "and Darker's sorting waits with Darker");
    assert.equal(WorkshopStore.switchVariant(ws, 'v_main'), ws, 'switching to the one in use changes nothing');

    ws = WorkshopStore.deleteVariant(ws, 'v_main', 3);
    assert.equal(ws.pending._sort.leftover, 'For Darker.', 'deleting the one in use brings back the next one\'s proposals');
    ws = WorkshopStore.switchVariant(WorkshopStore.restoreVariant(ws, 'v_main'), 'v_main');
    assert.equal(ws.pending.appearance.text, 'For Main.', 'and a deleted variant kept its own');
    deepEq(ws.parked, { v_dark: { _sort: { kind: 'sort', leftover: 'For Darker.' } } });
});

/** A Workshop with a history and a second variant, from a card that said "Old card text." */
function cardWorkshop() {
    let ws = WorkshopStore.create({
        state: withTexts(WorkshopStore.blankState(), { appearance: 'Tall.', scenario: 'A storm traps you both.' }),
        original: { description: 'Old card text.', scenario: '' }, now: 1, commitId: 'c0'
    });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded.' }), { now: 2, commitId: 'c1', summary: 'Guarded' });
    ws = WorkshopStore.branch(ws, 'c0', { name: 'Softer', now: 3, variantId: 'v_soft' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Gentle.' }), { now: 4, commitId: 'c2' });
    return WorkshopStore.switchVariant(ws, 'v_main');
}

test('WorkshopStore: a card shows any version of the character: as it is now, the original, a variant or a saved point', () => {
    const ws = cardWorkshop();
    deepEq(WorkshopStore.cardFields(ws, 'current'),
        { description: '## Appearance & body\nTall.\n\n## Personality\nGuarded.', scenario: 'A storm traps you both.' },
        'the sections under their headings, and the Scenario section for the scenario');
    deepEq(WorkshopStore.cardFields(ws), JSON.parse(JSON.stringify(WorkshopStore.cardFields(ws, 'current'))), 'as it is now, by default');
    deepEq(WorkshopStore.cardFields(ws, 'original'), { description: 'Old card text.', scenario: '' }, 'the card exactly as it came in');
    assert.equal(WorkshopStore.cardFields(ws, 'v_soft').description, '## Appearance & body\nTall.\n\n## Personality\nGentle.');
    assert.equal(WorkshopStore.cardFields(ws, 'c0').description, '## Appearance & body\nTall.', 'any saved point');
    assert.equal(WorkshopStore.cardFields(ws, 'nope'), null);
});

test('WorkshopStore: a card carries the whole Workshop, and a fingerprint of the text it was written with', () => {
    const ws = cardWorkshop();
    const written = { description: 'D', personality: '', scenario: 'S', ownScenario: true };
    const carried = WorkshopStore.toCard(ws, 'v_soft', written, 9);
    assert.equal(carried.format, 1);
    deepEq(carried.exported, { pick: 'v_soft', at: 9, ownScenario: true, check: WorkshopStore.cardCheck('D', '', 'S') });
    deepEq(carried.workshop, JSON.parse(JSON.stringify(ws)), 'every variant and every step');
    assert.notEqual(carried.workshop, ws, 'a copy');
    assert.notEqual(WorkshopStore.cardCheck('D', '', 'S'), WorkshopStore.cardCheck('D', 'x', 'S'));
    assert.notEqual(WorkshopStore.cardCheck('ab', 'c'), WorkshopStore.cardCheck('a', 'bc'), 'where one field ends counts');
    assert.equal(WorkshopStore.cardCheck('Line one\r\nLine two\n'), WorkshopStore.cardCheck('Line one\nLine two'), 'tidied line endings and spaces are not a change');
    assert.match(WorkshopStore.cardCheck('anything'), /^[0-9a-f]{8}$/);
});

test('WorkshopStore: an imported card brings its Workshop back as it was, unless its text was changed in another app', () => {
    const ws = cardWorkshop();
    const fields = WorkshopStore.cardFields(ws, 'current');
    const carried = WorkshopStore.toCard(ws, 'current', { description: fields.description, personality: '', scenario: fields.scenario, ownScenario: true });
    deepEq(WorkshopStore.fromCard(carried, { description: fields.description, personality: '', scenario: fields.scenario }), JSON.parse(JSON.stringify(ws)),
        'untouched: exactly as it was');

    const edited = {
        description: `${fields.description.replace('Tall.', 'Tall and lean.')}\n\n--- Other Characters ---\n\nName: Elara\nDescription: An elf.\n`,
        personality: 'Kind to strangers.', scenario: 'A flood traps you both.'
    };
    const back = WorkshopStore.fromCard(carried, edited, 10);
    assert.equal(back.commits.length, ws.commits.length + 1, 'one new step');
    const step = back.commits.at(-1);
    assert.equal(step.origin, 'card');
    assert.equal(step.summary, 'Changed outside Rolecraft');
    const state = WorkshopStore.active(back).state;
    assert.equal(state.sections.find(s => s.id === 'appearance').text, 'Tall and lean.');
    assert.equal(state.sections.find(s => s.id === 'personality').text, 'Guarded.');
    assert.equal(state.sections.find(s => s.id === 'scenario').text, 'A flood traps you both.', 'the scenario came from the Workshop, so the change goes there');
    assert.equal(state.unsorted, 'Kind to strangers.', 'a personality added elsewhere waits as unsorted card text');
    assert.ok(!JSON.stringify(state).includes('Other Characters'), "the story's other characters are not part of this one");
    assert.equal(WorkshopStore.stateAt(back, 'c1').sections.find(s => s.id === 'appearance').text, 'Tall.', 'and the history before it stays');

    const fromStory = WorkshopStore.toCard(ws, 'current', { description: fields.description, personality: '', scenario: 'Story lore.', ownScenario: false });
    const kept = WorkshopStore.fromCard(fromStory, { description: fields.description, personality: '', scenario: 'Story lore, edited.' });
    assert.equal(WorkshopStore.active(kept).state.sections.find(s => s.id === 'scenario').text, 'A storm traps you both.',
        "a scenario that was the story's own leaves the Scenario section alone");

    for (const bad of [null, {}, { workshop: { v: 99, variants: [{ state: { sections: [] } }], commits: [] } }, { workshop: { v: 1, variants: [], commits: [] } }]) {
        assert.equal(WorkshopStore.fromCard(bad, edited), null, 'nothing it cannot read');
    }
});

test('WorkshopStore: the description is each filled section under its heading, with Scenario left out', () => {
    const state = withTexts(WorkshopStore.blankState(), {
        appearance: '  Tall, ink-stained hands.  ', voice: 'Clipped and dry.', scenario: 'A storm traps you both at the clinic.', sexuality: '   '
    });
    assert.equal(WorkshopStore.compile(state), '## Appearance & body\nTall, ink-stained hands.\n\n## Voice\nClipped and dry.');
});

test('WorkshopStore: pins are found despite curly quotes, line breaks, case and dashes, and say where they landed', () => {
    const text = 'She says “never again” to\nanyone who asks — and means it… mostly.\n\nHer   scar is OLD.';
    const pinMap = {
        p1: '"never again" to anyone', // straight quotes, and a space where the text breaks the line
        p2: 'and means it... mostly', // three dots for the ellipsis character
        p3: 'her scar is old.', // case and spacing differ, with a full stop at the end
        p4: 'she hates the sea' // not in the text
    };
    const { landed, missing } = WorkshopStore.verifyPins(text, pinMap, ['p1', 'p2', 'p3', 'p4', 'p5']);
    deepEq(missing, ['p4', 'p5'], 'a phrase that is not there, and a pin the model never placed');
    deepEq(Object.fromEntries(landed.map(l => [l.id, text.slice(l.start, l.end)])),
        { p1: 'never again” to\nanyone', p2: 'and means it… mostly', p3: 'Her   scar is OLD' }, 'each span is the original text, ready to highlight');
    deepEq(WorkshopStore.verifyPins('', { p1: 'anything' }).missing, ['p1']);
});

test('WorkshopStore: 100 changes stay small, because commits hold only what changed', () => {
    const para = 'She keeps her hair cropped short and her boots laced tight, and she watches doors before faces. ';
    const start = WorkshopStore.blankState();
    const state = { ...start, concept: 'A medic on the night shift.',
        sections: start.sections.map((s, i) => ({ ...s, text: para.repeat(12), pins: [{ id: `p${i}`, text: 'watches doors', origin: 'you', state: 'kept', at: 1 }] })) };
    let ws = WorkshopStore.create({ state, original: { description: para.repeat(40), scenario: '' }, now: 1, commitId: 'c0' });
    for (let i = 1; i <= 100; i++) {
        const current = WorkshopStore.active(ws).state;
        const next = { ...current, sections: current.sections.map((s, j) => (j === i % 11 ? { ...s, text: `${para.repeat(12)}Edit ${i}.` } : s)) };
        ws = WorkshopStore.commit(ws, next, { now: 1 + i, commitId: `c${i}`, summary: `Edit ${i}` });
    }
    const kb = JSON.stringify(ws).length / 1024;
    assert.equal(ws.commits.length, 101);
    assert.ok(kb < 400, `about 315 KB for 100 edits to 1,150-character sections; got ${Math.round(kb)} KB`);
    deepEq(WorkshopStore.stateAt(ws, 'c100'), JSON.parse(JSON.stringify(WorkshopStore.active(ws).state)), 'and the newest point still rebuilds');
});

function workshopApplyPage({ saving = false } = {}) {
    const events = [];
    const characters = [{ id: 'ch1', name: 'Test', description: 'Old description.' }];
    const state = { characters, evolved_characters: {} };
    const store = {
        state,
        _isSaving: saving,
        async forceSave() { events.push(this._isSaving ? 'skipped' : 'saved'); }
    };
    const source = ['js/core/dom.js', 'js/services/workshop-ai.js', 'js/services/workshop-store.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', { ReactiveStore: store, setTimeout });
    return { WC, store, state, characters, events };
}

test('Workshop changes: put on the character as plain data, the description compiled, saved straight away', async () => {
    const p = workshopApplyPage();
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { appearance: 'Tall.', scenario: 'A storm.' }), { now: 2, commitId: 'c1' });
    const result = await p.WC.applyWorkshop('ch1', ws);
    const character = p.characters[0];
    assert.equal(character.description, '## Appearance & body\nTall.');
    assert.notEqual(character.workshop, ws, 'a copy, never the object passed in');
    deepEq(character.workshop, JSON.parse(JSON.stringify(ws)));
    deepEq(p.events, ['saved']);
    assert.equal(result.evolvedPersona, false);
    deepEq(p.WC.workshopOf('ch1'), JSON.parse(JSON.stringify(ws)));
    assert.notEqual(p.WC.workshopOf('ch1'), character.workshop, 'read back as a copy that is safe to change');

    p.state.evolved_characters.ch1 = 'A persona grown in this chat.';
    assert.equal((await p.WC.applyWorkshop('ch1', ws)).evolvedPersona, true, 'the chat has its own persona, which hides the change there');
    await assert.rejects(p.WC.applyWorkshop('somewhere-on-the-map', ws), /not in the open story/);
    assert.equal(p.WC.workshopOf('somewhere-on-the-map'), null);
});

test('Workshop changes: when a save is already running, wait for it, then save again', async () => {
    const p = workshopApplyPage({ saving: true });
    setTimeout(() => { p.store._isSaving = false; }, 150);
    await p.WC.applyWorkshop('ch1', WorkshopStore.create({ now: 1, commitId: 'c0' }));
    deepEq(p.events, ['saved'], 'saved after the other save finished, not skipped while it ran');
});

// ─── The Workshop screen ─────────────────────────────────────────────────────

test('WorkshopStore: a card splits by its headings, and everything it cannot place stays unsorted word for word', () => {
    const card = 'Intro line before any heading.\n\n### Appearance\nTall and lean.\n\n### Description\nWry, guarded.\n\n'
        + '### Mannerisms\nTaps the table when thinking.\n\n## Fears and Joys\nHates boats.\n\n## Likes\nRain.';
    const split = WorkshopStore.splitCard(card);
    deepEq(split.sections, { appearance: 'Tall and lean.', personality: 'Wry, guarded.', likes: 'Hates boats.\n\nRain.' },
        "the Story Architect's headings land in the Workshop's sections; two headings for one section are joined");
    assert.equal(split.unsorted, 'Intro line before any heading.\n\n### Mannerisms\nTaps the table when thinking.',
        'text before the first heading, and an unknown heading with its text, are kept as they were');
    deepEq(WorkshopStore.splitCard('Just prose, no headings.'), { sections: {}, unsorted: 'Just prose, no headings.' });

    const state = withTexts(WorkshopStore.blankState(), { appearance: 'Tall.', relationship: 'Owes you a favour.', scenario: 'A storm.' });
    const again = WorkshopStore.splitCard(WorkshopStore.compile(state));
    deepEq(again, { sections: { appearance: 'Tall.', relationship: 'Owes you a favour.' }, unsorted: '' }, "the Workshop's own headings split back where they came from");
});

test('WorkshopStore: unsorted card text comes first in the description, exactly as it was', () => {
    const state = { ...withTexts(WorkshopStore.blankState(), { voice: 'Clipped.' }), unsorted: '  Loose intro.  ' };
    assert.equal(WorkshopStore.compile(state), 'Loose intro.\n\n## Voice\nClipped.');
    const plain = { ...WorkshopStore.blankState(), unsorted: 'A card with no headings at all.' };
    assert.equal(WorkshopStore.compile(plain), 'A card with no headings at all.', 'a card with no headings compiles back to itself');
    let ws = WorkshopStore.create({ state: plain, now: 1, commitId: 'c0' });
    ws = WorkshopStore.commit(ws, { ...WorkshopStore.active(ws).state, unsorted: 'Trimmed.' }, { now: 2, commitId: 'c1' });
    assert.equal(WorkshopStore.stateAt(ws, 'c0').unsorted, 'A card with no headings at all.', 'unsorted text has a history too');
    assert.equal(ws.commits.at(-1).changes[0].section, '_unsorted');
});

test('WorkshopStore: the pin check counts kept pins only, by where the model put them or by their own words', () => {
    const section = {
        text: 'She never raises her voice. Rain makes her restless.',
        pinMap: { a: 'never raises her voice' },
        pins: [
            { id: 'a', text: 'calm', state: 'kept' },
            { id: 'b', text: 'Rain makes her restless', state: 'kept' },
            { id: 'c', text: 'afraid of dogs', state: 'kept' },
            { id: 'd', text: 'a suggestion', state: 'suggested' }
        ]
    };
    const check = WorkshopStore.checkPins(section);
    deepEq(check.landed.map(l => [l.id, section.text.slice(l.start, l.end)]), [['a', 'never raises her voice'], ['b', 'Rain makes her restless']]);
    deepEq(check.missing, ['c'], 'a suggested pin is not checked until it is kept');
    deepEq(WorkshopStore.checkPins({ ...section, text: '  ' }), { landed: [], missing: [] }, 'an empty section has nothing to check yet');
});

test('Workshop screen: a character without a Workshop starts from its card, and nothing is saved by opening it', () => {
    const p = workshopApplyPage();
    const ws = p.WC._fromCard({ id: 'ch1', description: 'Loose intro.\n\n### Appearance\nTall.' });
    const state = WorkshopStore.active(ws).state;
    assert.equal(state.unsorted, 'Loose intro.');
    assert.equal(state.sections.find(s => s.id === 'appearance').text, 'Tall.');
    deepEq(ws.original, { description: 'Loose intro.\n\n### Appearance\nTall.', scenario: '' });
    assert.equal(ws.commits[0].summary, 'Taken from the card');
    deepEq(p.events, [], 'nothing saved');
    assert.equal(p.characters[0].workshop, undefined, 'and nothing written to the character');

    const blank = p.WC._fromCard({ id: 'ch1', description: '' });
    assert.equal(blank.commits[0].summary, 'Started');
    assert.equal(WorkshopStore.compile(WorkshopStore.active(p.WC._fromCard({ description: 'No headings here.' })).state), 'No headings here.',
        'a card with no headings compiles back to exactly itself, so a first edit elsewhere loses nothing');
});

test('Workshop screen: wired in, with every way in and every button handled', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const controller = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    for (const id of ['character-workshop', 'ws-name', 'ws-variant', 'ws-notice', 'ws-progress', 'ws-sections', 'ws-card', 'ws-history', 'ws-history-body']) {
        assert.ok(html.includes(`id="${id}"`), `${id} is in the page`);
    }
    assert.match(html, /<link rel="stylesheet" href="css\/workshop\.css\?v=[0-9a-f]+">/, 'its stylesheet is linked');
    const actions = new Set([...html.matchAll(/data-action(?:-change)?="(workshop-[a-z-]+|open-workshop)"/g), ...controller.matchAll(/data-action="(workshop-[a-z-]+)"/g)].map(m => m[1]));
    for (const action of actions) assert.ok(controller.includes(`ActionHandler.register('${action}'`), `${action} has a handler`);

    const ui = fs.readFileSync(path.join(__dirname, 'js', 'ui', 'ui-manager.js'), 'utf8');
    assert.ok(ui.includes('data-action="open-workshop" data-id="${char.id}"'), "the character editor's Prompts tab opens it");
    const menu = html.slice(html.indexOf('id="character-context-menu"'), html.indexOf('id="message-context-menu"'));
    assert.ok(menu.includes('data-action="open-workshop"'), 'a long press on a name in the chat opens it');
    const handler = fs.readFileSync(path.join(__dirname, 'js', 'core', 'action-handler.js'), 'utf8');
    assert.ok(handler.includes('WorkshopController.canOpen(charId)'), 'and is hidden there for you, the narrator and places');
    const dropdown = html.slice(html.indexOf('id="new-story-dropdown"'), html.indexOf('<!-- Close Button -->', html.indexOf('id="new-story-dropdown"')));
    assert.ok(dropdown.includes('data-action="workshop-new-character"'), 'New Character is in the library');
    const boot = fs.readFileSync(path.join(__dirname, 'js', 'boot.js'), 'utf8');
    assert.ok(boot.includes('WorkshopController.openPending();'), 'a new character opens in the Workshop after its story loads');
    assert.ok(controller.includes("history.pushState(") && controller.includes("addEventListener('popstate'"), "Android's back button closes it");
    assert.ok(ui.includes('data-action="workshop-from-library" data-id="${story.id}"'), "a story in the library opens its character in the Workshop, beside Continue");
    assert.ok(controller.includes("ActionHandler.register('workshop-from-library'"));
});

/** The Workshop controller with a library of four stories: s1 (two characters, two chats), s2 (open), s3 (no chat yet), s4 (only you). */
function libraryEntryPage() {
    const calls = [];
    const notices = [];
    const opened = [];
    const focused = [];
    const session = {};
    const story = (id, characters, scenarios, narratives) => ({ id, characters: [{ id: 'me', name: 'You', is_user: true }, ...characters], scenarios, narratives });
    const library = {
        active_story_id: 's2',
        active_narrative_id: 'n2',
        stories: [
            story('s1', [{ id: 'nar', name: 'Narrator', is_narrator: true }, { id: 'kael', name: 'Kael' }, { id: 'elara', name: 'Elara' }],
                [{ id: 'sc1', opening_character_id: 'elara' }],
                [{ id: 'old', last_modified: '2026-10-01T00:00:00Z' }, { id: 'new', last_modified: '2026-10-10T00:00:00Z' }]),
            story('s2', [{ id: 'ch1', name: 'Kael' }], [{ id: 'sc2' }], [{ id: 'n2', last_modified: '2026-10-12T00:00:00Z' }]),
            story('s3', [{ id: 'ch3', name: 'Nova' }], [{ id: 'sc3' }], []),
            story('s4', [], [{ id: 'sc4' }], [])
        ]
    };
    const store = {
        state: { characters: library.stories[1].characters },
        async forceSave() { calls.push(['forceSave']); },
        blockAutoSave() { calls.push(['blockAutoSave']); }
    };
    const handlers = {};
    const element = id => ({ focus() { focused.push(id); }, classList: { add() { }, remove() { } }, addEventListener() { } });
    const source = ['js/core/dom.js', 'js/services/workshop-store.js', 'js/util/workshop-prompts.js', 'js/util/cowriter-prompts.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', {
        document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [], activeElement: null, body: element('body') },
        sessionStorage: { getItem: k => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); }, removeItem: k => { delete session[k]; } },
        ReactiveStore: store, StateManager: { getLibrary: () => library }, UTILITY,
        LibraryController: {
            loadNarrative: (storyId, narrativeId) => calls.push(['loadNarrative', storyId, narrativeId]),
            async createNarrativeFromScenario(storyId, scenarioId) { calls.push(['createNarrativeFromScenario', storyId, scenarioId]); }
        },
        AppController: { closeModal: id => calls.push(['closeModal', id]) },
        UIManager: { showNotification: (text, type) => notices.push([text, type]) },
        ActionHandler: { register: (name, fn) => { handlers[name] = fn; } }, window: { addEventListener() { }, matchMedia: () => ({ matches: false }) }, debounce: fn => fn
    });
    WC.registerActions();
    WC.open = id => opened.push(id);
    return { WC, calls, notices, opened, focused, session, library, store, act: (name, dataset = {}) => handlers[name](dataset) };
}

test('Workshop from the library: a story opens its lead, after loading its latest chat, or a new one from its first opening; the open story needs no reload', async () => {
    const p = libraryEntryPage();
    await p.act('workshop-from-library', { id: 's1' });
    deepEq(p.calls, [['forceSave'], ['blockAutoSave'], ['loadNarrative', 's1', 'new']], 'its latest chat loads, saved first');
    deepEq(JSON.parse(p.session['rolecraft-workshop-open']), { id: 'elara' }, 'and its lead waits across the reload: whoever speaks the first opening');

    p.library.active_story_id = 's1';
    p.store.state.characters = p.library.stories[0].characters;
    p.WC.openPending();
    deepEq(p.opened, ['elara'], 'once the story has loaded, the Workshop opens');
    deepEq(p.focused, [], 'without the keyboard: it is not a new character');
    assert.equal(p.session['rolecraft-workshop-open'], undefined, 'and only once');

    p.calls.length = 0;
    await p.act('workshop-from-library', { id: 's3' });
    deepEq(p.calls, [['createNarrativeFromScenario', 's3', 'sc3']], 'a story with no chat yet starts one from its first opening');
    deepEq(JSON.parse(p.session['rolecraft-workshop-open']), { id: 'ch3' });

    p.calls.length = 0;
    await p.act('workshop-from-library', { id: 's1' });
    deepEq(p.calls, [['closeModal', 'story-details-modal'], ['closeModal', 'story-library-modal']], 'the story already open just closes the library');
    deepEq(p.opened, ['elara', 'elara']);

    p.calls.length = 0;
    await p.act('workshop-from-library', { id: 's4' });
    deepEq(p.calls, [], 'a story with only you opens nothing');
    assert.equal(p.notices.at(-1)[0], 'This story has no character to open in the Workshop.');
});

test('Workshop from the library: a new character still opens at the concept, ready to type, as it did before', () => {
    const p = libraryEntryPage();
    p.session['rolecraft-workshop-open'] = JSON.stringify({ id: 'ch1', concept: true });
    p.WC.openPending();
    deepEq([p.opened, p.focused], [['ch1'], ['ws-concept']]);
    p.session['rolecraft-workshop-open'] = 'ch1';
    p.WC.openPending();
    deepEq([p.opened, p.focused], [['ch1', 'ch1'], ['ws-concept', 'ws-concept']], 'a plain id, waiting from before this change, too');
    const controller = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    assert.ok(controller.includes('JSON.stringify({ id: character.id, concept: true })'), 'New character asks for the concept');
});

// ─── Writing with the Workshop's AI ──────────────────────────────────────────

const WorkshopPrompts = vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'js', 'util', 'workshop-prompts.js'), 'utf8') + '\nWorkshopPrompts', {});

/** A state with pins on Personality (two kept, one only suggested) and Voice locked. */
function pinnedState() {
    const state = withTexts(WorkshopStore.blankState(), { appearance: 'Tall.', voice: 'Clipped.' });
    state.concept = 'A medic on the night shift.';
    state.notes = 'Slow burn.';
    state.sections = state.sections.map(s => {
        if (s.id === 'personality') {
            return {
                ...s, length: 'long', pins: [
                    { id: 'pa', text: 'slow to trust', state: 'kept' },
                    { id: 'pb', text: 'hums when nervous', state: 'kept' },
                    { id: 'pc', text: 'an idea not kept yet', state: 'suggested' }]
            };
        }
        return s.id === 'voice' ? { ...s, locked: true } : s;
    });
    return state;
}

test('WorkshopPrompts: every request carries the rules, the whole character and each kept pin by label', () => {
    const ask = WorkshopPrompts.writeSection({ name: 'Test', state: pinnedState(), sectionId: 'personality' });
    const [system, user] = ask.messages;
    assert.equal(system.role, 'system');
    for (const rule of [/fiction for adults/, /explicit themes/, /Do not soften, censor, moralize/, /\{\{char\}\}/, /\{\{user\}\}/,
        /Never write a literal name/, /never contradict a pin/, /LOCKED is final/, /JSON only/]) {
        assert.match(system.content, rule);
    }
    assert.match(user.content, /CHARACTER: Test \(always written as \{\{char\}\}\)/);
    assert.match(user.content, /CONCEPT: A medic on the night shift\./);
    assert.match(user.content, /STORY NOTES: Slow burn\./);
    assert.match(user.content, /## Voice \[LOCKED: keep word for word\]\nClipped\./, 'locked text is marked to be kept word for word');
    assert.match(user.content, /## Appearance & body\nTall\./);
    const task = user.content.split('TASK:')[1];
    assert.match(task, /P1: slow to trust\nP2: hums when nervous/, 'each kept pin, labelled');
    assert.ok(!task.includes('an idea not kept yet'), 'a suggested pin is not a must-have');
    assert.match(task, /about 300 to 450 words/, 'the length dial sets the target');
    assert.match(task, /"P1": "the exact phrase from your text that carries it"/);
    assert.equal(ask.temperature, undefined, "writing is left at the model's own temperature");

    const reweave = WorkshopPrompts.writeSection({ name: 'Test', state: pinnedState(), sectionId: 'appearance', reweave: true });
    assert.match(reweave.messages[1].content, /Re-weave the "Appearance & body" section.*keeping every sentence of the current text that still fits/s);
});

test('WorkshopPrompts: takes must differ, avoid what was turned down, and follow the creativity dial', () => {
    const ask = WorkshopPrompts.takes({ name: 'Test', state: pinnedState(), sectionId: 'appearance', avoid: ['Told through old scars'], creativity: 5 });
    const task = ask.messages[1].content.split('TASK:')[1];
    assert.match(task, /different angle, a different structure and a different opening line/);
    assert.match(task, /reuse the current text's angle/);
    assert.match(task, /turned these down before.*\n- Told through old scars/s);
    assert.match(task, /Go as far as you can/);
    deepEq(WorkshopPrompts.CREATIVITY.map(c => c.temperature), [0.6, 0.8, 1.0, 1.15, 1.3]);
    assert.equal(ask.temperature, 1.3);
    assert.equal(WorkshopPrompts.takes({ name: 'T', state: pinnedState(), sectionId: 'appearance' }).temperature, 1.0, 'the middle of the dial by default');
    assert.equal(WorkshopPrompts.takes({ name: 'T', state: pinnedState(), sectionId: 'appearance', creativity: 9 }).temperature, 1.3, 'kept on the dial');
});

test('WorkshopPrompts: answers are checked, and pin labels become pin ids', () => {
    const pins = WorkshopPrompts.labels(pinnedState().sections.find(s => s.id === 'personality'));
    deepEq(WorkshopPrompts.readSection({ text: ' Wry. ', pins: { P1: 'slow to trust', P2: '', P9: 'unknown' } }, pins), { text: 'Wry.', pinMap: { pa: 'slow to trust' } });
    assert.throws(() => WorkshopPrompts.readSection({ text: '   ' }, pins), /no text/);

    const takes = WorkshopPrompts.readTakes({ takes: [{ angle: 'Habits', text: 'A', pins: { P2: 'hums' } }, { text: 'B' }, { text: '' }, { text: 'C' }, { text: 'D' }] }, pins);
    deepEq(takes.map(t => [t.angle, t.text]), [['Habits', 'A'], ['A different take', 'B'], ['A different take', 'C']], 'three at most, empty ones dropped, every one named');
    deepEq(takes[0].pinMap, { pb: 'hums' });
    assert.throws(() => WorkshopPrompts.readTakes({ takes: [] }, pins), /no takes/);

    const sections = pinnedState().sections.filter(s => ['personality', 'background'].includes(s.id));
    deepEq(WorkshopPrompts.readSuggestions({
        pins: { personality: ['Slow to trust', 'Hates silence', 'hates silence', 'a', 'b', 'c'], background: ['  Grew up by the sea  '], kinks: ['not asked for'] }
    }, sections), { personality: ['Hates silence', 'a', 'b', 'c'], background: ['Grew up by the sea'] },
    'no repeats of each other or of pins it has, four at most, only the sections asked for');
    assert.throws(() => WorkshopPrompts.readSuggestions({ pins: {} }, sections), /no pins/);
});

test('WorkshopStore: proposals wait outside the history, and accepting them is one commit', () => {
    let ws = WorkshopStore.create({ state: pinnedState(), now: 1, commitId: 'c0' });
    ws = WorkshopStore.setPending(ws, 'appearance', { kind: 'write', text: 'Lean and tall.', pinMap: {} });
    ws = WorkshopStore.setPending(ws, 'voice', { kind: 'write', text: 'Should not land.', pinMap: {} });
    ws = WorkshopStore.setPending(ws, 'personality', { kind: 'write', text: 'Wry and slow to trust.', pinMap: { pa: 'slow to trust' } });
    assert.equal(ws.commits.length, 1, 'waiting proposals are not history');
    const done = WorkshopStore.acceptMany(ws, { appearance: ws.pending.appearance, voice: ws.pending.voice, personality: ws.pending.personality },
        { summary: 'Wrote 3 sections', now: 2, commitId: 'c1' });
    assert.equal(done.commits.length, 2, 'one commit for all of them');
    const sections = WorkshopStore.active(done).state.sections;
    assert.equal(sections.find(s => s.id === 'appearance').text, 'Lean and tall.');
    assert.equal(sections.find(s => s.id === 'voice').text, 'Clipped.', 'a locked section keeps its text');
    deepEq(sections.find(s => s.id === 'personality').pinMap, { pa: 'slow to trust' });
    deepEq(done.pending, {}, 'and every proposal is cleared');

    let avoided = WorkshopStore.addAvoid(ws, 'voice', 'Told through letters');
    avoided = WorkshopStore.addAvoid(avoided, 'voice', 'Told through letters');
    deepEq(avoided.avoid.voice, ['Told through letters'], 'remembered once');
    for (let i = 0; i < 25; i++) avoided = WorkshopStore.addAvoid(avoided, 'voice', `angle ${i}`);
    assert.equal(avoided.avoid.voice.length, 20, 'the newest twenty');

    const suggested = WorkshopStore.addSuggestions(WorkshopStore.blankState(), { kinks: ['one', 'two'] }, 5);
    deepEq(suggested.sections.find(s => s.id === 'kinks').pins.map(p => [p.text, p.state, p.origin, p.at]), [['one', 'suggested', 'ai', 5], ['two', 'suggested', 'ai', 5]]);
});

/** The Workshop controller with a stand-in model that answers from a list, on a page that is never drawn. */
function workshopAiPage(answers, state = pinnedState()) {
    const calls = [];
    const notices = [];
    const cards = [];
    const element = () => {
        const classes = new Set();
        return {
            innerHTML: '', outerHTML: '', value: '', textContent: '', style: {}, dataset: {},
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle() { }, contains: c => classes.has(c) },
            querySelector: () => null, querySelectorAll: () => [], contains: () => false, focus() { }, setAttribute() { }, addEventListener() { }
        };
    };
    const elements = {};
    const handlers = {};
    const byId = id => elements[id] || (elements[id] = element());
    const characters = [{ id: 'ch1', name: 'Test', description: '' }];
    const store = { state: { characters, evolved_characters: {} }, _isSaving: false, async forceSave() { } };
    const WorkshopAI = {
        async chat(opts) {
            calls.push(opts);
            const next = answers.shift();
            if (next instanceof Error) throw next;
            return { text: JSON.stringify(next), thinking: '', finishReason: 'stop', provider: 'Test', data: next, attempts: 1 };
        }
    };
    const source = ['js/core/dom.js', 'js/services/workshop-store.js', 'js/util/workshop-prompts.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', {
        document: { getElementById: byId, querySelector: element, querySelectorAll: () => [], activeElement: null },
        ReactiveStore: store, WorkshopAI, AbortController, setTimeout, UTILITY,
        UIManager: { showNotification: (text, type) => notices.push([text, type]) },
        ActionHandler: { register: (name, fn) => { handlers[name] = fn; } }, window: { addEventListener() { } }, debounce: fn => fn,
        LibraryController: { async exportCharacterCard(...args) { cards.push(args); } }
    });
    WC.registerActions();
    WC.RUNTIME.view = { charId: 'ch1', ws: WorkshopStore.create({ state, now: 1, commitId: 'c0' }), tab: 'sections', editing: null, addingPin: null };
    /** Presses a button on the screen: the action's handler, with the button's data-* values. */
    const act = (name, dataset = {}, value) => handlers[name](dataset, value);
    return { WC, calls, characters, elements, notices, cards, act, view: () => WC.RUNTIME.view };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('Workshop AI: a written section waits as a proposal, and using it is a commit that rewrites the card', async () => {
    const p = workshopAiPage([{ text: 'Wry, guarded, and slow to trust.', pins: { P1: 'slow to trust' } }]);
    await p.WC._ask('write', 'personality');
    assert.equal(p.calls.length, 1);
    assert.equal(p.calls[0].json, true);
    const pending = p.view().ws.pending.personality;
    deepEq({ kind: pending.kind, text: pending.text, pinMap: pending.pinMap }, { kind: 'write', text: 'Wry, guarded, and slow to trust.', pinMap: { pa: 'slow to trust' } });
    assert.equal(p.view().ws.commits.length, 1, 'nothing changed yet');
    assert.ok(p.characters[0].workshop.pending.personality, 'the proposal is saved, so closing the Workshop keeps it');

    p.WC.acceptProposal('personality');
    await settle();
    const last = p.view().ws.commits.at(-1);
    assert.equal(last.summary, 'Wrote Personality with the AI');
    assert.equal(last.origin, 'ai');
    assert.match(p.characters[0].description, /## Personality\nWry, guarded, and slow to trust\./);
    assert.equal(p.view().busy, null);
});

test('Workshop AI: takes at a chosen creativity, "Not this" steers the next batch, and one is used', async () => {
    const batch = angle => ({ takes: [{ angle, text: `${angle} text.` }, { angle: `${angle} two`, text: 'Two.' }, { angle: `${angle} three`, text: 'Three.' }] });
    const p = workshopAiPage([batch('Through habits'), batch('Through history')]);
    await p.WC._ask('takes', 'appearance', 4);
    assert.equal(p.calls[0].temperature, 1.15);
    assert.equal(p.view().ws.pending.appearance.takes.length, 3);

    p.WC.rejectTake('appearance', 0);
    await settle();
    deepEq(p.view().ws.avoid.appearance, ['Through habits']);
    assert.equal(p.view().ws.pending.appearance.takes.length, 2);

    await p.WC._ask('takes', 'appearance');
    assert.match(p.calls[1].messages[1].content, /turned these down before.*- Through habits/s);
    assert.equal(p.calls[1].temperature, 1.15, 'the next batch keeps the dial where it was');

    p.WC.useTake('appearance', 0);
    await settle();
    assert.equal(WorkshopStore.active(p.view().ws).state.sections[0].text, 'Through history text.');
    assert.equal(p.view().ws.commits.at(-1).summary, 'Took "Through history" for Appearance & body');
    assert.equal(p.view().ws.pending.appearance, undefined);
});

test('Workshop AI: writing the empty sections builds each one on those before it, and they are used together', async () => {
    const state = pinnedState();
    state.sections = state.sections.map(s => (['background', 'wardrobe'].includes(s.id) ? s : { ...s, locked: true }));
    const p = workshopAiPage([{ text: 'Raised in a port town.' }, { text: 'Scrubs and a battered coat.' }], state);
    await p.WC._ask('write-all');
    assert.equal(p.calls.length, 2, 'one request per empty, unlocked section');
    assert.match(p.calls[1].messages[1].content, /## Background\nRaised in a port town\./, 'the second section reads the first');
    p.WC.acceptAll();
    await settle();
    assert.equal(p.view().ws.commits.at(-1).summary, 'Wrote 2 sections with the AI');
    assert.match(p.characters[0].description, /## Background\nRaised in a port town\./);
    assert.match(p.characters[0].description, /## Wardrobe\nScrubs and a battered coat\./);
});

test('Workshop AI: suggested pins arrive as suggestions; failures show on the section; Stop is quiet', async () => {
    const stopped = new Error('stopped');
    stopped.name = 'AbortError';
    const state = pinnedState();
    state.sections = state.sections.map(s => (s.id === 'kinks' ? s : { ...s, text: s.text || 'Written.' }));
    const p = workshopAiPage([{ pins: { kinks: ['Likes being chased'] } }, new Error('Too many requests right now.'), stopped], state);
    await p.WC._ask('suggest');
    const kinks = WorkshopStore.active(p.view().ws).state.sections.find(s => s.id === 'kinks');
    deepEq(kinks.pins.map(x => [x.text, x.state]), [['Likes being chased', 'suggested']]);
    assert.equal(p.view().ws.commits.at(-1).origin, 'ai');

    await p.WC._ask('write', 'kinks');
    assert.equal(p.view().errors.kinks, 'Too many requests right now.');
    assert.equal(p.view().busy, null, 'and the buttons are free again');
    await p.WC._ask('write', 'kinks');
    deepEq(p.view().errors, {}, 'a stopped request is not an error');
});

test('fake AI server: replies can be queued, to drive a screen through real-looking answers', async () => {
    await withFakeAI(async ({ url, ask }) => {
        const queued = await (await fetch(`${url}/fake/next`, { method: 'POST', body: JSON.stringify({ replies: [{ text: 'Queued.' }, 'Second.'] }) })).json();
        assert.equal(queued.queued, 2);
        assert.equal((await (await ask({ messages: [{ role: 'user', content: 'Hi' }] })).json()).choices[0].message.content, '{"text":"Queued."}');
        const second = sseData(await (await ask({ stream: true, messages: [{ role: 'user', content: 'Hi [[fake delay=0]]' }] })).text());
        assert.equal(second.slice(0, -1).map(c => c.choices[0].delta.content || '').join(''), 'Second.', 'and still streams');
        assert.match((await (await ask({ messages: [{ role: 'user', content: 'Hi' }] })).json()).choices[0].message.content, /made-up reply/, 'then back to normal');
    });
});

// ─── Sorting an old card into sections ───────────────────────────────────────

/** A character whose card has a loose block, one section already split by its heading, and Voice locked. */
function looseState() {
    const state = withTexts(WorkshopStore.blankState(), { appearance: 'Tall.', voice: 'Clipped.' });
    state.unsorted = 'She grew up in a port town. She never asks for help.\nShe owes you a favour.';
    state.sections = state.sections.map(s => (s.id === 'voice' ? { ...s, locked: true } : s));
    return state;
}

test('WorkshopPrompts: sorting asks for the exact words moved, nothing left out, and pins drawn from the text', () => {
    const ask = WorkshopPrompts.sortCard({ name: 'Test', state: looseState() });
    const task = ask.messages[1].content.split('TASK:')[1];
    assert.match(task, /keeping the author's exact words: move sentences, never rewrite, shorten or add to them/);
    assert.match(task, /Leave nothing out/);
    assert.match(task, /"leftover"/);
    assert.match(task, /2 to 4 short must-have ideas/);
    assert.ok(!task.includes('voice ("Voice")'), 'a locked section takes nothing');
    assert.match(ask.messages[1].content, /FROM THE OLD CARD, NOT SORTED INTO SECTIONS YET:\nShe grew up in a port town\./);

    const plain = WorkshopPrompts.sortCard({ name: 'Test', state: { ...looseState(), unsorted: '' } });
    const pinsOnly = plain.messages[1].content.split('TASK:')[1];
    assert.match(pinsOnly, /Draft pins from the text the sections already have/);
    assert.ok(!pinsOnly.includes('"leftover"'), 'with nothing to sort, only pins are asked for');
});

test('WorkshopPrompts: a sorting that changed or dropped a sentence puts it back, word for word', () => {
    const sort = WorkshopPrompts.readSort({
        sections: {
            background: 'She grew up in a port town.',
            personality: 'She rarely asks anyone for help.', // reworded: does not count
            voice: 'Locked section, so refused.',
            nowhere: 'Not a section.'
        },
        leftover: '',
        pins: { background: ['Port town childhood', 'port town childhood', 'Tall.'], appearance: ['tall.', 'Long legs'], voice: ['no'] }
    }, looseState());
    deepEq(sort.sections, { background: 'She grew up in a port town.', personality: 'She rarely asks anyone for help.' });
    assert.equal(sort.leftover, 'She never asks for help. She owes you a favour.', 'the reworded and the forgotten sentences come back as they were');
    assert.equal(sort.restored, 2);
    deepEq(sort.pins, { background: ['Port town childhood', 'Tall.'], appearance: ['tall.', 'Long legs'] }, 'no repeats, nothing for a locked section');
    assert.throws(() => WorkshopPrompts.readSort({ sections: {}, pins: {} }, { ...looseState(), unsorted: '' }), /sorted nothing/);
    deepEq(WorkshopPrompts.sentences('One. Two!  Three?\nFour'), ['One.', 'Two!', 'Three?', 'Four']);
});

test('WorkshopStore: a sorting adds to each section, leaves the rest unsorted, and drafts pins as suggestions', () => {
    const state = looseState();
    const next = WorkshopStore.applySort(state, {
        sections: { appearance: 'Long legs.', background: 'She grew up in a port town.', voice: 'Refused.' },
        leftover: 'She owes you a favour.',
        pins: { background: ['Port town childhood'], voice: ['no'] }
    }, 7);
    const get = id => next.sections.find(s => s.id === id);
    assert.equal(get('appearance').text, 'Tall.\n\nLong legs.', 'moved text joins the end of what the section had');
    assert.equal(get('background').text, 'She grew up in a port town.');
    assert.equal(get('voice').text, 'Clipped.', 'a locked section is left alone');
    assert.equal(get('voice').pins.length, 0);
    deepEq(get('background').pins.map(p => [p.text, p.state, p.origin, p.at]), [['Port town childhood', 'suggested', 'unflatten', 7]]);
    assert.equal(next.unsorted, 'She owes you a favour.');
});

test('Workshop AI: sorting the card waits for a yes, then is one commit; Use all leaves it alone', async () => {
    const answer = {
        sections: { background: 'She grew up in a port town.', personality: 'She never asks for help.' },
        leftover: 'She owes you a favour.',
        pins: { personality: ['Never asks for help'] }
    };
    const p = workshopAiPage([answer], looseState());
    await p.WC._ask('sort');
    const pending = p.view().ws.pending._sort;
    assert.equal(pending.kind, 'sort');
    assert.equal(pending.restored, 0);
    assert.equal(p.view().ws.commits.length, 1, 'nothing changed yet');

    p.WC.acceptAll();
    await settle();
    assert.ok(p.view().ws.pending._sort, '"Use all" is for written sections, not for a sorting');

    p.WC.acceptSort();
    await settle();
    const state = WorkshopStore.active(p.view().ws).state;
    assert.equal(p.view().ws.commits.at(-1).summary, 'Sorted the card into 2 sections');
    assert.equal(state.unsorted, 'She owes you a favour.');
    assert.equal(p.view().ws.pending._sort, undefined);
    assert.equal(p.characters[0].description,
        'She owes you a favour.\n\n## Appearance & body\nTall.\n\n## Personality\nShe never asks for help.\n\n## Background\nShe grew up in a port town.\n\n## Voice\nClipped.');
});

test('Workshop screen: sorting is offered on the unsorted card, and pins are offered for a card split by headings', () => {
    const controller = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    const unsorted = controller.slice(controller.indexOf('_unsortedCard(state) {'), controller.indexOf('_notesCard(state) {'));
    assert.ok(unsorted.includes('data-action="workshop-sort"'), 'Sort into sections sits on the unsorted card');
    assert.ok(controller.includes('Draft pins from the text'));
    for (const action of ['workshop-sort', 'workshop-sort-accept', 'workshop-sort-discard']) {
        assert.ok(controller.includes(`ActionHandler.register('${action}'`), `${action} has a handler`);
    }
});

// ─── History and variants ────────────────────────────────────────────────────

/** A Workshop page with two steps on Main after the start: Personality drafted, then redrafted. */
function historyPage() {
    const p = workshopAiPage([]);
    let ws = p.view().ws;
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded.' }), { now: 2, commitId: 'c1', summary: 'First draft' });
    ws = WorkshopStore.commit(ws, withTexts(WorkshopStore.active(ws).state, { personality: 'Guarded, then reckless.' }), { now: 3, commitId: 'c2', summary: 'Second draft' });
    p.view().ws = ws;
    p.drawer = () => p.elements['ws-history-body'].innerHTML;
    return p;
}

test('History: the drawer lists the variants and the steps that led here, newest first, and a step opens to show what changed', () => {
    const p = historyPage();
    p.act('workshop-history-open');
    assert.equal(p.elements['ws-history'].classList.contains('hidden'), false, 'the drawer opens');
    let html = p.drawer();
    assert.ok(html.indexOf('Second draft') < html.indexOf('First draft') && html.indexOf('First draft') < html.indexOf('Started'), 'newest first');
    assert.ok(html.includes('value="Main"') && html.includes('In use'));
    assert.ok(!html.includes('data-action="workshop-variant-delete"'), 'the only variant has no Delete');
    assert.ok(!html.includes('Go back to here'), 'steps start closed');

    p.act('workshop-commit-toggle', { commit: 'c1' });
    html = p.drawer();
    assert.ok(html.includes('data-action="workshop-restore" data-commit="c1"'), 'an earlier step can be gone back to');
    assert.ok(html.includes('data-action="workshop-branch" data-commit="c1"'), 'or branched from');
    assert.match(html, /Personality<\/div>[\s\S]*?Now<\/span><div class="ws-text is-proposal">Guarded\.<\/div>/, 'what the section became');

    p.act('workshop-commit-toggle', { commit: 'c2' });
    html = p.drawer();
    assert.ok(!html.includes('data-action="workshop-branch" data-commit="c1"'), 'one step open at a time');
    assert.ok(html.includes('This is where the character is now.') && !html.includes('Go back to here'), 'the newest step is where it is now');
    assert.match(html, /Before<\/span><div class="ws-text is-before">Guarded\.<\/div>[\s\S]*?After<\/span><div class="ws-text is-proposal">Guarded, then reckless\.<\/div>/);

    p.act('workshop-commit-toggle', { commit: 'c2' });
    assert.equal(p.view().expanded, null, 'tapping it again closes it');
    p.act('workshop-history-close');
    assert.ok(p.elements['ws-history'].classList.contains('hidden'));
});

test('History: going back is a new step, variants branch, switch, rename, delete and come back, and the card follows', async () => {
    const p = historyPage();
    const card = () => p.characters[0].description;
    p.act('workshop-history-open');

    p.act('workshop-restore', { commit: 'c1' });
    await settle();
    assert.equal(p.view().ws.commits.length, 4, 'nothing removed');
    assert.equal(p.view().ws.commits.at(-1).origin, 'restore');
    assert.ok(card().includes('## Personality\nGuarded.\n'), 'the card is back at that point');
    assert.ok(p.drawer().includes('Went back to: First draft'));

    p.act('workshop-branch', { commit: 'c2' });
    await settle();
    const variant = WorkshopStore.active(p.view().ws);
    assert.equal(variant.name, 'Variant 2');
    assert.equal(p.elements['ws-variant'].textContent, 'Variant 2', 'the header shows the variant in use');
    assert.ok(card().includes('Guarded, then reckless.'), 'the card is now the new variant');
    assert.equal((p.drawer().match(/data-action="workshop-variant-delete"/g) || []).length, 2, 'with two, either can go');

    p.act('workshop-variant-rename', { variant: variant.id }, '  Reckless  ');
    await settle();
    assert.equal(WorkshopStore.active(p.view().ws).name, 'Reckless');
    assert.equal(p.elements['ws-variant'].textContent, 'Reckless');

    p.act('workshop-variant-switch', { variant: 'v_main' });
    await settle();
    assert.ok(card().includes('## Personality\nGuarded.\n'), 'switching recompiles the description');
    assert.ok(p.drawer().includes(`data-action="workshop-variant-switch" data-variant="${variant.id}"`));

    p.act('workshop-variant-delete', { variant: 'v_main' });
    await settle();
    assert.equal(p.view().ws.active, variant.id, 'deleting the one in use moves to the other');
    assert.ok(card().includes('Guarded, then reckless.'));
    assert.ok(p.drawer().includes('bring back Main'));
    assert.ok(!p.drawer().includes('data-action="workshop-variant-delete"'), 'the last one left has no Delete');

    p.act('workshop-variant-restore', { variant: 'v_main' });
    await settle();
    assert.ok(!p.drawer().includes('bring back'));
    assert.equal(p.view().ws.active, variant.id, 'bringing it back does not switch to it');
    assert.equal(p.characters[0].workshop.variants.filter(v => !v.deletedAt).length, 2, 'and every change was saved');
});

test('History: nothing switches while the AI is writing, and closing the Workshop closes the drawer', () => {
    const p = historyPage();
    p.act('workshop-history-open');
    const before = p.view().ws;
    p.view().busy = { kind: 'write' };
    p.act('workshop-branch', { commit: 'c1' });
    p.act('workshop-restore', { commit: 'c1' });
    assert.equal(p.view().ws, before, 'nothing changed');
    assert.match(p.notices.at(-1)[0], /Wait for the AI to finish/);
    p.view().busy = null;
    p.WC.close();
    assert.ok(p.elements['ws-history'].classList.contains('hidden'), 'so it is not left open for the next character');
});

test("Workshop screen: tapping a pin's words rewords it, and a reworded suggestion is kept", async () => {
    const state = pinnedState();
    const personality = state.sections.find(s => s.id === 'personality');
    personality.text = 'Wry, and slow to trust anyone new.';
    personality.pinMap = { pa: 'slow to trust anyone new' };
    const p = workshopAiPage([], state);
    const card = () => p.elements['ws-sec-personality'].outerHTML;
    const pin = id => WorkshopStore.active(p.view().ws).state.sections.find(s => s.id === 'personality').pins.find(x => x.id === id);
    const done = (id, value) => p.WC._fieldDone({ dataset: { section: 'personality', pin: id }, value, classList: { contains: c => c === 'ws-pin-input' } });

    p.WC.renderSection('personality');
    assert.match(card(), /<button type="button" class="ws-pin-text" data-action="workshop-pin-edit"\s+data-section="personality" data-pin="pa"[^>]*>slow to trust<\/button>/,
        "a pin's words are a button");

    p.act('workshop-pin-edit', { section: 'personality', pin: 'pc' });
    assert.match(card(), /<textarea class="ws-pin-input" data-section="personality" data-pin="pc"[^>]*>an idea not kept yet<\/textarea>/,
        'tapping them shows the whole pin in a box');
    done('pc', '  Hums when\nshe lies  ');
    await settle();
    assert.equal(pin('pc').text, 'Hums when she lies', 'on one line, trimmed');
    assert.equal(pin('pc').state, 'kept', 'a suggestion you reword is kept');
    assert.equal(pin('pc').origin, 'you');
    const reworded = p.view().ws.commits.at(-1);
    assert.equal(reworded.summary, 'Reworded the pin "Hums when she lies"');
    assert.equal(p.view().editingPin, null);
    assert.ok(!card().includes('<textarea'), 'and it is a pin again');

    p.act('workshop-pin-edit', { section: 'personality', pin: 'pa' });
    done('pa', 'Trusts no one at first');
    await settle();
    assert.equal(WorkshopStore.active(p.view().ws).state.sections.find(s => s.id === 'personality').pinMap.pa, undefined,
        'the phrase the AI said carried the old words is forgotten');

    const commits = p.view().ws.commits.length;
    for (const value of ['', '   ', 'Trusts no one at first']) {
        p.act('workshop-pin-edit', { section: 'personality', pin: 'pa' });
        done('pa', value);
    }
    await settle();
    assert.equal(p.view().ws.commits.length, commits, 'empty or unchanged words change nothing');
    assert.equal(pin('pa').text, 'Trusts no one at first');

    p.act('workshop-history-open');
    p.act('workshop-commit-toggle', { commit: reworded.id });
    const html = p.elements['ws-history-body'].innerHTML;
    assert.ok(html.includes('Pin reworded from &quot;an idea not kept yet&quot; to &quot;Hums when she lies&quot;'), 'the history shows the old words');
    assert.ok(html.includes('Pin kept: Hums when she lies'));
});

test('Workshop AI: while it works, a strip under the tabs says what it is doing, with Stop, and goes when it is done', async () => {
    const p = workshopAiPage([{ takes: [{ angle: 'A', text: 'One.' }, { angle: 'B', text: 'Two.' }, { angle: 'C', text: 'Three.' }] }]);
    const job = p.WC._ask('takes', 'appearance');
    const strip = p.elements['ws-progress'];
    assert.equal(strip.classList.contains('hidden'), false, 'it shows as soon as the AI starts');
    assert.match(strip.innerHTML, /3 takes for Appearance &amp; body/);
    assert.match(strip.innerHTML, /id="ws-busy-status"[^>]*>Asking the Workshop model\.\.\.</, 'the count of what has arrived goes here');
    assert.ok(strip.innerHTML.includes('data-action="workshop-ai-stop"'), 'with Stop');
    assert.ok(!p.elements['ws-sec-appearance'].outerHTML.includes('ws-busy-status'), 'and not in the section as well');
    await job;
    assert.ok(strip.classList.contains('hidden'), 'gone when the AI is done');
    assert.equal(strip.innerHTML, '');

    const title = (kind, sectionId) => p.WC._busyTitle({ kind, sectionId });
    deepEq([title('write', 'voice'), title('reweave', 'voice'), title('suggest'), title('write-all'), title('sort')],
        ['Writing Voice', 'Re-weaving Voice', 'Suggesting pins', 'Writing the empty sections', 'Drafting pins from the text']);
    assert.equal(workshopAiPage([], looseState()).WC._busyTitle({ kind: 'sort' }), 'Sorting the card into sections');
});

// ─── Character cards: export and import ──────────────────────────────────────

const zlib = require('zlib');

/** The import/export service, with Node standing in for the browser's text, base64 and inflate tools. */
function cardService() {
    return vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'js', 'services', 'import-export.js'), 'utf8') + '\nImportExportService', {
            UTILITY, WorkshopStore, TextEncoder, TextDecoder, Blob, atob, btoa,
            pako: { inflate: bytes => new Uint8Array(zlib.inflateSync(bytes)) }
        });
}

/** One PNG chunk: length, type, data and CRC. */
function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
}

/** A 1x1 PNG, with any extra chunks just before IEND. */
function tinyPng(extra = []) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
        ...extra,
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

const arrayBufferOf = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const cardB64 = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
const textChunk = (keyword, text) => pngChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1'));
const zChunk = (keyword, value) => pngChunk('zTXt', Buffer.concat([Buffer.from(`${keyword}\0\0`, 'latin1'), zlib.deflateSync(Buffer.from(cardB64(value)))]));

/** Every chunk in a PNG, and whether its CRC is right. */
function readChunks(arrayBuffer) {
    const bytes = Buffer.from(arrayBuffer);
    const chunks = [];
    for (let at = 8; at < bytes.length;) {
        const length = bytes.readUInt32BE(at);
        const data = bytes.subarray(at + 8, at + 8 + length);
        chunks.push({ type: bytes.toString('latin1', at + 4, at + 8), data, crcOk: bytes.readUInt32BE(at + 8 + length) === zlib.crc32(bytes.subarray(at + 4, at + 8 + length)) });
        at += 12 + length;
    }
    return chunks;
}

test('Character cards: written as a tEXt chunk SillyTavern can read, with any card already in the image taken out', async () => {
    const IE = cardService();
    const old = tinyPng([textChunk('ccv3', cardB64({ data: { name: 'Stale V3' } })), textChunk('Software', 'Paint'), zChunk('chara', { data: { name: 'Stale' } })]);
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Kael', description: 'Grey at the temples, café regular — 🗡' } };
    const out = await (await IE._injectDataIntoPng(arrayBufferOf(old), card)).arrayBuffer();
    const chunks = readChunks(out);
    assert.ok(chunks.every(c => c.crcOk), 'every chunk checks out');
    deepEq(chunks.map(c => c.type), ['IHDR', 'IDAT', 'tEXt', 'tEXt', 'IEND'], 'the old cards are gone, other text stays, the card sits before IEND');
    assert.equal(chunks[2].data.toString('latin1'), 'Software\0Paint');
    const [keyword, text] = chunks[3].data.toString('latin1').split('\0');
    assert.equal(keyword, 'chara');
    deepEq(JSON.parse(Buffer.from(text, 'base64').toString('utf8')), card, 'base64 of the JSON, accents and emoji intact');
    deepEq(JSON.parse(IE._b64_to_utf8(await IE._extractV2Data(out))), card, 'and Rolecraft reads it back');
});

test('Character cards: a V3 card is read before a V2 one, from tEXt, zTXt or iTXt chunks', async () => {
    const IE = cardService();
    const nameIn = async png => JSON.parse(IE._b64_to_utf8(await IE._extractV2Data(arrayBufferOf(png)))).data.name;
    const v2 = zChunk('chara', { data: { name: 'From V2' } });
    const v3 = pngChunk('iTXt', Buffer.concat([Buffer.from('ccv3\0', 'latin1'), Buffer.from([1, 0, 0, 0]),
        zlib.deflateSync(Buffer.from(cardB64({ spec: 'chara_card_v3', data: { name: 'From V3' } })))]));
    assert.equal(await nameIn(tinyPng([v2, v3])), 'From V3', 'ccv3 wins, as it does in SillyTavern');
    assert.equal(await nameIn(tinyPng([v2])), 'From V2');
    const plain = pngChunk('iTXt', Buffer.concat([Buffer.from('Chara\0', 'latin1'), Buffer.from([0, 0]), Buffer.from('en\0\0', 'latin1'),
        Buffer.from(cardB64({ data: { name: 'Uncompressed' } }))]));
    assert.equal(await nameIn(tinyPng([plain])), 'Uncompressed', 'any case of the keyword, with a language tag');
    assert.equal(await IE._extractV2Data(arrayBufferOf(tinyPng([textChunk('Software', 'Paint')]))), null);
});

test('Character cards: an image counts as a PNG by its bytes, not its name, so a JPEG called .png is converted first', async () => {
    const IE = cardService();
    assert.equal(await IE._isPngBlob(new Blob([tinyPng()], { type: 'image/png' })), true);
    const jpegNamedPng = new Blob([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])], { type: 'image/png' });
    assert.equal(await IE._isPngBlob(jpegNamedPng), false, 'the demo portraits are JPEGs named .png');
    assert.equal(await IE._isPngBlob(new Blob([])), false);
});

/** A story whose one character, Kael, was built in the Workshop. */
function workshopStory(ws) {
    const kael = { id: 'ch1', name: 'Kael', description: WorkshopStore.compile(WorkshopStore.active(ws).state), model_instructions: 'Write as {character}.', tags: ['ranger'], workshop: ws };
    const story = { name: 'Kael', characters: [{ id: 'u1', name: 'You', is_user: true }, kael], scenarios: [{ message: 'Rain on the roof.' }], dynamic_entries: [] };
    const narrative = {
        active_character_ids: ['u1', 'ch1'],
        state: { chat_history: [{ character_id: 'ch1', content: 'Rain on the roof.', type: 'chat' }], static_entries: [{ title: 'The inn', content: 'A warm inn.' }], worldMap: { grid: [] } }
    };
    return { story, narrative };
}

test("Character cards: a Workshop character's card shows the version picked, and importing it brings the whole Workshop back", async () => {
    const IE = cardService();
    const ws = cardWorkshop();
    const { story, narrative } = workshopStory(ws);

    const now = IE._convertEllipsistoV2(story, narrative, 'ch1');
    assert.equal(now.data.description, '## Appearance & body\nTall.\n\n## Personality\nGuarded.', 'the sections under their headings');
    assert.equal(now.data.personality, '', 'personality stays empty: the sections cover it');
    assert.equal(now.data.scenario, 'A storm traps you both.', 'the Scenario section');
    deepEq(now.data.extensions.rolecraft_workshop.workshop, JSON.parse(JSON.stringify(ws)));

    const original = IE._convertEllipsistoV2(story, narrative, 'ch1', 'original');
    assert.equal(original.data.description, 'Old card text.');
    assert.equal(original.data.scenario, '[The inn]\nA warm inn.', "with no Scenario section of its own, the story's scenario");
    assert.equal(IE._convertEllipsistoV2(story, narrative, 'ch1', 'v_soft').data.description, '## Appearance & body\nTall.\n\n## Personality\nGentle.');
    assert.equal(IE._convertEllipsistoV2(story, narrative, 'ch1', 'c0').data.description, '## Appearance & body\nTall.');
    assert.throws(() => IE._convertEllipsistoV2(story, narrative, 'ch1', 'c_gone'), /no longer in its Workshop/);

    const roundTrip = async v2 => {
        const png = await (await IE._injectDataIntoPng(arrayBufferOf(tinyPng()), v2)).arrayBuffer();
        return IE._convertV2toEllipsis(JSON.parse(IE._b64_to_utf8(await IE._extractV2Data(png))).data);
    };
    const back = await roundTrip(now);
    const kael = back.characters.find(c => !c.is_user);
    deepEq(kael.workshop, JSON.parse(JSON.stringify(ws)), 'every variant and step comes back');
    assert.equal(kael.description, story.characters[1].description, 'and replies read the same description');
    deepEq(back.scenarios[0].static_entries, [], 'its Scenario section stays in the Workshop, out of replies');

    const fromOriginal = await roundTrip(original);
    deepEq(fromOriginal.characters.find(c => !c.is_user).workshop, JSON.parse(JSON.stringify(ws)), 'a card showing the original still brings the Workshop back as it was');
    assert.equal(fromOriginal.scenarios[0].static_entries[0].content, '[The inn]\nA warm inn.', "the story's own scenario comes in as before");

    const edited = JSON.parse(JSON.stringify(now));
    edited.data.description = edited.data.description.replace('Guarded.', 'Guarded, then kind.');
    const changed = (await roundTrip(edited)).characters.find(c => !c.is_user);
    assert.equal(changed.workshop.commits.at(-1).summary, 'Changed outside Rolecraft');
    assert.match(changed.description, /## Personality\nGuarded, then kind\./, 'a change made in another app wins');

    const plainKael = { ...story.characters[1], description: 'Plain.' };
    delete plainKael.workshop;
    const plain = IE._convertEllipsistoV2({ ...story, characters: [story.characters[0], plainKael] }, narrative, 'ch1');
    deepEq(plain.data.extensions, {}, 'a character never opened in the Workshop carries nothing extra');
    assert.equal(plain.data.description, 'Plain.');
});

test('Workshop screen: the Card tab exports the version picked, and the history exports any earlier point', async () => {
    const p = workshopAiPage([]);
    p.view().ws = cardWorkshop();
    p.WC.renderCard();
    const card = () => p.elements['ws-card'].innerHTML;
    assert.match(card(), /<option value="current" selected>As it is now \(Main\)<\/option>/);
    assert.ok(card().includes('<option value="original">The original card</option>'));
    assert.ok(card().includes('<option value="v_soft">Variant: Softer</option>'), 'every other variant');
    assert.ok(card().includes('data-action="workshop-export"'));

    p.act('workshop-export-pick', {}, 'v_soft');
    p.WC.renderCard();
    assert.ok(card().includes('<option value="v_soft" selected>'), 'the pick is kept when the card is drawn again');
    p.act('workshop-export', {});
    p.act('workshop-export', { pick: 'c1' });
    await settle();
    deepEq(p.cards, [['ch1', 'v_soft', 'Test - Softer'], ['ch1', 'c1', 'Test - Guarded']], 'the file is named after the version it shows');
    assert.equal(p.WC._exportName('current'), 'Test');
    assert.equal(p.WC._exportName('original'), 'Test - original');

    p.act('workshop-history-open');
    p.act('workshop-commit-toggle', { commit: 'c0' });
    assert.ok(p.elements['ws-history-body'].innerHTML.includes('data-action="workshop-export" data-pick="c0"'), 'an earlier point can be exported from the history');

    p.view().ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    p.WC.renderCard();
    assert.ok(!card().includes('The original card'), 'a character that started blank has no original card to offer');
});

test('Character cards: a card saved as JSON (V1, V2 or V3) imports like a PNG card; a Rolecraft story still imports as a story', async () => {
    const IE = cardService();
    deepEq(IE._cardFromJSON({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Nikki' } }), { name: 'Nikki' });
    deepEq(IE._cardFromJSON({ spec: 'chara_card_v2', data: { name: 'Kael' } }), { name: 'Kael' });
    deepEq(IE._cardFromJSON({ name: 'Old', description: 'A V1 card.' }), { name: 'Old', description: 'A V1 card.' });
    assert.equal(IE._cardFromJSON({ id: 's1', name: 'A story', description: 'x', characters: [] }), null);
    assert.equal(IE._cardFromJSON({ name: 'No card fields' }), null);
    const file = { text: async () => JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Nikki', description: '{{char}} fixes bikes.', first_mes: 'Hey.' } }) };
    const nikki = (await IE._parseEllipsisJSON(file)).story.characters.find(c => !c.is_user);
    assert.equal(nikki.name, 'Nikki');
    assert.equal(nikki.description, 'Nikki fixes bikes.');
});

// ─── Bringing Cardcraft's cards over ──────────────────────────────────────────

test('WorkshopStore: a Workshop starts from a card description, keeping every word, and can carry a concept', () => {
    const description = 'Loose intro.\n\n## Appearance\nTall.';
    const ws = WorkshopStore.fromDescription(description, { concept: 'A medic on nights.', summary: 'Brought over from Cardcraft', now: 1, commitId: 'c0' });
    const state = WorkshopStore.active(ws).state;
    assert.equal(state.concept, 'A medic on nights.');
    assert.equal(state.unsorted, 'Loose intro.');
    assert.equal(state.sections.find(s => s.id === 'appearance').text, 'Tall.');
    deepEq([ws.commits[0].origin, ws.commits[0].summary], ['card', 'Brought over from Cardcraft']);
    deepEq(ws.original, { description, scenario: '' });
    assert.equal(WorkshopStore.fromDescription('Some text.').commits[0].summary, 'Taken from the card');
    assert.equal(WorkshopStore.fromDescription('').commits[0].summary, 'Started');
});

/**
 * Cardcraft's IndexedDB as Rolecraft sees it. With rows null, Cardcraft was never used on this
 * device: opening its database would create an empty one unless the upgrade is stopped.
 */
function fakeCardcraftDB(rows) {
    const created = [];
    return {
        created,
        open(name) {
            const request = {};
            setTimeout(() => {
                if (rows === null) {
                    let stopped = false;
                    request.transaction = { abort: () => { stopped = true; } };
                    request.onupgradeneeded();
                    if (!stopped) created.push(name);
                    request.onerror({ preventDefault() { } });
                    return;
                }
                request.result = {
                    objectStoreNames: { contains: store => store === 'cards' },
                    transaction: () => ({
                        objectStore: () => ({
                            getAll() {
                                const read = {};
                                setTimeout(() => { read.result = rows; read.onsuccess(); });
                                return read;
                            }
                        })
                    }),
                    close() { }
                };
                request.onsuccess();
            });
            return request;
        }
    };
}

/** CardcraftMove on a page that is never drawn, with Cardcraft's database standing in. */
function cardcraftPage(rows, moved = {}) {
    const elements = {};
    const byId = id => elements[id] || (elements[id] = { innerHTML: '' });
    const db = fakeCardcraftDB(rows);
    const storage = { 'rolecraft-cardcraft-moved': JSON.stringify(moved) };
    const saved = [];
    const notices = [];
    const closed = [];
    const urls = { made: 0, revoked: 0 };
    const source = ['js/core/dom.js', 'js/controllers/cardcraft-move.js'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const CM = vm.runInNewContext(source + '\nCardcraftMove', {
        indexedDB: db, ImportExportService: cardService(), WorkshopStore, Blob, setTimeout, console: { error() { } },
        ImageProcessor: { processImageAsBlob: async blob => ({ portraitBytes: blob.size }) },
        localStorage: { getItem: key => (key in storage ? storage[key] : null), setItem: (key, value) => { storage[key] = value; } },
        LibraryController: {
            async addImportedStory(story, image) {
                if (story.characters.some(c => c.name === 'Broken')) throw new Error('disk full');
                saved.push({ story, image });
            }
        },
        StateManager: { updateTagCache() { }, saveLibrary() { } },
        UIManager: { showNotification: (text, type) => notices.push([text, type]), showLoadingSpinner() { }, hideLoadingSpinner() { }, renderLibraryInterface() { }, renderIOHubModal() { } },
        AppController: { closeModal: id => closed.push(id) },
        URL: { createObjectURL: () => `blob:thumb-${++urls.made}`, revokeObjectURL: () => { urls.revoked++; } },
        document: { getElementById: byId, querySelectorAll: () => [] }
    });
    return { CM, db, storage, saved, notices, closed, urls, content: () => byId('io-hub-modal-content').innerHTML };
}

test("Cardcraft move: finds Cardcraft's cards on this device, newest first, and never creates its database by looking", async () => {
    const none = cardcraftPage(null);
    deepEq(await none.CM.findCards(), []);
    deepEq(none.db.created, [], 'a device that never had Cardcraft gets no empty Cardcraft database');

    const page = cardcraftPage([{ id: 'a', updated: 1, data: { name: 'Old' } }, { id: 'b', updated: 5, data: { name: 'New' } }, { id: 'c', updated: 9 }]);
    deepEq((await page.CM.findCards()).map(r => r.id), ['b', 'a'], 'newest first, and a row with no card data is skipped');
});

test("Cardcraft move: a card becomes a story with Cardcraft's edits, its portrait, and its concept in the Workshop", async () => {
    const { CM } = cardcraftPage([]);
    const row = {
        id: 'n1', updated: 5, concept: 'A mechanic who trusts no one.', png: new Uint8Array(tinyPng()),
        data: { name: 'Nikki', description: '## Appearance\nBuilt thick.\n\n## Personality\nGuarded.', first_mes: 'Hey.' }
    };
    const { story, imageBlob } = await CM.toStory(row);
    const nikki = story.characters.find(c => !c.is_user);
    assert.equal(nikki.name, 'Nikki');
    assert.equal(WorkshopStore.active(nikki.workshop).state.concept, 'A mechanic who trusts no one.', 'the concept goes into the Workshop');
    assert.equal(nikki.workshop.commits[0].summary, 'Brought over from Cardcraft');
    assert.equal(nikki.description, '## Appearance & body\nBuilt thick.\n\n## Personality\nGuarded.', 'replies read what the Workshop builds');
    deepEq(imageBlob, { portraitBytes: tinyPng().length }, 'the portrait, through the same processing as any import');

    const plain = (await CM.toStory({ id: 'p1', data: { name: 'Kael', description: '{{char}} keeps watch.' } })).story.characters.find(c => !c.is_user);
    assert.equal(plain.workshop, undefined, 'without a concept, the Workshop starts from the card when first opened, as for any character');
    assert.equal(plain.description, 'Kael keeps watch.');
});

test('Cardcraft move: the ticked cards come over, the ones already moved start unticked, and a failure is named', async () => {
    const rows = [
        { id: 'a', updated: 9, data: { name: 'Nikki <3' }, png: new Uint8Array(tinyPng()) },
        { id: 'b', updated: 5, data: { name: 'Kael' } },
        { id: 'c', updated: 1, data: { name: 'Broken' } }
    ];
    const page = cardcraftPage(rows, { b: 1 });
    await page.CM.open();
    const html = page.content();
    assert.match(html, /value="a" checked>/);
    assert.match(html, /value="b">/, 'one already brought over starts unticked');
    assert.ok(html.includes('already brought over'));
    assert.ok(html.includes('Nikki &lt;3') && !html.includes('Nikki <3'), 'names are shown as text');
    assert.ok(html.includes('src="blob:thumb-1"'), 'a thumbnail of the portrait');
    assert.ok(html.includes('data-action="cardcraft-bring"'));

    await page.CM.bringOver(['a', 'c']);
    deepEq(page.saved.map(s => s.story.characters.find(c => !c.is_user).name), ['Nikki <3']);
    deepEq(Object.keys(JSON.parse(page.storage['rolecraft-cardcraft-moved'])).sort(), ['a', 'b'], 'remembered, so a second run starts it unticked');
    deepEq(page.notices, [['Brought over 1 card from Cardcraft.', 'success'], ['Could not bring over: Broken.', 'error']]);
    deepEq(page.closed, ['io-hub-modal']);
    assert.equal(page.urls.revoked, page.urls.made, 'thumbnails are let go');

    await page.CM.bringOver([]);
    assert.equal(page.notices.at(-1)[0], 'Tick at least one card.');

    const empty = cardcraftPage(null);
    await empty.CM.open();
    assert.match(empty.content(), /No Cardcraft cards on this device/);
});

test("the service worker clears only its own old caches, never another app's at the same address", async () => {
    const deleted = [];
    const listeners = {};
    const context = {
        self: { addEventListener: (type, fn) => { listeners[type] = fn; }, registration: { scope: 'https://macegac.github.io/rolecraft/' } },
        caches: { keys: async () => ['rolecraft-v2', 'rolecraft-v1', 'ellipsis-v3', 'gcs-v5', 'other-app-v1'], delete: async key => { deleted.push(key); return true; } },
        clients: { claim: async () => { } }, URL, fetch: async () => { throw new Error('offline'); }, Response
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'), context);
    let done;
    listeners.activate({ waitUntil: promise => { done = promise; } });
    await done;
    deepEq(deleted.sort(), ['ellipsis-v3', 'rolecraft-v1'], "Cardcraft's and other apps' caches stay");
});

test('Cardcraft move: wired into Library Management', () => {
    const ui = fs.readFileSync(path.join(__dirname, 'js', 'ui', 'ui-manager.js'), 'utf8');
    const hub = ui.slice(ui.indexOf('renderIOHubModal() {'), ui.indexOf('showConfirmationPromise'));
    assert.ok(hub.includes('data-action="cardcraft-open"'), 'next to Import File and Bulk Import');
    const move = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'cardcraft-move.js'), 'utf8');
    for (const action of ['cardcraft-open', 'cardcraft-back', 'cardcraft-bring']) {
        assert.ok(move.includes(`ActionHandler.register('${action}'`), `${action} has a handler`);
    }
    assert.ok(fs.readFileSync(path.join(__dirname, 'js', 'boot.js'), 'utf8').includes('CardcraftMove.registerActions();'));
});

// ─── Openings in the Workshop ────────────────────────────────────────────────

/** A story's two openings: the first with example turns and knowledge of its own, the second plain. */
function openingsStory() {
    return [
        {
            id: 'sc1', name: 'Default Start', message: 'Kael slides a mug across the bar. "On the house, {user}."',
            example_dialogue: [
                { character_id: 'me', content: 'Thanks for the other night.', type: 'chat', isHidden: true },
                { character_id: 'ch1', content: "Don't. You paid your tab.", type: 'chat', isHidden: true }
            ],
            static_entries: [{ title: 'The inn', content: 'A warm inn.' }], active_character_ids: ['me', 'ch1']
        },
        { id: 'sc2', name: 'Storm night', message: 'Rain on the roof.', example_dialogue: [], active_character_ids: ['me', 'ch1'] }
    ];
}

const AT_THE_BAR = { name: 'At the bar', message: `{{char}} doesn't look up. "Coin first, {{user}}."` };
const KAEL = { leadId: 'ch1', leadName: 'Kael', userId: 'me' };

/** A Workshop whose main line changed the first opening and the examples, with a variant from before either. */
function openingsWorkshop(scenarios = openingsStory()) {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    ws = WorkshopStore.keepOriginalOpening(ws, scenarios[0]);
    ws = WorkshopStore.keepOriginalExamples(ws, WorkshopStore.examplesFromTurns(scenarios[0].example_dialogue, 'ch1'));
    ws = WorkshopStore.commit(ws, { ...WorkshopStore.active(ws).state, openings: { sc1: AT_THE_BAR } }, { now: 2, commitId: 'c1', summary: 'Edited the opening' });
    ws = WorkshopStore.commit(ws, { ...WorkshopStore.active(ws).state, examples: "{{user}}: Thanks.\n{{char}}: Don't. You paid." }, { now: 3, commitId: 'c2', summary: 'Edited the examples' });
    ws = WorkshopStore.branch(ws, 'c0', { name: 'Before', now: 4, variantId: 'v_before' });
    return WorkshopStore.switchVariant(ws, 'v_main');
}

test('WorkshopStore: openings and example dialogue live in each variant, with a history, and a Phase 1 Workshop has none', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    assert.equal(ws.commits[0].changes.length, 14, 'a character with no openings of its own starts as before');
    deepEq(WorkshopStore.active(ws).state.openings, {});
    assert.equal(WorkshopStore.active(ws).state.examples, null, "null: the story's own examples");

    ws = WorkshopStore.commit(ws, { ...WorkshopStore.active(ws).state, openings: { sc1: AT_THE_BAR } }, { now: 2, commitId: 'c1' });
    deepEq(ws.commits.at(-1).changes.map(ch => [ch.section, ch.before, ch.after]), [['_openings', {}, { sc1: AT_THE_BAR }]]);
    ws = WorkshopStore.commit(ws, { ...WorkshopStore.active(ws).state, examples: '{{user}}: Hi.\n{{char}}: Hello.' }, { now: 3, commitId: 'c2' });
    deepEq(ws.commits.at(-1).changes.map(ch => [ch.section, ch.before, ch.after]), [['_examples', null, '{{user}}: Hi.\n{{char}}: Hello.']]);

    for (const [id, openings, examples] of [['c0', {}, null], ['c1', { sc1: AT_THE_BAR }, null], ['c2', { sc1: AT_THE_BAR }, '{{user}}: Hi.\n{{char}}: Hello.']]) {
        const state = WorkshopStore.stateAt(ws, id);
        deepEq([state.openings, state.examples], [openings, examples], `${id} rebuilds`);
    }
    deepEq(WorkshopStore.stateAt(ws, 'c2'), JSON.parse(JSON.stringify(WorkshopStore.active(ws).state)), 'the newest point rebuilds exactly');
    deepEq(WorkshopStore.active(WorkshopStore.restore(ws, 'c0', { now: 4, commitId: 'c3' })).state.openings, {}, 'going back takes the openings back too');
    assert.equal(WorkshopStore.active(WorkshopStore.branch(ws, 'c1', { now: 5, variantId: 'v2' })).state.examples, null,
        'a variant from an earlier point has the examples as they were then');

    const phase1 = JSON.parse(JSON.stringify(WorkshopStore.create({ now: 1, commitId: 'c0' })));
    delete phase1.variants[0].state.openings;
    delete phase1.variants[0].state.examples;
    const next = WorkshopStore.commit(phase1, withTexts(WorkshopStore.active(phase1).state, { appearance: 'Tall.' }), { now: 2, commitId: 'c1' });
    deepEq(next.commits.at(-1).changes.map(ch => ch.section), ['appearance'], 'a Workshop from before reads as having none, which is not a change');
});

test("WorkshopStore: a story's openings belong to its lead: whoever speaks the first one, or else its first character", () => {
    const cast = [{ id: 'me', is_user: true }, { id: 'nar', is_narrator: true }, { id: 'ch1' }, { id: 'ch2' }];
    assert.equal(WorkshopStore.leadOf(cast, [{ id: 'sc1' }]), 'ch1');
    assert.equal(WorkshopStore.leadOf(cast, [{ id: 'sc1', opening_character_id: 'ch2' }, { id: 'sc2', opening_character_id: 'ch1' }]), 'ch2', 'the first opening decides');
    assert.equal(WorkshopStore.leadOf(cast, [{ id: 'sc1', opening_character_id: 'me' }]), 'ch1', 'never you or the narrator');
    assert.equal(WorkshopStore.leadOf(cast, [{ id: 'sc1', opening_character_id: 'gone' }]), 'ch1');
    assert.equal(WorkshopStore.leadOf(cast, []), 'ch1');
    assert.equal(WorkshopStore.leadOf([{ id: 'me', is_user: true }], [{ id: 'sc1' }]), null);
});

test("WorkshopStore: openings and examples switch between a card's wording and the story's own placeholders", () => {
    assert.equal(WorkshopStore.storyText('{{char}} waves at {{user}}. {{User}}?', 'Kael'), 'Kael waves at {user}. {user}?',
        "the lead's own name, as card import writes it: in a chat {character} means whoever speaks, and a narrator can speak an opening");
    assert.equal(WorkshopStore.storyText('{{char}} waves.'), '{character} waves.', 'with no name to hand, the placeholder');
    assert.equal(WorkshopStore.cardText('{character} waves at {user}.'), '{{char}} waves at {{user}}.');
    assert.equal(WorkshopStore.cardText('{{char}} waves at {{user}}.'), '{{char}} waves at {{user}}.', 'card wording is left as it is');
    const turns = WorkshopStore.turnsFromExamples("{{user}}: Thanks for the other night.\n{{char}}: Don't, {{user}}. You paid your tab.\n*She shrugs.*", 'ch1', 'me', 5, 'Kael');
    assert.equal(WorkshopStore.turnsFromExamples('{{char}}: {{char}} never forgets.', 'ch1', 'me', 5, 'Kael')[0].content, 'Kael never forgets.');
    deepEq(turns.map(t => [t.character_id, t.content, t.isHidden, t.type]),
        [['me', 'Thanks for the other night.', true, 'chat'], ['ch1', "Don't, {user}. You paid your tab.\n*She shrugs.*", true, 'chat']], 'a turn runs until the next speaker');
    assert.equal(WorkshopStore.examplesFromTurns(turns, 'ch1'), "{{user}}: Thanks for the other night.\n{{char}}: Don't, {{user}}. You paid your tab.\n*She shrugs.*");
    assert.equal(WorkshopStore.examplesFromCard('<START>\n{{user}}:\nHi\n{{char}}:\nHello.'), '{{user}}: Hi\n{{char}}: Hello.', "a card's example block, as Rolecraft and other apps write it");
    deepEq(WorkshopStore.turnsFromExamples('  ', 'ch1', 'me'), []);
});

test('WorkshopStore: the story gets each opening as the variant in use has it, and nothing else is touched', () => {
    const scenarios = openingsStory();
    const untouched = JSON.stringify(scenarios);
    assert.equal(WorkshopStore.syncStory(scenarios, WorkshopStore.create({ now: 1, commitId: 'c0' }), KAEL).changed, false,
        'a Workshop that never changed an opening leaves the story alone');

    const ws = openingsWorkshop(scenarios);
    const synced = WorkshopStore.syncStory(scenarios, ws, KAEL);
    assert.equal(synced.changed, true);
    assert.equal(JSON.stringify(scenarios), untouched, 'the openings passed in are left as they were');
    deepEq([synced.scenarios[0].name, synced.scenarios[0].message], ['At the bar', `Kael doesn't look up. "Coin first, {user}."`],
        "in the story's own wording: the lead's name, as card import writes it, and {user}");
    deepEq(synced.scenarios[0].static_entries, scenarios[0].static_entries, "the opening's cast and knowledge stay");
    deepEq(synced.scenarios.map(sc => sc.example_dialogue.map(t => [t.character_id, t.content])),
        [[['me', 'Thanks.'], ['ch1', "Don't. You paid."]], [['me', 'Thanks.'], ['ch1', "Don't. You paid."]]], 'the examples go into every opening, as import does');
    assert.equal(synced.scenarios[1].message, 'Rain on the roof.', 'an opening the Workshop never changed keeps its text');
    assert.equal(WorkshopStore.syncStory(synced.scenarios, ws, KAEL).changed, false, 'once in step, there is nothing to write');

    const before = WorkshopStore.syncStory(synced.scenarios, WorkshopStore.switchVariant(ws, 'v_before'), KAEL);
    deepEq([before.scenarios[0].name, before.scenarios[0].message], ['Default Start', 'Kael slides a mug across the bar. "On the house, {user}."'],
        'a variant from before the change puts the opening back as the story had it');
    deepEq(before.scenarios[0].example_dialogue.map(t => t.content), ['Thanks for the other night.', "Don't. You paid your tab."]);

    deepEq(WorkshopStore.syncStory([scenarios[1]], ws, KAEL).scenarios.map(sc => sc.id), ['sc2'], 'an opening deleted in the Library stays deleted');
});

test('WorkshopStore: a card takes its first message, other greetings and examples from the version picked', () => {
    const scenarios = openingsStory();
    const ws = openingsWorkshop(scenarios);
    const now = WorkshopStore.cardOpenings(ws, 'current', scenarios);
    deepEq(now.ids, ['sc1', 'sc2']);
    deepEq(now.greetings, [AT_THE_BAR.message, 'Rain on the roof.']);
    assert.equal(now.examples, "{{user}}: Thanks.\n{{char}}: Don't. You paid.");
    const original = WorkshopStore.cardOpenings(ws, 'original', scenarios);
    deepEq(original.greetings, ['Kael slides a mug across the bar. "On the house, {{user}}."', 'Rain on the roof.']);
    assert.equal(original.examples, "{{user}}: Thanks for the other night.\n{{char}}: Don't. You paid your tab.");
    assert.equal(WorkshopStore.cardOpenings(ws, 'v_before', scenarios).greetings[0], original.greetings[0], 'a variant');
    assert.equal(WorkshopStore.cardOpenings(ws, 'c1', scenarios).greetings[0], AT_THE_BAR.message, 'a saved point');
    assert.equal(WorkshopStore.cardOpenings(ws, 'c1', scenarios).examples, original.examples, 'with the examples it had then');
    assert.equal(WorkshopStore.cardOpenings(ws, 'nope', scenarios), null);
    assert.equal(WorkshopStore.cardOpenings(WorkshopStore.create({ now: 1, commitId: 'c0' }), 'current', scenarios).examples, null,
        "no examples of its own: the card uses the story's, as before");
});

test('WorkshopStore: a card notes the order of its openings with a fingerprint, and greetings changed in another app come back as a new step', () => {
    const ws = openingsWorkshop();
    const written = { description: 'D', personality: '', scenario: 'S', ownScenario: false, openings: ['sc1', 'sc2'], greetings: ['G1', 'G2'], examples: '{{user}}:\nHi' };
    const carried = WorkshopStore.toCard(ws, 'current', written, 9);
    deepEq(carried.exported, {
        pick: 'current', at: 9, ownScenario: false, check: WorkshopStore.cardCheck('D', '', 'S'),
        openings: ['sc1', 'sc2'], openingsCheck: WorkshopStore.cardCheck('G1', 'G2', '{{user}}:\nHi')
    });
    const card = { description: 'D', personality: '', scenario: 'S', greetings: ['G1', 'G2'], examples: '{{user}}:\nHi' };
    deepEq(WorkshopStore.fromCard(carried, card), JSON.parse(JSON.stringify(ws)), 'untouched: exactly as it was');

    const back = WorkshopStore.fromCard(carried, { ...card, greetings: ['G1, edited elsewhere', 'G2'], examples: '{{user}}: Hi\n{{char}}: Hello.' }, 10);
    assert.equal(back.commits.length, ws.commits.length + 1);
    assert.equal(back.commits.at(-1).summary, 'Changed outside Rolecraft');
    const state = WorkshopStore.active(back).state;
    deepEq(state.openings.sc1, { name: 'At the bar', message: 'G1, edited elsewhere' }, 'the opening keeps its name');
    deepEq(state.openings.sc2, { message: 'G2' });
    assert.equal(state.examples, '{{user}}: Hi\n{{char}}: Hello.');
    deepEq(state.sections, JSON.parse(JSON.stringify(WorkshopStore.active(ws).state.sections)), 'the description was not touched, so neither are the sections');

    const renamed = WorkshopStore.renameOpenings(back, { sc1: 'new-1', sc2: 'new-2' });
    deepEq(Object.keys(WorkshopStore.active(renamed).state.openings).sort(), ['new-1', 'new-2']);
    assert.ok(!JSON.stringify(renamed).includes('"sc1"'), 'every mention moves, the history included');
    deepEq(WorkshopStore.stateAt(renamed, 'c1').openings, { 'new-1': AT_THE_BAR });
});

test('WorkshopStore: the copy of the example dialogue that card import pasted into the instructions can be taken out, leaving the rest', () => {
    const text = "Write the next response for {character}.\n\n### Author's Rules\nStay in character.\n\n### Example Dialogue\n{user}: Hi\nKael: Hello.";
    assert.equal(WorkshopStore.hasExampleCopy(text), true);
    assert.equal(WorkshopStore.withoutExampleCopy(text), "Write the next response for {character}.\n\n### Author's Rules\nStay in character.");
    assert.equal(WorkshopStore.withoutExampleCopy('### Example Dialogue\nA: b\n\n### Later\nKeep.'), '### Later\nKeep.');
    assert.equal(WorkshopStore.hasExampleCopy('No copy here.'), false);
    assert.equal(WorkshopStore.withoutExampleCopy('No copy here.'), 'No copy here.');
});

test('Character cards: example dialogue comes in once, as hidden turns in each opening, not also pasted into the instructions', () => {
    const IE = cardService();
    const story = IE._convertV2toEllipsis({ name: 'Kael', description: 'A ranger.', first_mes: 'Hey.', alternate_greetings: ['Later.'], mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello, {{user}}.' });
    const kael = story.characters.find(c => !c.is_user);
    assert.ok(!kael.model_instructions.includes('Example Dialogue'), 'replies would read it twice: once here, once from the turns');
    deepEq(story.scenarios.map(s => s.example_dialogue.map(t => t.content)), [['Hi', 'Hello, {user}.'], ['Hi', 'Hello, {user}.']]);
    deepEq(story.narratives[0].state.chat_history.filter(m => m.isHidden).map(m => m.content), ['Hi', 'Hello, {user}.']);
});

test("Character cards: the lead's card takes its openings and examples from the Workshop, and importing it lines them up again", async () => {
    const IE = cardService();
    const scenarios = openingsStory();
    const ws = openingsWorkshop(scenarios);
    const kael = { id: 'ch1', name: 'Kael', description: WorkshopStore.compile(WorkshopStore.active(ws).state), model_instructions: 'Write as {character}.', tags: [], workshop: ws };
    const story = { name: 'Kael', characters: [{ id: 'me', name: 'You', is_user: true }, kael], scenarios, dynamic_entries: [] };
    const narrative = { active_character_ids: ['me', 'ch1'], state: { chat_history: [{ character_id: 'ch1', content: 'Something else entirely.', type: 'chat' }], static_entries: [], worldMap: { grid: [] } } };

    const v2 = IE._convertEllipsistoV2(story, narrative, 'ch1');
    assert.equal(v2.data.first_mes, AT_THE_BAR.message, 'the first opening, not whatever the open chat starts with');
    deepEq(v2.data.alternate_greetings, ['Rain on the roof.']);
    assert.equal(v2.data.mes_example, "{{user}}:\nThanks.\n{{char}}:\nDon't. You paid.");
    deepEq(v2.data.extensions.rolecraft_workshop.exported.openings, ['sc1', 'sc2']);
    const original = IE._convertEllipsistoV2(story, narrative, 'ch1', 'original');
    assert.equal(original.data.first_mes, 'Kael slides a mug across the bar. "On the house, {{user}}."');
    assert.equal(original.data.mes_example, "{{user}}:\nThanks for the other night.\n{{char}}:\nDon't. You paid your tab.");

    const png = await (await IE._injectDataIntoPng(arrayBufferOf(tinyPng()), v2)).arrayBuffer();
    const back = IE._convertV2toEllipsis(JSON.parse(IE._b64_to_utf8(await IE._extractV2Data(png))).data);
    const kaelBack = back.characters.find(c => !c.is_user);
    const youBack = back.characters.find(c => c.is_user);
    const ids = back.scenarios.map(s => s.id);
    assert.ok(!ids.includes('sc1'), 'the new story has openings of its own');
    deepEq(Object.keys(WorkshopStore.active(kaelBack.workshop).state.openings), [ids[0]], "the Workshop's openings point at the new story's");
    deepEq([back.scenarios[0].name, back.scenarios[0].message], ['At the bar', `Kael doesn't look up. "Coin first, {user}."`]);
    deepEq(back.scenarios[1].example_dialogue.map(t => [t.character_id, t.content]), [[youBack.id, 'Thanks.'], [kaelBack.id, "Don't. You paid."]]);
    assert.equal(kaelBack.workshop.commits.length, ws.commits.length, 'nothing was changed in another app, so no new step');

    story.scenarios = scenarios.map(sc => ({ ...sc, opening_character_id: 'ch2' }));
    story.characters.push({ id: 'ch2', name: 'Elara', description: 'An elf.' });
    const notLead = IE._convertEllipsistoV2(story, narrative, 'ch1');
    assert.equal(notLead.data.first_mes, 'Something else entirely.', "a character who isn't the lead exports as before");
    assert.equal(notLead.data.extensions.rolecraft_workshop.exported.openings, undefined);
});

test('Character cards: {{user}} already in the text is written as {{user}}, never {{{user}}}', () => {
    const IE = cardService();
    const kael = { id: 'ch1', name: 'Kael', description: 'Owes {{user}} a favour. Waves at {user}.', model_instructions: 'Write as {character} for {{user}}.', tags: [] };
    const story = { name: 'Kael', characters: [{ id: 'me', name: 'You', is_user: true }, kael], scenarios: [{ id: 'sc1', message: 'Hello, {{user}}.' }], dynamic_entries: [] };
    const narrative = { active_character_ids: ['me', 'ch1'], state: { chat_history: [{ character_id: 'ch1', content: 'Hello, {{user}}.', type: 'chat' }], static_entries: [], worldMap: { grid: [] } } };
    const card = IE._convertEllipsistoV2(story, narrative, 'ch1').data;
    assert.equal(card.description, 'Owes {{user}} a favour. Waves at {{user}}.', "the {user} inside {{user}} is not Rolecraft's own placeholder");
    assert.equal(card.first_mes, 'Hello, {{user}}.');
    assert.equal(card.system_prompt, 'Write as {{char}} for {{user}}.');
});

test('WorkshopPrompts: openings and examples are written from the whole character, an opening as the first message of a chat', () => {
    const extras = {
        openings: [{ id: 'sc1', label: 'O1', name: 'At the bar', message: 'Coin first.' }, { id: 'sc2', label: 'O2', name: 'Storm night', message: '' }],
        examples: '{{user}}: Hi\n{{char}}: Hello.'
    };
    const ask = WorkshopPrompts.writeOpening({ name: 'Kael', state: pinnedState(), extras, openingId: 'sc1', reweave: true });
    const sent = ask.messages[1].content;
    assert.match(sent, /OPENINGS/);
    assert.match(sent, /O1 "At the bar":\nCoin first\./);
    assert.match(sent, /EXAMPLE DIALOGUE[^\n]*\n\{\{user\}\}: Hi/);
    assert.match(sent, /TASK: Re-weave the opening "At the bar"/);
    assert.match(sent, /first message of a new roleplay chat/);
    assert.match(sent, /Never write what \{\{user\}\} does/);
    assert.ok(sent.includes('"slow to trust"'), 'the pins are there too');
    deepEq(ask.read({ text: '  A new opening.  ' }), { text: 'A new opening.' });
    assert.throws(() => ask.read({}), /no text/);
    assert.match(WorkshopPrompts.writeOpening({ name: 'Kael', state: pinnedState(), extras, openingId: 'sc2' }).messages[1].content, /TASK: Write the opening "Storm night"/);

    const takes = WorkshopPrompts.openingTakes({ name: 'Kael', state: pinnedState(), extras, openingId: 'sc2', avoid: ['At the docks'], creativity: 5 });
    assert.equal(takes.temperature, 1.3);
    assert.match(takes.messages[1].content, /turned these down before.*- At the docks/s);
    deepEq(takes.read({ takes: [{ angle: 'In the rain', text: 'One.' }, { text: 'Two.' }] }).map(t => [t.angle, t.text]), [['In the rain', 'One.'], ['A different take', 'Two.']]);

    const examples = WorkshopPrompts.writeExamples({ name: 'Kael', state: pinnedState(), extras, reweave: true });
    assert.match(examples.messages[1].content, /TASK: Re-weave the example dialogue/);
    deepEq(examples.read({ text: '{{user}}: Hi\n{{char}}: Hello.' }), { text: '{{user}}: Hi\n{{char}}: Hello.' });
    assert.throws(() => examples.read({ text: 'No one speaks here.' }), /dialogue/);

    assert.match(WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'personality', extras }).messages[1].content, /OPENINGS/,
        'sections are written knowing the openings');
    assert.ok(!WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'personality' }).messages[1].content.includes('OPENINGS'),
        "and a character without them doesn't get the heading");
});

/** The Workshop on screen for Kael, the lead of a story with two openings, kept in a stand-in database. */
function openingsPage(answers = [], { lead = true } = {}) {
    const events = [];
    const notices = [];
    const calls = [];
    const handlers = {};
    const elements = {};
    const element = () => ({
        innerHTML: '', outerHTML: '', value: '', textContent: '', style: {}, dataset: {},
        classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
        querySelector: () => null, querySelectorAll: () => [], contains: () => false, focus() { }, setAttribute() { }, addEventListener() { }
    });
    const byId = id => elements[id] || (elements[id] = element());
    const characters = [
        { id: 'me', name: 'You', is_user: true },
        { id: 'ch1', name: 'Kael', description: '', model_instructions: "Write as {character}.\n\n### Example Dialogue\n{user}: Thanks.\nKael: Don't." },
        { id: 'ch2', name: 'Elara', description: '' }
    ];
    const scenarios = openingsStory().map(sc => (lead ? sc : { ...sc, opening_character_id: 'ch2' }));
    let saved = { id: 's1', name: 'Kael', characters, scenarios };
    const library = { active_story_id: 's1', stories: [JSON.parse(JSON.stringify(saved))] };
    const chat = [...scenarios[0].example_dialogue, { character_id: 'ch1', content: 'Hello again.', type: 'chat' }];
    const store = {
        state: { characters, evolved_characters: {}, chat_history: JSON.parse(JSON.stringify(chat)) },
        _isSaving: false,
        _isSavingPaused: false,
        async forceSave() { events.push('save'); },
        pauseSaving() { this._isSavingPaused = true; events.push('pause'); },
        resumeSaving() { this._isSavingPaused = false; events.push('resume'); }
    };
    const DBService = {
        async getStory(id) { return id === saved.id ? JSON.parse(JSON.stringify(saved)) : null; },
        async saveStory(story) { events.push('story'); saved = JSON.parse(JSON.stringify(story)); }
    };
    const WorkshopAI = {
        async chat(opts) {
            calls.push(opts);
            const next = answers.shift();
            if (next instanceof Error) throw next;
            return { text: JSON.stringify(next), thinking: '', finishReason: 'stop', provider: 'Test', data: next, attempts: 1 };
        }
    };
    const source = ['js/core/dom.js', 'js/services/workshop-store.js', 'js/util/workshop-prompts.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', {
        document: { getElementById: byId, querySelector: element, querySelectorAll: () => [], activeElement: null },
        ReactiveStore: store, WorkshopAI, AbortController, setTimeout, UTILITY, DBService,
        StateManager: { getLibrary: () => library },
        UIManager: { showNotification: (text, type) => notices.push([text, type]) },
        ActionHandler: { register: (name, fn) => { handlers[name] = fn; } }, window: { addEventListener() { } }, debounce: fn => fn,
        LibraryController: { async exportCharacterCard() { } }
    });
    WC.registerActions();
    WC.RUNTIME.view = { charId: 'ch1', ws: WorkshopStore.create({ now: 1, commitId: 'c0' }), tab: 'sections', editing: null, addingPin: null };
    return {
        WC, events, notices, calls, characters, library, store, elements, el: byId,
        act: (name, dataset = {}, value) => handlers[name](dataset, value),
        view: () => WC.RUNTIME.view,
        saved: () => saved,
        openings: () => {
            WC.renderOpenings();
            return byId('ws-openings-wrap').innerHTML;
        }
    };
}

test("Openings in the Workshop: only the lead's Workshop shows them, and editing one by hand is a step the story follows", async () => {
    assert.equal(openingsPage([], { lead: false }).openings(), '', "a character who isn't the story's lead has no Openings card");

    const p = openingsPage();
    const html = p.openings();
    assert.match(html, /Openings/);
    assert.ok(html.indexOf('Default Start') < html.indexOf('Storm night'), "every opening, in the story's order");
    assert.ok(html.includes('Kael slides a mug across the bar. &quot;On the house, {{user}}.&quot;'), 'shown in card wording');
    assert.ok(html.includes('{{user}}: Thanks for the other night.'), 'and the example dialogue');
    assert.match(html, /Remove the copy/, "the copy in Kael's instructions can be taken out");

    await p.WC._fieldDone({ dataset: { wsField: 'opening', opening: 'sc1' }, value: AT_THE_BAR.message, classList: { contains: () => false } });
    await settle();
    assert.equal(p.view().ws.commits.at(-1).summary, 'Edited the opening "Default Start"');
    deepEq(WorkshopStore.active(p.view().ws).state.openings.sc1, { name: 'Default Start', message: AT_THE_BAR.message });
    deepEq(p.view().ws.original.openings.sc1, { name: 'Default Start', message: 'Kael slides a mug across the bar. "On the house, {{user}}."' },
        "the story's text from before is kept, for The original card");
    assert.equal(p.saved().scenarios[0].message, `Kael doesn't look up. "Coin first, {user}."`, 'the story has it');
    assert.equal(p.library.stories[0].scenarios[0].message, p.saved().scenarios[0].message, "and so does the Library's copy");
    deepEq(p.saved().scenarios[0].static_entries, openingsStory()[0].static_entries);
    deepEq(p.events.slice(-3), ['pause', 'story', 'resume'], 'autosave waits while the story is written');

    await p.WC._fieldDone({ dataset: { wsField: 'opening-name', opening: 'sc1' }, value: 'At the bar', classList: { contains: () => false } });
    await settle();
    assert.equal(p.saved().scenarios[0].name, 'At the bar', 'renamed too');

    p.WC.renderCard();
    const card = p.elements['ws-card'].innerHTML;
    assert.ok(card.includes('First message') && card.includes('Coin first, {{user}}.'), "the Card tab shows the card's first message");
    assert.ok(card.includes('Alternate greetings') && card.includes('Rain on the roof.'));
    assert.ok(card.includes('Example dialogue'));
});

test('Openings in the Workshop: written and taken with the AI from the whole character, and a take can become a new opening', async () => {
    const p = openingsPage([
        { text: AT_THE_BAR.message },
        { takes: [{ angle: 'At the docks', text: '{{char}} waits at the docks.' }, { angle: 'In the rain', text: 'Rain. {{char}} at the door.' }, { angle: 'At dawn', text: 'Dawn.' }] }
    ]);
    await p.WC._ask('opening-reweave', null, null, 'sc1');
    const sent = p.calls[0].messages[1].content;
    assert.match(sent, /OPENINGS/);
    assert.match(sent, /TASK: Re-weave the opening "Default Start"/);
    const pending = p.view().ws.pending['o:sc1'];
    deepEq([pending.kind, pending.mode, pending.text], ['opening', 'reweave', AT_THE_BAR.message]);
    assert.equal(p.view().ws.commits.length, 1, 'nothing changed yet');
    p.act('workshop-opening-accept', { opening: 'sc1' });
    await settle();
    assert.equal(p.view().ws.commits.at(-1).summary, 'Re-wove the opening "Default Start" with the AI');
    assert.equal(p.saved().scenarios[0].message, `Kael doesn't look up. "Coin first, {user}."`);
    assert.equal(p.view().ws.pending['o:sc1'], undefined);

    await p.WC._ask('opening-takes', null, 4, 'sc2');
    assert.equal(p.calls[1].temperature, 1.15);
    await p.act('workshop-opening-take-new', { opening: 'sc2', index: '1' });
    await settle();
    const added = p.saved().scenarios[2];
    assert.ok(added, 'a new opening in the story');
    deepEq([added.name, added.message], ['In the rain', 'Rain. Kael at the door.']);
    deepEq(added.active_character_ids, ['me', 'ch1'], "with the first opening's cast");
    assert.equal(p.view().ws.commits.at(-1).summary, 'Added the opening "In the rain"');
    assert.equal(p.view().ws.pending['o:sc2'].takes.length, 2, 'the other takes still wait');
    p.act('workshop-opening-take-reject', { opening: 'sc2', index: '0' });
    await settle();
    deepEq(p.view().ws.avoid['o:sc2'], ['At the docks'], 'and the next takes steer clear of one turned down');
});

test('Openings in the Workshop: example dialogue goes into every opening, can be used in the open chat with Undo, and the copy in the instructions can go', async () => {
    const p = openingsPage([{ text: "{{user}}: Thanks.\n{{char}}: Don't. You paid." }]);
    await p.WC._ask('examples-reweave');
    p.act('workshop-examples-accept');
    await settle();
    assert.equal(p.view().ws.commits.at(-1).summary, 'Re-wove the example dialogue with the AI');
    deepEq(p.saved().scenarios.map(sc => sc.example_dialogue.map(t => [t.character_id, t.content])),
        [[['me', 'Thanks.'], ['ch1', "Don't. You paid."]], [['me', 'Thanks.'], ['ch1', "Don't. You paid."]]]);
    assert.equal(p.view().ws.original.examples, "{{user}}: Thanks for the other night.\n{{char}}: Don't. You paid your tab.");

    p.act('workshop-examples-to-chat');
    deepEq(p.store.state.chat_history.map(m => [m.content, !!m.isHidden]), [['Thanks.', true], ["Don't. You paid.", true], ['Hello again.', false]],
        "the open chat reads the new examples, and its messages stay");
    p.act('workshop-examples-undo');
    deepEq(p.store.state.chat_history.map(m => m.content), ['Thanks for the other night.', "Don't. You paid your tab.", 'Hello again.']);

    p.act('workshop-examples-uncopy');
    assert.equal(p.characters[1].model_instructions, 'Write as {character}.');
    assert.ok(!p.openings().includes('Remove the copy'));
});

test("Openings in the Workshop: switching variants puts that variant's openings into the story", async () => {
    const p = openingsPage();
    p.view().ws = openingsWorkshop(p.saved().scenarios);
    await p.WC._saveWs(p.view());
    assert.equal(p.saved().scenarios[0].name, 'At the bar');
    p.act('workshop-variant-switch', { variant: 'v_before' });
    await settle();
    deepEq([p.saved().scenarios[0].name, p.saved().scenarios[0].message], ['Default Start', 'Kael slides a mug across the bar. "On the house, {user}."']);
});

// ─── The co-writer: its data and what it reads ───────────────────────────────

test('WorkshopStore: the notebook lives in each variant, with a history, and a Phase 1 Workshop has an empty one', () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    assert.equal(ws.commits[0].changes.length, 14, 'a character with an empty notebook starts as before');
    deepEq(WorkshopStore.active(ws).state.notebook, []);

    const state = WorkshopStore.addDecision(WorkshopStore.active(ws).state, { text: '  Slow burn: never warms up in one scene.  ', why: 'Hard to win over.', origin: 'cowriter', now: 2, id: 'n1' });
    deepEq(state.notebook, [{ id: 'n1', text: 'Slow burn: never warms up in one scene.', why: 'Hard to win over.', at: 2, origin: 'cowriter' }]);
    assert.equal(WorkshopStore.addDecision(state, { text: '   ' }), state, 'an empty decision is nothing');
    ws = WorkshopStore.commit(ws, state, { now: 2, commitId: 'c1', origin: 'cowriter', summary: 'A decision' });
    deepEq(ws.commits.at(-1).changes.map(ch => ch.section), ['_notebook']);

    const changed = WorkshopStore.changeDecision(WorkshopStore.active(ws).state, 'n1', { text: ' Slow burn over many scenes. ' }, 3);
    deepEq(changed.notebook[0], { id: 'n1', text: 'Slow burn over many scenes.', why: 'Hard to win over.', at: 3, origin: 'cowriter' });
    ws = WorkshopStore.commit(ws, changed, { now: 3, commitId: 'c2' });
    ws = WorkshopStore.commit(ws, WorkshopStore.removeDecision(WorkshopStore.active(ws).state, 'n1'), { now: 4, commitId: 'c3' });
    deepEq(WorkshopStore.active(ws).state.notebook, []);
    assert.equal(WorkshopStore.stateAt(ws, 'c2').notebook[0].text, 'Slow burn over many scenes.', 'every point rebuilds with its notebook');
    deepEq(WorkshopStore.stateAt(ws, 'c3'), JSON.parse(JSON.stringify(WorkshopStore.active(ws).state)));
    assert.equal(WorkshopStore.active(WorkshopStore.restore(ws, 'c1', { now: 5, commitId: 'c4' })).state.notebook[0].text, 'Slow burn: never warms up in one scene.',
        'going back takes the notebook back too');

    const phase1 = JSON.parse(JSON.stringify(WorkshopStore.create({ now: 1, commitId: 'c0' })));
    delete phase1.variants[0].state.notebook;
    const next = WorkshopStore.commit(phase1, withTexts(WorkshopStore.active(phase1).state, { voice: 'Clipped.' }), { now: 2, commitId: 'c1' });
    deepEq(next.commits.at(-1).changes.map(ch => ch.section), ['voice'], 'no notebook reads as an empty one, which is not a change');
});

test("WorkshopStore: the co-writer's chats and cards live outside the history, ride in exported cards, and a new chat is named by its first message", () => {
    let ws = WorkshopStore.create({ now: 1, commitId: 'c0' });
    deepEq(WorkshopStore.cowriterOf(ws), { open: null, chats: [], cards: {} }, 'none yet');
    ws = WorkshopStore.newChat(ws, { id: 'k1', now: 10 });
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'you', text: 'About Voice: she warms up to {{user}} way too fast, I want her harder to win over.', variant: 'v_main' }, 11);
    let cw = WorkshopStore.cowriterOf(ws);
    assert.equal(cw.open, 'k1');
    assert.equal(cw.chats[0].title, 'She warms up to {{user}} way…', 'named by its first words, without the "About" it started with');
    assert.equal(cw.chats[0].updated, 11);
    assert.ok(cw.chats[0].messages[0].id, 'every message has an id');

    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'cowriter', text: 'Agreed.', model: 'deepseek/deepseek-v4.1-flash', provider: 'Test' }, 12);
    const replyId = WorkshopStore.cowriterOf(ws).chats[0].messages[1].id;
    ws = WorkshopStore.addCards(ws, 'k1', replyId, [{ type: 'pin', action: 'add', section: 'voice', text: 'goes quiet', why: 'A tell.' }], { variant: 'v_main', now: 12 });
    cw = WorkshopStore.cowriterOf(ws);
    const cardId = cw.chats[0].messages[1].cards[0];
    deepEq(cw.cards[cardId], { type: 'pin', action: 'add', section: 'voice', text: 'goes quiet', why: 'A tell.', id: cardId, status: 'waiting', variant: 'v_main', at: 12 });
    ws = WorkshopStore.setCard(ws, cardId, { status: 'used', commit: 'c9' });
    assert.equal(WorkshopStore.cowriterOf(ws).cards[cardId].status, 'used');
    assert.equal(WorkshopStore.setCard(ws, 'nope', { status: 'used' }), ws);
    ws = WorkshopStore.updateMessage(ws, 'k1', replyId, { ask: { question: 'Which?', options: ['A', 'B'], picked: 1 } });
    assert.equal(WorkshopStore.cowriterOf(ws).chats[0].messages[1].ask.picked, 1);
    assert.equal(ws.commits.length, 1, 'talking is not a change to the character');

    ws = WorkshopStore.newChat(ws, { id: 'k2', now: 20 });
    deepEq(WorkshopStore.cowriterOf(ws).chats.map(c => c.id), ['k2', 'k1'], 'newest first, and the new one is open');
    assert.equal(WorkshopStore.cowriterOf(ws).open, 'k2');
    ws = WorkshopStore.renameChat(ws, 'k1', '  Harder to win over  ');
    assert.equal(WorkshopStore.cowriterOf(ws).chats[1].title, 'Harder to win over');
    ws = WorkshopStore.hideChat(ws, 'k2', 30);
    cw = WorkshopStore.cowriterOf(ws);
    assert.equal(cw.open, 'k1', 'hiding the open chat opens the next one');
    assert.equal(cw.chats[0].hiddenAt, 30, 'hidden, not deleted');
    assert.equal(WorkshopStore.openChat(ws, 'k2'), ws, 'a hidden chat does not open');
    ws = WorkshopStore.unhideChat(ws, 'k2');
    assert.equal(WorkshopStore.cowriterOf(ws).chats[0].hiddenAt, undefined);
    assert.equal(WorkshopStore.cowriterOf(WorkshopStore.openChat(ws, 'k2')).open, 'k2');

    deepEq(WorkshopStore.toCard(ws, 'current', { description: '', personality: '', scenario: '' }).workshop.cowriter, JSON.parse(JSON.stringify(ws.cowriter)),
        'chats ride along in an exported card, so moving a character between phone and PC keeps them');
});

test('WorkshopStore: co-writer messages come out one at a time or from one on, and Undo puts them back; a question left newest opens again', () => {
    let ws = WorkshopStore.newChat(WorkshopStore.create({ now: 1, commitId: 'c0' }), { id: 'k1', now: 10 });
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'you', text: 'Slow her down.' }, 11);
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'cowriter', text: 'Agreed.', ask: { question: 'How?', options: ['Patience', 'A promise'], multi: false, picked: 0 } }, 12);
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'you', text: 'Patience' }, 13);
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'cowriter', text: 'Patience it is.' }, 14);
    const before = WorkshopStore.cowriterOf(ws).chats[0].messages;
    const ids = before.map(m => m.id);
    const texts = w => WorkshopStore.cowriterOf(w).chats[0].messages.map(m => m.text);

    deepEq(texts(WorkshopStore.removeMessages(ws, 'k1', ids[3])), ['Slow her down.', 'Agreed.', 'Patience']);
    let cut = WorkshopStore.removeMessages(ws, 'k1', ids[2]);
    deepEq(texts(cut), ['Slow her down.', 'Agreed.', 'Patience it is.'], 'just this one');
    assert.equal(WorkshopStore.cowriterOf(cut).chats[0].messages[1].ask.picked, 0, 'a question with a reply after it stays answered');

    cut = WorkshopStore.removeMessages(ws, 'k1', ids[2], { after: true });
    deepEq(texts(cut), ['Slow her down.', 'Agreed.'], 'this one and everything after it');
    assert.equal(WorkshopStore.cowriterOf(cut).chats[0].messages[1].ask.picked, null, 'the question its answer went with is open again');
    assert.equal(before[1].ask.picked, 0, 'the chat it came from is left as it was');
    assert.equal(WorkshopStore.removeMessages(ws, 'k1', 'nope'), ws, 'an unknown message changes nothing');
    assert.equal(WorkshopStore.removeMessages(ws, 'k9', ids[0]), ws);

    deepEq(WorkshopStore.cowriterOf(WorkshopStore.putMessages(cut, 'k1', before)).chats[0].messages, JSON.parse(JSON.stringify(before)), 'Undo puts them back as they were');
    assert.equal(cut.commits.length, 1, 'none of it changes the character');
});

test('WorkshopStore: a rerolled reply keeps each version, shows the newest, and flips back with nothing carried over between them', () => {
    let ws = WorkshopStore.newChat(WorkshopStore.create({ now: 1, commitId: 'c0' }), { id: 'k1', now: 10 });
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'you', text: 'Go.' }, 11);
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'cowriter', text: 'First.', ask: { question: 'Which?', options: ['A', 'B'], multi: false, picked: null }, model: 'm1', provider: 'P1', variant: 'v_main' }, 12);
    const id = WorkshopStore.cowriterOf(ws).chats[0].messages[1].id;
    ws = WorkshopStore.addVersion(ws, 'k1', id, { text: 'Second.', model: 'm2', provider: 'P2', stopped: true, variant: 'v_main' }, 20);
    let reply = WorkshopStore.cowriterOf(ws).chats[0].messages[1];
    deepEq([reply.id, reply.role, reply.text, reply.model, reply.stopped, 'ask' in reply, reply.shown, reply.versions.length],
        [id, 'cowriter', 'Second.', 'm2', true, false, 1, 2], "the new version shows, and the old one's question doesn't linger");
    assert.equal(WorkshopStore.cowriterOf(ws).chats[0].updated, 20);

    ws = WorkshopStore.showVersion(ws, 'k1', id, 0);
    reply = WorkshopStore.cowriterOf(ws).chats[0].messages[1];
    deepEq([reply.text, reply.model, 'stopped' in reply, reply.ask.question, reply.shown], ['First.', 'm1', false, 'Which?', 0]);
    assert.equal(WorkshopStore.showVersion(ws, 'k1', id, 5), ws, 'no such version');

    ws = WorkshopStore.updateMessage(ws, 'k1', id, { ask: { ...reply.ask, picked: 1 } });
    ws = WorkshopStore.showVersion(WorkshopStore.showVersion(ws, 'k1', id, 1), 'k1', id, 0);
    assert.equal(WorkshopStore.cowriterOf(ws).chats[0].messages[1].ask.picked, 1, 'a change to the version shown stays with it');
});

test('WorkshopStore: a co-writer chat is deleted for good, the next one opens, and Undo puts it back where it was', () => {
    let ws = WorkshopStore.newChat(WorkshopStore.create({ now: 1, commitId: 'c0' }), { id: 'k1', now: 10 });
    ws = WorkshopStore.addMessage(ws, 'k1', { role: 'you', text: 'First.' }, 11);
    ws = WorkshopStore.newChat(ws, { id: 'k2', now: 20 });
    ws = WorkshopStore.addMessage(ws, 'k2', { role: 'you', text: 'Second.' }, 21);
    const gone = WorkshopStore.cowriterOf(ws).chats[0];

    const cut = WorkshopStore.deleteChat(ws, 'k2');
    deepEq(WorkshopStore.cowriterOf(cut).chats.map(c => c.id), ['k1'], 'gone, not hidden');
    assert.equal(WorkshopStore.cowriterOf(cut).open, 'k1', 'the next one opens');
    assert.equal(WorkshopStore.deleteChat(ws, 'nope'), ws, 'an unknown chat changes nothing');
    assert.equal(WorkshopStore.cowriterOf(WorkshopStore.deleteChat(ws, 'k1')).open, 'k2', 'deleting another chat leaves the open one open');

    const back = WorkshopStore.restoreChat(cut, gone, { at: 0, open: true });
    deepEq(WorkshopStore.cowriterOf(back).chats.map(c => c.id), ['k2', 'k1'], 'Undo puts it back in its place');
    assert.equal(WorkshopStore.cowriterOf(back).open, 'k2', 'open again, as it was');
    assert.equal(WorkshopStore.restoreChat(back, gone, { at: 0 }), back, 'one already there is left alone');

    deepEq(WorkshopStore.cowriterOf(WorkshopStore.deleteChat(cut, 'k1')), { open: null, chats: [], cards: {} }, 'deleting the last one leaves none open');
    assert.equal(cut.commits.length, 1, 'none of it changes the character');
});

const CowriterPrompts = vm.runInNewContext(['js/util/workshop-prompts.js', 'js/util/cowriter-prompts.js']
    .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n') + '\nCowriterPrompts', {});

/** pinnedState with a pin on Voice too, and two decisions in the notebook. */
function cowriterState() {
    const state = pinnedState();
    state.sections = state.sections.map(s => (s.id === 'voice' ? { ...s, pins: [{ id: 'pv', text: 'short, dry sentences', state: 'kept' }] } : s));
    state.notebook = [
        { id: 'n1', text: 'She never apologizes outright.', why: 'Her pride is the core of her.', at: 1, origin: 'you' },
        { id: 'n2', text: '{{user}} is a regular.', why: 'The slow burn needs a history.', at: 2, origin: 'cowriter' }
    ];
    return state;
}

const COWRITER_EXTRAS = { openings: [{ id: 'sc1', label: 'O1', name: 'At the bar', message: 'Coin first.' }], examples: '{{user}}: Hi\n{{char}}: Hello.' };

test('WorkshopStore: a co-writer card changes the character it is used on, and one that no longer fits changes nothing', () => {
    const state = cowriterState();
    const sectionOf = (s, id) => s.sections.find(x => x.id === id);
    let next = WorkshopStore.cardInto(state, { type: 'pin', action: 'add', section: 'appearance', text: 'a scar over one eye' }, 5);
    deepEq(sectionOf(next, 'appearance').pins.map(p => [p.text, p.state, p.origin, p.at]), [['a scar over one eye', 'kept', 'cowriter', 5]]);
    next = WorkshopStore.cardInto(state, { type: 'pin', action: 'reword', section: 'personality', pin: 'pa', text: 'slow to trust anyone' });
    assert.equal(sectionOf(next, 'personality').pins[0].text, 'slow to trust anyone');
    next = WorkshopStore.cardInto(state, { type: 'pin', action: 'remove', section: 'personality', pin: 'pb' });
    deepEq(sectionOf(next, 'personality').pins.map(p => p.id), ['pa', 'pc']);
    assert.equal(WorkshopStore.cardInto(state, { type: 'pin', action: 'remove', section: 'personality', pin: 'gone' }), state, 'a pin that is gone');

    const rewrite = {
        type: 'rewrite', section: 'personality', brief: 'Colder.', removePins: ['pb'],
        draft: { text: 'Cold, and slow to trust.', pinMap: { pa: 'slow to trust', pn: 'Cold' }, newPins: [{ id: 'pn', text: 'cold at first' }] }
    };
    const personality = sectionOf(WorkshopStore.cardInto(state, rewrite, 7), 'personality');
    deepEq([personality.text, personality.pins.map(p => p.id), personality.pinMap], ['Cold, and slow to trust.', ['pa', 'pc', 'pn'], { pa: 'slow to trust', pn: 'Cold' }]);
    deepEq([personality.pins[2].state, personality.pins[2].origin], ['kept', 'cowriter'], 'its new pins come in kept');
    assert.equal(WorkshopStore.cardInto(state, { ...rewrite, section: 'voice' }), state, 'a locked section is never rewritten');
    assert.equal(WorkshopStore.cardInto(state, { ...rewrite, draft: null }), state, 'nor one with nothing written yet');

    deepEq(WorkshopStore.cardInto(state, { type: 'opening', opening: 'sc1', draft: { name: 'At the bar', text: 'No free drink.' } }).openings, { sc1: { name: 'At the bar', message: 'No free drink.' } });
    assert.equal(WorkshopStore.cardInto(state, { type: 'examples', draft: { text: '{{char}}: No.' } }).examples, '{{char}}: No.');
    assert.equal(WorkshopStore.cardInto(state, { type: 'notes', text: 'Act 2 at the festival.' }).notes, 'Act 2 at the festival.');
    assert.equal(WorkshopStore.cardInto(state, { type: 'concept', text: 'A medic who trusts no one.' }).concept, 'A medic who trusts no one.');
    deepEq(WorkshopStore.cardInto(state, { type: 'decision', action: 'add', text: 'Slow burn.', why: 'Hard to win over.' }).notebook.map(d => [d.text, d.why, d.origin]).at(-1), ['Slow burn.', 'Hard to win over.', 'cowriter']);
    assert.equal(WorkshopStore.cardInto(state, { type: 'decision', action: 'change', decision: 'n1', text: 'She never says sorry.' }).notebook[0].text, 'She never says sorry.');
    deepEq(WorkshopStore.cardInto(state, { type: 'decision', action: 'remove', decision: 'n2' }).notebook.map(d => d.id), ['n1']);
    assert.equal(WorkshopStore.cardInto(state, { type: 'decision', action: 'remove', decision: 'gone' }), state, 'a decision that is gone');
    assert.equal(sectionOf(state, 'personality').pins.length, 3, 'the state it was given is left as it was');
});

test('CowriterPrompts: pins, openings and decisions get short labels, and the labels in a reply turn back into ids', () => {
    const labels = CowriterPrompts.labels(cowriterState(), COWRITER_EXTRAS);
    deepEq(labels.byLabel.P1, { kind: 'pin', id: 'pa', section: 'personality' });
    deepEq(labels.byLabel.P3, { kind: 'pin', id: 'pc', section: 'personality' }, 'suggested pins have labels too');
    deepEq(labels.byLabel.P4, { kind: 'pin', id: 'pv', section: 'voice' });
    deepEq(labels.byLabel.O1, { kind: 'opening', id: 'sc1' });
    deepEq(labels.byLabel.D2, { kind: 'decision', id: 'n2' });
    assert.equal(labels.pinLabel.pv, 'P4');
    deepEq(labels.sections, JSON.parse(JSON.stringify(WorkshopStore.sectionDefs.map(d => d.id))));
    const reply = CowriterPrompts.readReply('Done.\n<card>{"type":"pin","remove":"p4","why":"Too plain."}</card>', labels);
    deepEq(reply.cards, [{ type: 'pin', action: 'remove', section: 'voice', pin: 'pv', why: 'Too plain.' }], 'whatever the case of the label');
});

test('CowriterPrompts: a reply is its words, its cards and one question; a block it cannot read is kept to show, never dropped', () => {
    const labels = CowriterPrompts.labels(cowriterState(), COWRITER_EXTRAS);
    const quiet = '<card>{"type":"pin","section":"voice","add":"goes quiet instead of saying thank you","why":"A tell."}</card>';
    const text = [
        "Agreed. I'd slow the thaw.",
        '<card>{"type":"rewrite","section":"personality","brief":"Colder.","pins":{"add":["trusts no one at first"],"remove":["P1","P4"]},"why":"Fits."}</card>',
        quiet,
        quiet,
        '<card>{"type":"pin","pin":"P2","text":"hums when lying","why":"Sharper."}</card>',
        '<card>{"type":"opening","opening":"O1","brief":"No free drink.","why":"Too warm."}</card>',
        '<card>{"type":"opening","new":"Storm night","brief":"A quiet start.","why":"Variety."}</card>',
        '<card>{"type":"examples","brief":"Drier.","why":"Matches Voice."}</card>',
        '<card>{"type":"notes","text":"Slow burn. Act 2 at the festival.","why":"Pacing."}</card>',
        '<card>{"type":"decision","add":"Slow burn over many scenes.","why":"Hard to win over."}</card>',
        '<card>{"type":"decision","decision":"D1","text":"She never says sorry.","why":"Shorter."}</card>',
        '<card>{"type":"decision","remove":"D2","why":"Not true any more."}</card>',
        '<card>{"type":"variant","name":"Reckless","why":"Try it."}</card>',
        '<card>```json\n{"type":"concept","text":"A tavern keeper who trusts no one.","why":"Tighter."}\n```</card>',
        '<card>{"type":"spell","why":"?"}</card>',
        '<card>{"type":"pin","remove":"P9"}</card>',
        '<card>{not json}</card>',
        '<ask>{"question":"What gets through to her?","options":["Patience","A promise kept","Patience"]}</ask>',
        '<ask>{"question":"A second one?","options":["Yes","No"]}</ask>',
        'One more thing.',
        '<card>{"type":"pin","section":"voice","add":"cut off mid'
    ].join('\n');
    const reply = CowriterPrompts.readReply(text, labels);
    assert.equal(reply.prose, "Agreed. I'd slow the thaw.\n\nOne more thing.");
    deepEq(reply.cards, [
        { type: 'rewrite', section: 'personality', brief: 'Colder.', addPins: ['trusts no one at first'], removePins: ['pa'], why: 'Fits.' },
        { type: 'pin', action: 'add', section: 'voice', text: 'goes quiet instead of saying thank you', why: 'A tell.' },
        { type: 'pin', action: 'reword', section: 'personality', pin: 'pb', text: 'hums when lying', why: 'Sharper.' },
        { type: 'opening', opening: 'sc1', brief: 'No free drink.', why: 'Too warm.' },
        { type: 'opening', opening: null, name: 'Storm night', brief: 'A quiet start.', why: 'Variety.' },
        { type: 'examples', brief: 'Drier.', why: 'Matches Voice.' },
        { type: 'notes', text: 'Slow burn. Act 2 at the festival.', why: 'Pacing.' },
        { type: 'decision', action: 'add', text: 'Slow burn over many scenes.', why: 'Hard to win over.' },
        { type: 'decision', action: 'change', decision: 'n1', text: 'She never says sorry.', why: 'Shorter.' },
        { type: 'decision', action: 'remove', decision: 'n2', why: 'Not true any more.' },
        { type: 'variant', name: 'Reckless', why: 'Try it.' },
        { type: 'concept', text: 'A tavern keeper who trusts no one.', why: 'Tighter.' }
    ], "a repeated card counts once, and a rewrite only removes its own section's pins");
    deepEq(reply.ask, { question: 'What gets through to her?', options: ['Patience', 'A promise kept'], multi: false });
    deepEq(reply.unreadable.map(u => u.reason), [
        'There is no suggestion type "spell".',
        'There is no pin P9.',
        'It is not JSON.',
        'Only one question at a time.',
        'The reply was cut off before this was finished.'
    ]);
    assert.ok(reply.unreadable.every(u => u.raw.startsWith('<')), 'each with what it said, to show');
    deepEq(CowriterPrompts.readReply('Just talk.', labels), { prose: 'Just talk.', cards: [], ask: null, unreadable: [] });
});

/** A chat where a reply's cards were used, turned down and changed, with a second opinion after it. */
function cowriterChat() {
    return {
        id: 'k1', title: 'Harder to win over', messages: [
            { id: 'm1', role: 'you', text: 'She warms up too fast.' },
            { id: 'm2', role: 'cowriter', text: "Agreed. I'd slow the thaw.", cards: ['card_a', 'card_b', 'card_c'], ask: { question: 'What gets through?', options: ['Patience', 'A promise'], picked: 0 } },
            { id: 'm3', role: 'second', text: 'Give her distrust a cause.' },
            { id: 'm4', role: 'you', text: 'Patience' }
        ]
    };
}

const COWRITER_CARDS = {
    card_a: { id: 'card_a', type: 'rewrite', section: 'relationship', brief: 'Slow the thaw.', status: 'used' },
    card_b: { id: 'card_b', type: 'pin', action: 'add', section: 'voice', text: 'goes quiet', status: 'turned-down' },
    card_c: { id: 'card_c', type: 'opening', opening: 'sc1', brief: 'No free drink.', status: 'used', note: 'keep the coin line' }
};

test('CowriterPrompts: every request reads the whole character, the notebook, the history and what happened in play, in that order, inside its budgets', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ at: Date.UTC(2026, 9, 1 + i), origin: i % 2 ? 'ai' : 'you', summary: `Step ${i + 1}` })).reverse();
    const play = {
        messages: Array.from({ length: 60 }, (_, i) => ({ who: i % 2 ? 'Sam' : 'Kael', text: `${'x'.repeat(990)} ${i + 1}` })),
        timeline: Array.from({ length: 40 }, (_, i) => `Event ${i + 1}`),
        relationships: ['Kael → Sam: wary friends'],
        world: [{ title: 'The inn', content: 'A warm inn.' }, { title: 'The docks', content: 'd'.repeat(7000) }]
    };
    const { messages, labels } = CowriterPrompts.request({
        name: 'Kael', state: cowriterState(), extras: COWRITER_EXTRAS, variants: { active: 'Main', others: ['Reckless'] },
        history, play, chat: cowriterChat(), cards: COWRITER_CARDS, withCards: true
    });
    assert.equal(labels.byLabel.P4.id, 'pv', 'the labels the reply will be read with');
    assert.equal(messages[0].role, 'system');
    const sent = messages[0].content;
    const order = ['You are the co-writer in the Character Workshop', 'VARIANT IN USE: Main (other variants: Reckless)', 'CHARACTER: Kael',
        'NOTEBOOK', 'RECENT HISTORY', 'WHAT HAS HAPPENED IN PLAY'].map(part => sent.indexOf(part));
    assert.ok(order.every(at => at >= 0), 'every part is there');
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), 'the parts that change least come first');

    assert.ok(sent.includes('## Relationship to {{user}} [id: relationship]'), 'sections by the ids cards use');
    assert.ok(sent.includes('Pins: P1 "slow to trust"; P2 "hums when nervous"; P3 "an idea not kept yet" (suggested, not kept yet)'), 'every pin, by its label');
    assert.ok(sent.includes('O1 "At the bar":\nCoin first.'));
    assert.ok(sent.includes('D1. She never apologizes outright. Why: Her pride is the core of her.'));
    assert.ok(sent.includes('- 2026-10-25 · you · Step 25') && sent.includes('Step 6') && !sent.includes('Step 5\n'), 'the last 20 steps, newest first');
    assert.ok(sent.includes('Event 40') && sent.includes('Event 11') && !sent.includes('Event 10\n'), 'the last 30 lines of the timeline');
    assert.ok(sent.includes('Kael → Sam: wary friends'));
    assert.ok(sent.includes('### The inn\nA warm inn.') && sent.includes('(more World Knowledge not shown)'), 'World Knowledge within its budget');
    const shown = (sent.match(/^(Kael|Sam): x+ \d+$/gm) || []);
    assert.ok(shown.length > 0 && shown.length <= 40, `at most 40 messages; got ${shown.length}`);
    assert.ok(shown.join('\n').length <= 24000, 'about 24,000 characters at most');
    assert.ok(shown.at(-1).endsWith(' 60'), 'the newest ones, oldest first');
    assert.match(sent, /\(\d+ earlier messages not shown\)/);
    assert.ok(sent.includes('<suggestion>'), 'the suggestion format, when suggestions are on');

    deepEq(messages.slice(1).map(m => m.role), ['user', 'assistant', 'user']);
    assert.equal(messages[1].content, 'She warms up too fast.');
    const reply = messages[2].content;
    assert.ok(reply.startsWith("Agreed. I'd slow the thaw."));
    assert.ok(reply.includes('rewrite Relationship to {{user}}: Slow the thaw. (used)'), 'what happened to each card reaches the next request');
    assert.ok(reply.includes('new pin on Voice: "goes quiet" (turned down)'));
    assert.ok(reply.includes('rewrite the opening "At the bar": No free drink. (used, after the author asked for: keep the coin line)'));
    assert.ok(reply.includes('You asked: What gets through? (Patience / A promise)'));
    assert.ok(reply.includes('A second opinion from another model: Give her distrust a cause.'));
    assert.equal(messages[3].content, 'Patience');

    const talk = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat: { messages: [{ role: 'you', text: 'Hi.' }] } }).messages[0].content;
    assert.ok(!talk.includes('<suggestion>') && talk.includes('<ask>'), 'with suggestions off, only questions with choices');
    assert.ok(!talk.includes('WHAT HAS HAPPENED IN PLAY'), 'and nothing about play when there is no chat');
    const long = { messages: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'cowriter' : 'you', text: `Turn ${i + 1}` })) };
    const turns = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat: long }).messages.slice(1);
    assert.equal(turns.length, 30, "this chat's last 30 messages");
    assert.equal(turns[0].content, 'Turn 11');
});

test('CowriterPrompts: what happened in play comes from the open chat: its messages by name, its timeline, relationships and World Knowledge', () => {
    const characters = [{ id: 'me', name: 'Sam', is_user: true }, { id: 'ch1', name: 'Kael Ironheart' }, { id: 'ch2', name: 'Elara' }];
    const play = CowriterPrompts.playFrom({
        chat_history: [
            { character_id: 'me', content: 'An example.', type: 'chat', isHidden: true },
            { character_id: 'ch1', content: '<think>Plan it.</think>{character} nods at {user}.', type: 'chat' },
            { character_id: 'me', content: 'Hi, {{char}}.', type: 'chat' },
            { type: 'lore_reveal', content: 'Lore.' },
            { character_id: 'ch2', content: '  ', type: 'chat' }
        ],
        narrative_timeline: ['Arrived at the inn.'],
        relationship_matrix: ['Kael → Sam: wary friends', 'Elara → Sam: rivals', 'kael and elara: old allies'],
        static_entries: [{ title: 'The inn', content: 'A warm inn.' }, { title: 'Empty', content: ' ' }]
    }, { characters, leadId: 'ch1' });
    deepEq(play.messages, [{ who: 'Kael Ironheart', text: 'Kael Ironheart nods at Sam.' }, { who: 'Sam', text: 'Hi, Kael Ironheart.' }],
        'chat messages only, by name, without thinking or placeholders');
    deepEq(play.timeline, ['Arrived at the inn.']);
    deepEq(play.relationships, ['Kael → Sam: wary friends', 'kael and elara: old allies'], "this character's lines, by full or first name");
    deepEq(play.world, [{ title: 'The inn', content: 'A warm inn.' }]);
    assert.equal(CowriterPrompts.playFrom(null, { characters, leadId: 'ch1' }), null);
});

test('CowriterPrompts: a request reads the last 30 messages of its chat, or as many as it is told', () => {
    const chat = { messages: Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'cowriter' : 'you', text: `Message ${i + 1}.` })) };
    const short = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat }).messages;
    deepEq([short.length, short[1].content], [1 + 30, 'Message 91.']);
    const long = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat, turns: 100 }).messages;
    deepEq([long.length, long[1].content], [1 + 100, 'Message 21.']);
    deepEq([CowriterPrompts.LIMITS.turns, CowriterPrompts.LIMITS.turnsOpenRouter], [30, 100]);
});

test("CowriterPrompts: the co-writer checks the card before calling anything done, and its briefs carry what the writer can't see", () => {
    assert.match(CowriterPrompts.JOB, /Before you call anything done, check the character as it is shown below/);
    const sent = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat: { messages: [{ role: 'you', text: 'Put it on the card.' }] }, withCards: true }).messages[0].content;
    assert.ok(sent.includes('The writer sees the character but not this chat, so the brief carries everything it needs from the chat'));
    assert.ok(sent.includes('To put what was agreed in this chat onto the card'));
    const card = { type: 'pin', action: 'add', section: 'voice', text: 'goes quiet', status: 'used', edited: true };
    assert.equal(CowriterPrompts._outcome(card), 'used, after the author changed its words');
});

test('CowriterPrompts: proposed changes are suggestions, never cards, since a card is the finished character card; old <card> blocks still read', () => {
    const sent = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat: { messages: [{ role: 'you', text: 'Hi.' }] }, withCards: true }).messages[0].content;
    assert.ok(sent.includes('call them suggestions'), 'the co-writer is told what to call them');
    assert.ok(!/\bchange cards?\b|\bthe kinds of card\b|\brules for cards\b/i.test(sent), 'and its instructions never call them cards');
    const labels = CowriterPrompts.labels(cowriterState(), COWRITER_EXTRAS);
    const both = CowriterPrompts.readReply('Two.\n<suggestion>{"type":"notes","text":"New notes.","why":"A."}</suggestion>\n<card>{"type":"concept","text":"New concept.","why":"B."}</card>', labels);
    deepEq([both.prose, both.cards.map(c => c.type), both.unreadable], ['Two.', ['notes', 'concept'], []]);
    const cut = CowriterPrompts.readReply('Wait.\n<suggestion>{"type":"notes","te', labels);
    deepEq([cut.prose, cut.unreadable.map(u => u.reason)], ['Wait.', ['The reply was cut off before this was finished.']]);
});

test("CowriterPrompts: the co-writer never says it changed anything, points the author to Use all, and doesn't resend what's still waiting", () => {
    const sent = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat: { messages: [{ role: 'you', text: 'Did you write the intro yet?' }] }, withCards: true }).messages[0].content;
    assert.ok(sent.includes('Your suggestions change nothing until the author uses them. Never say you wrote, added, changed or updated anything; say what you suggested.'));
    assert.ok(sent.includes('After sending suggestions, end with one short line telling the author to tap Use all, or Use it on the ones they want.'));
    assert.ok(sent.includes("When an earlier suggestion for the same change is still waiting (not answered yet), don't send it again: tell the author it's waiting above."));
});

test('CowriterPrompts: back-to-back messages from one side go as one turn, since some backends refuse two in a row', () => {
    const chat = {
        messages: [
            { role: 'you', text: 'First thought.' },
            { role: 'you', text: 'Second thought.' },
            { role: 'cowriter', text: 'One.' },
            { role: 'cowriter', text: 'Two.' },
            { role: 'you', text: 'Third.' }
        ]
    };
    const { messages } = CowriterPrompts.request({ name: 'Kael', state: cowriterState(), chat });
    deepEq(messages.slice(1).map(m => [m.role, m.content]), [['user', 'First thought.\n\nSecond thought.'], ['assistant', 'One.\n\nTwo.'], ['user', 'Third.']]);
});

test("WorkshopPrompts: a steer, the co-writer's brief plus any note of yours, reaches the section writer", () => {
    const ask = WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'personality', reweave: true, steer: 'Slow the thaw. Note: colder.' });
    assert.match(ask.messages[1].content, /What should change: Slow the thaw\. Note: colder\./);
    assert.ok(!WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'personality' }).messages[1].content.includes('What should change'));
});

test("WorkshopPrompts: a co-writer brief rewrites a section, an opening or the examples, keeping what it doesn't touch, or starts a new opening", () => {
    const rewrite = WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'appearance', steer: 'Older, and scarred.' }).messages[1].content;
    assert.match(rewrite, /TASK: Rewrite the "Appearance & body" section as asked below, keeping whatever the request doesn't touch\./);
    assert.match(rewrite, /What should change: Older, and scarred\./);
    const empty = WorkshopPrompts.writeSection({ name: 'Kael', state: pinnedState(), sectionId: 'background', steer: 'A dockside childhood.' }).messages[1].content;
    assert.match(empty, /TASK: Write the "Background" section\./, 'an empty section is written from the brief');
    const extras = { openings: [{ id: 'sc1', label: 'O1', name: 'At the bar', message: 'Coin first.' }], examples: '{{user}}: Hi\n{{char}}: Hello.' };
    const opening = WorkshopPrompts.writeOpening({ name: 'Kael', state: pinnedState(), extras, openingId: 'sc1', steer: 'No free drink.' }).messages[1].content;
    assert.match(opening, /TASK: Rewrite the opening "At the bar" \(O1\) as asked below, keeping whatever the request doesn't touch\./);
    const fresh = WorkshopPrompts.writeOpening({ name: 'Kael', state: pinnedState(), extras, newName: 'Storm night', steer: 'A quiet start.' }).messages[1].content;
    assert.match(fresh, /TASK: Write a new opening, "Storm night": another way a chat with \{\{char\}\} can start\./);
    assert.match(fresh, /What it should be: A quiet start\./);
    const examples = WorkshopPrompts.writeExamples({ name: 'Kael', state: pinnedState(), extras, steer: 'Drier.' }).messages[1].content;
    assert.match(examples, /TASK: Rewrite the example dialogue as asked below, keeping whatever the request doesn't touch\./);
});

/**
 * The Workshop on screen for Kael with the co-writer: openingsPage's story, plus a model that streams
 * plain replies (strings) and answers JSON for the writers (objects). {stop: 'partial'} streams the
 * words, then stops as Stop would.
 */
function cowriterPage(answers = []) {
    const events = [];
    const notices = [];
    const calls = [];
    const streamed = [];
    const handlers = {};
    const elements = {};
    const element = () => ({
        innerHTML: '', outerHTML: '', value: '', textContent: '', style: {}, dataset: {},
        classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
        querySelector: () => null, querySelectorAll: () => [], contains: () => false, focus() { }, setAttribute() { }, addEventListener() { }, setSelectionRange() { }
    });
    const byId = id => elements[id] || (elements[id] = element());
    const characters = [
        { id: 'me', name: 'You', is_user: true },
        { id: 'ch1', name: 'Kael', description: '', model_instructions: 'Write as {character}.' }
    ];
    let saved = { id: 's1', name: 'Kael', characters, scenarios: openingsStory() };
    const library = { active_story_id: 's1', stories: [JSON.parse(JSON.stringify(saved))] };
    const store = {
        state: { characters, evolved_characters: {}, chat_history: [...openingsStory()[0].example_dialogue, { character_id: 'ch1', content: 'Hello again.', type: 'chat' }] },
        _isSaving: false,
        _isSavingPaused: false,
        async forceSave() { events.push('save'); },
        pauseSaving() { this._isSavingPaused = true; },
        resumeSaving() { this._isSavingPaused = false; }
    };
    const DBService = {
        async getStory(id) { return id === saved.id ? JSON.parse(JSON.stringify(saved)) : null; },
        async saveStory(story) { saved = JSON.parse(JSON.stringify(story)); }
    };
    const WorkshopAI = {
        settings: () => ({ backend: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', reasoning: 'medium' }),
        async chat(opts) {
            calls.push(opts);
            const next = answers.shift();
            if (next instanceof Error) throw next;
            if (next && next.stop !== undefined) {
                opts.onDelta({ text: next.stop, thinking: '' });
                streamed.push(byId('ws-cw-stream').textContent);
                const stopped = new Error('stopped');
                stopped.name = 'AbortError';
                throw stopped;
            }
            if (typeof next === 'string') {
                opts.onDelta({ text: '', thinking: 'Hmm.' });
                opts.onDelta({ text: next.slice(0, 7), thinking: 'Hmm.' });
                streamed.push(byId('ws-cw-stream').textContent);
                return { text: next, thinking: 'Hmm.', finishReason: 'stop', provider: 'Test' };
            }
            return { text: JSON.stringify(next), thinking: '', finishReason: 'stop', provider: 'Test', data: next, attempts: 1 };
        }
    };
    const source = ['js/core/dom.js', 'js/services/workshop-store.js', 'js/util/workshop-prompts.js', 'js/util/cowriter-prompts.js', 'js/controllers/workshop.js']
        .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const WC = vm.runInNewContext(source + '\nWorkshopController', {
        document: { getElementById: byId, querySelector: element, querySelectorAll: () => [], activeElement: null, body: element() },
        ReactiveStore: store, WorkshopAI, AbortController, setTimeout, UTILITY, DBService,
        StateManager: { getLibrary: () => library },
        UIManager: { showNotification: (text, type) => notices.push([text, type]) },
        ActionHandler: { register: (name, fn) => { handlers[name] = fn; } }, window: { addEventListener() { }, matchMedia: () => ({ matches: false }) }, debounce: fn => fn,
        LibraryController: { async exportCharacterCard() { } }
    });
    WC.registerActions();
    WC.RUNTIME.view = { charId: 'ch1', ws: WorkshopStore.create({ now: 1, commitId: 'c0' }), tab: 'sections', editing: null, addingPin: null };
    const chat = () => WorkshopStore.cowriterOf(WC.RUNTIME.view.ws).chats.find(c => c.id === WorkshopStore.cowriterOf(WC.RUNTIME.view.ws).open);
    return {
        WC, events, notices, calls, streamed, characters, store, elements, el: byId, ai: WorkshopAI,
        act: (name, dataset = {}, value) => handlers[name](dataset, value),
        view: () => WC.RUNTIME.view,
        chat,
        say: async text => {
            byId('ws-cw-input').value = text;
            await handlers['workshop-cw-send']({});
        },
        log: () => {
            WC.renderCowriter();
            return byId('ws-cw-log').innerHTML;
        },
        head: () => {
            WC.renderCowriter();
            return byId('ws-cw-head').innerHTML;
        },
        sheet: () => byId('ws-cw-sheet-body').innerHTML
    };
}

const ASK_PATIENCE = 'Agreed, she warms up too fast.\n<ask>{"question":"What gets through to her?","options":["Patience","A promise kept"]}</ask>';

test('Co-writer: a message starts a chat named after it, the reply streams in, and its question waits with choices to tap', async () => {
    const p = cowriterPage([ASK_PATIENCE]);
    await p.say('She warms up to {{user}} too fast.');
    const call = p.calls[0];
    assert.ok(!call.json, 'a conversation, not JSON');
    assert.equal(call.messages[0].role, 'system');
    assert.match(call.messages[0].content, /^You are the co-writer in the Character Workshop/);
    assert.ok(call.messages[0].content.includes('CHARACTER: Kael'));
    assert.ok(call.messages[0].content.includes('O1 "Default Start"'), 'the lead reads its openings');
    assert.ok(call.messages[0].content.includes('RECENT MESSAGES (oldest first):\nKael: Hello again.'), 'and what happened in the open chat');
    assert.ok(call.messages[0].content.includes('<suggestion>'), 'it proposes changes as suggestions');
    deepEq(call.messages.slice(1).map(m => [m.role, m.content]), [['user', 'She warms up to {{user}} too fast.']]);
    deepEq(p.streamed, ['Agreed,'], 'the words appear as they arrive');

    const chat = p.chat();
    assert.equal(chat.title, 'She warms up to {{user}} too…');
    const reply = chat.messages[1];
    deepEq([reply.role, reply.text, reply.model, reply.variant], ['cowriter', 'Agreed, she warms up too fast.', 'deepseek/deepseek-v4.1-flash', 'v_main']);
    deepEq(reply.ask, { question: 'What gets through to her?', options: ['Patience', 'A promise kept'], multi: false, picked: null });
    assert.equal(p.el('ws-cw-input').value, '', 'the box is cleared');
    assert.ok(p.characters[1].workshop.cowriter.chats[0].messages.length === 2, 'the chat is saved with the character');
    assert.equal(p.view().ws.commits.length, 1, 'and talking changed nothing in the character');

    const log = p.log();
    assert.ok(log.includes('Agreed, she warms up too fast.'));
    assert.ok(log.includes('What gets through to her?') && log.includes('data-action="workshop-cw-pick"'), 'its question, with choices to tap');
    assert.ok(log.includes('id="ws-cw-other"'), 'and a box for another answer');
    assert.equal(p.view().busy, null);
});

test('Co-writer: tapping a choice answers the question, and typing while a question is open answers it too', async () => {
    const p = cowriterPage([ASK_PATIENCE, 'Patience it is.\n<ask>{"question":"How long?","options":["Weeks","Months"]}</ask>', 'Noted.']);
    await p.say('Help me slow her down.');
    const askId = p.chat().messages[1].id;
    await p.act('workshop-cw-pick', { message: askId, index: '0' });
    assert.equal(p.chat().messages[1].ask.picked, 0);
    deepEq(p.chat().messages.slice(2).map(m => [m.role, m.text]), [['you', 'Patience'], ['cowriter', 'Patience it is.']], 'the choice is sent as your answer');
    await p.act('workshop-cw-pick', { message: askId, index: '1' });
    assert.equal(p.calls.length, 2, 'a question already answered stays answered');

    await p.say("Neither. She just gets tired of fighting it.");
    assert.equal(p.chat().messages[3].ask.picked, 'other', 'typing answers the open question in your own words');
    assert.equal(p.chat().messages[4].text, 'Neither. She just gets tired of fighting it.');
    assert.ok(p.calls[2].messages[2].content.includes('You asked: What gets through to her? (Patience / A promise kept)'), 'the next request knows what it asked');
});

test('Co-writer: Stop keeps what was said so far; a failure shows with Try again, which asks again without a new message', async () => {
    const p = cowriterPage([{ stop: 'Half a thou' }, new Error('Too many requests right now.'), 'Second try.']);
    await p.say('Go.');
    deepEq(p.chat().messages.map(m => [m.role, m.text, !!m.stopped]), [['you', 'Go.', false], ['cowriter', 'Half a thou', true]]);
    deepEq(p.view().errors, {}, 'a stop is not a failure');
    assert.ok(p.log().includes('Stopped'));

    await p.say('Again.');
    assert.equal(p.view().errors._cowriter, 'Too many requests right now.');
    assert.ok(p.log().includes('Too many requests right now.') && p.log().includes('data-action="workshop-cw-retry"'));
    await p.act('workshop-cw-retry');
    deepEq(p.chat().messages.map(m => m.text), ['Go.', 'Half a thou', 'Again.', 'Second try.']);
    assert.equal(p.calls[2].messages.at(-1).content, 'Again.', 'the same question again');
    assert.ok(p.calls[2].messages.some(m => m.content.includes('[The author stopped this reply part way.]')));
});

test('Co-writer: the notebook is edited by hand as steps in the history, and a removed decision can be brought back', async () => {
    const p = cowriterPage([]);
    p.act('workshop-cw-sheet', { sheet: 'notebook' });
    assert.ok(p.sheet().includes('+ Add a decision'));
    p.act('workshop-cw-note-new');
    p.el('ws-cw-note-text').value = '  Slow burn over many scenes. ';
    p.el('ws-cw-note-why').value = 'Hard to win over.';
    await p.act('workshop-cw-note-add');
    let last = p.view().ws.commits.at(-1);
    deepEq([last.summary, last.origin], ['Added to the notebook: "Slow burn over many scenes."', 'you']);
    const entry = WorkshopStore.active(p.view().ws).state.notebook[0];
    deepEq([entry.text, entry.why], ['Slow burn over many scenes.', 'Hard to win over.']);
    assert.ok(p.sheet().includes('Slow burn over many scenes.') && p.sheet().includes('Why: Hard to win over.'));

    p.act('workshop-cw-note-edit', { decision: entry.id });
    p.el('ws-cw-note-text').value = 'Slow burn, never in one scene.';
    p.el('ws-cw-note-why').value = 'Hard to win over.';
    await p.act('workshop-cw-note-save', { decision: entry.id });
    assert.equal(p.view().ws.commits.at(-1).summary, 'Changed a decision: "Slow burn, never in one scene."');

    await p.act('workshop-cw-note-remove', { decision: entry.id });
    deepEq(WorkshopStore.active(p.view().ws).state.notebook, []);
    assert.ok(p.sheet().includes('data-action="workshop-cw-undo"'), 'Undo, instead of asking first');
    await p.act('workshop-cw-undo');
    assert.equal(WorkshopStore.active(p.view().ws).state.notebook[0].text, 'Slow burn, never in one scene.');

    last = p.view().ws.commits.at(-1);
    const shown = p.WC._changeView(p.view().ws.commits.at(-3).changes[0]).toString();
    assert.ok(shown.includes('Notebook') && shown.includes('Slow burn, never in one scene.'), 'the history shows what the notebook gained or lost');
    assert.ok(p.head().includes('Notebook · 1'), 'the count is on the bar');
});

test('Co-writer: chats are listed newest first, renamed, deleted with Undo, and a new chat starts empty, with starters', async () => {
    const p = cowriterPage(['One.', 'Two.']);
    await p.say('The first chat.');
    const first = p.chat().id;
    p.act('workshop-cw-new');
    assert.notEqual(p.chat().id, first);
    const empty = p.log();
    assert.ok(empty.includes('Interview me') && empty.includes('Pitch ideas') && empty.includes('What&#039;s missing?'), 'an empty chat offers the starters');
    await p.say('The second chat.');
    p.act('workshop-cw-sheet', { sheet: 'chats' });
    const list = p.sheet();
    assert.ok(list.indexOf('The second chat.') < list.indexOf('The first chat.'), 'newest first');
    p.act('workshop-cw-open', { chat: first });
    assert.equal(p.chat().id, first);
    assert.equal(p.view().cwSheet, null, 'opening a chat closes the list');
    p.act('workshop-cw-rename', { chat: first }, 'Harder to win over');
    assert.equal(p.chat().title, 'Harder to win over');
    p.act('workshop-cw-sheet', { sheet: 'chats' });
    assert.ok(!p.sheet().includes('data-action="workshop-cw-hide"') && p.sheet().includes('data-action="workshop-cw-delete-chat"'), 'chats are deleted, not hidden');
    await p.act('workshop-cw-delete-chat', { chat: first });
    assert.notEqual(p.chat().id, first, 'deleting the open chat opens the other one');
    assert.ok(!WorkshopStore.cowriterOf(p.view().ws).chats.some(c => c.id === first), 'gone, not kept hidden');
    assert.ok(!p.characters[1].workshop.cowriter.chats.some(c => c.id === first), 'and gone from what is saved');
    assert.ok(p.sheet().includes('Deleted &quot;Harder to win over&quot;.') && p.sheet().includes('data-action="workshop-cw-undo"'), 'with Undo, instead of asking first');
    await p.act('workshop-cw-undo');
    assert.equal(p.chat().id, first, 'Undo brings it back, open again');
    deepEq(WorkshopStore.cowriterOf(p.view().ws).chats.map(c => c.title), ['The second chat.', 'Harder to win over'], 'in its place');
});

test('Co-writer: Talk it over opens it with "About …:" ready; starters send their request, and What happened in play waits for a chat to read', async () => {
    const p = cowriterPage(['Sure.']);
    p.act('workshop-cw-about', { about: 'Personality' });
    assert.equal(p.el('ws-cw-input').value, 'About Personality: ');
    deepEq([p.view().tab, p.view().side], ['cowriter', 'cowriter'], 'the co-writer comes into view, on the phone and on a wide screen');

    p.el('ws-cw-input').value = '';
    assert.ok(!p.log().includes('What happened in play?'), 'nothing to read yet: the open chat has only its opening');
    p.store.state.chat_history.push({ character_id: 'me', content: 'Thanks.', type: 'chat' });
    assert.ok(p.log().includes('What happened in play?'));
    await p.act('workshop-cw-starter', { starter: 'interview' });
    assert.equal(p.calls[0].messages.at(-1).content, 'Interview me about Kael, one question at a time, with choices to tap.');
    assert.equal(p.chat().title, 'Interview me', 'a chat begun with a starter is named after it');

    p.act('workshop-cw-reads');
    const reads = p.log();
    assert.ok(reads.includes('Kael: the concept, the 11 sections and their pins'), 'what it reads, listed at the top of the chat');
    assert.ok(reads.includes('The openings and the example dialogue'));
    assert.ok(reads.includes('The open chat: its last 2 messages'));
    assert.ok(reads.includes('deepseek/deepseek-v4.1-flash'));
    const sections = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    assert.ok((sections.match(/data-action="workshop-cw-about"/g) || []).length >= 3, 'Talk it over on the sections, the openings and the example dialogue');
});

test('Co-writer: on OpenRouter it reads the last 100 messages of a long chat; a local model, with less room, the last 30', async () => {
    const p = cowriterPage(['Noted.', 'Noted again.']);
    let ws = WorkshopStore.newChat(p.view().ws, { id: 'k1', now: 10 });
    for (let i = 0; i < 60; i++) ws = WorkshopStore.addMessage(ws, 'k1', { role: i % 2 ? 'cowriter' : 'you', text: `Answer ${i + 1}.` }, 11 + i);
    p.view().ws = ws;
    p.act('workshop-cw-reads');
    await p.say('Where were we?');
    assert.equal(p.calls[0].messages.length, 1 + 61, 'the whole chat, well inside 100');
    assert.equal(p.calls[0].messages[1].content, 'Answer 1.');
    assert.ok(p.log().includes('This chat, up to its last 100 messages'), 'What it reads says how much');

    p.ai.settings = () => ({ backend: 'koboldcpp', model: '', reasoning: 'medium' });
    await p.say('And now?');
    assert.equal(p.calls[1].messages.length, 1 + 30, 'a local model reads the last 30');
    assert.ok(p.log().includes('This chat, up to its last 30 messages'));
});

test('Co-writer: Reroll asks again from the same point and keeps both replies to flip between; the chat carries on from the one shown', async () => {
    const p = cowriterPage(['First take.', 'Second take.', 'Noted.']);
    await p.say('Slow her down.');
    const id = p.chat().messages[1].id;
    assert.ok(p.log().includes(`data-action="workshop-cw-reroll" data-message="${id}"`), 'the newest reply has Reroll');
    await p.act('workshop-cw-reroll', { message: id });
    deepEq(p.calls[1].messages.slice(1).map(m => [m.role, m.content]), [['user', 'Slow her down.']], 'the same request again, without the reply it replaces');
    const reply = p.chat().messages[1];
    deepEq([p.chat().messages.length, reply.id, reply.text, reply.shown, reply.versions.length], [2, id, 'Second take.', 1, 2]);
    assert.ok(p.log().includes('2/2'), 'which version shows');

    await p.act('workshop-cw-version', { message: id, step: '-1' });
    assert.equal(p.chat().messages[1].text, 'First take.');
    assert.equal(p.characters[1].workshop.cowriter.chats[0].messages[1].text, 'First take.', 'saved');
    await p.say('Go on.');
    assert.equal(p.calls[2].messages[2].content, 'First take.', 'the next request reads the version shown');
    const log = p.log();
    assert.ok(!log.includes(`data-action="workshop-cw-reroll" data-message="${id}"`) && !log.includes(`data-action="workshop-cw-version" data-message="${id}"`),
        'only the newest reply rerolls and flips');
});

test('Co-writer: a reroll stopped part way is kept as a version; one that fails leaves the reply as it was, and Try again rerolls it', async () => {
    const p = cowriterPage(['First take.', { stop: 'Half a ta' }, new Error('Too many requests right now.'), 'Third take.']);
    await p.say('Go.');
    const id = p.chat().messages[1].id;
    await p.act('workshop-cw-reroll', { message: id });
    let reply = p.chat().messages[1];
    deepEq([p.chat().messages.length, reply.text, !!reply.stopped, reply.versions.length], [2, 'Half a ta', true, 2]);
    await p.act('workshop-cw-reroll', { message: id });
    assert.equal(p.view().errors._cowriter, 'Too many requests right now.');
    deepEq([p.chat().messages.length, p.chat().messages[1].text], [2, 'Half a ta'], 'nothing lost');
    await p.act('workshop-cw-retry');
    reply = p.chat().messages[1];
    deepEq([p.chat().messages.length, reply.text, reply.versions.length, reply.shown], [2, 'Third take.', 3, 2], 'Try again rerolls it, rather than adding a reply');
    deepEq(p.calls.map(c => c.messages.length), [2, 2, 2, 2], 'each one asked from the same point');
});

test('Co-writer: Delete takes the newest message out at once, and otherwise asks: just this one, or this and everything after; Undo puts them back', async () => {
    const p = cowriterPage([ASK_PATIENCE, 'Patience it is.', 'Sure.']);
    await p.say('Help me slow her down.');
    await p.act('workshop-cw-pick', { message: p.chat().messages[1].id, index: '0' });
    const ids = p.chat().messages.map(m => m.id);
    const texts = () => p.chat().messages.map(m => m.text);

    await p.act('workshop-cw-delete', { message: ids[3] });
    deepEq(texts(), ['Help me slow her down.', 'Agreed, she warms up too fast.', 'Patience'], 'the newest goes at once');
    let log = p.log();
    assert.ok(log.includes('Deleted a message.') && log.includes('data-action="workshop-cw-log-undo"'), 'with Undo, instead of asking first');
    assert.ok(log.includes('data-action="workshop-cw-retry"'), 'your message, now the newest, can get a reply');
    await p.act('workshop-cw-log-undo');
    assert.equal(p.chat().messages.length, 4);

    await p.act('workshop-cw-delete', { message: ids[1] });
    assert.equal(p.chat().messages.length, 4, 'with messages after it, it asks first');
    log = p.log();
    assert.ok(log.includes('data-action="workshop-cw-delete-one"') && log.includes('This and the 2 after it'));
    await p.act('workshop-cw-delete-cancel');
    assert.ok(!p.log().includes('data-action="workshop-cw-delete-one"'));

    await p.act('workshop-cw-delete', { message: ids[2] });
    await p.act('workshop-cw-delete-one', { message: ids[2] });
    deepEq(texts(), ['Help me slow her down.', 'Agreed, she warms up too fast.', 'Patience it is.'], 'just this one');
    await p.act('workshop-cw-log-undo');

    await p.act('workshop-cw-delete', { message: ids[1] });
    await p.act('workshop-cw-delete-after', { message: ids[1] });
    deepEq(texts(), ['Help me slow her down.'], 'this and everything after');
    assert.ok(p.log().includes('Deleted 3 messages.'));
    await p.act('workshop-cw-retry');
    deepEq(texts(), ['Help me slow her down.', 'Sure.'], 'Get a reply answers it again');
    assert.ok(!p.log().includes('data-action="workshop-cw-log-undo"'), 'Undo goes once the chat moves on');
    assert.equal(p.characters[1].workshop.cowriter.chats[0].messages.length, 2, 'saved');

    p.view().busy = { kind: 'cowriter', controller: new AbortController() };
    await p.act('workshop-cw-delete', { message: ids[0] });
    assert.equal(p.chat().messages.length, 2, 'nothing comes out while the AI is busy');
    assert.equal(p.notices.at(-1)[0], 'Wait for the AI to finish, or stop it, first.');
});

test('Co-writer: Edit takes your message and everything after it out and puts your words in the box; Undo puts them back and empties it', async () => {
    const p = cowriterPage([ASK_PATIENCE, 'Patience it is.', 'A promise, then.']);
    await p.say('Help me slow her down.');
    await p.act('workshop-cw-pick', { message: p.chat().messages[1].id, index: '0' });
    const ids = p.chat().messages.map(m => m.id);
    const log = p.log();
    assert.ok(log.includes(`data-action="workshop-cw-edit" data-message="${ids[2]}"`), 'your messages have Edit');
    assert.ok(!log.includes(`data-action="workshop-cw-edit" data-message="${ids[1]}"`), "the co-writer's don't");

    await p.act('workshop-cw-edit', { message: ids[2] });
    deepEq(p.chat().messages.map(m => m.text), ['Help me slow her down.', 'Agreed, she warms up too fast.']);
    assert.equal(p.chat().messages[1].ask.picked, null, 'the question is open again');
    assert.equal(p.el('ws-cw-input').value, 'Patience');
    assert.ok(p.log().includes('data-action="workshop-cw-log-undo"'));
    await p.act('workshop-cw-log-undo');
    assert.equal(p.chat().messages.length, 4);
    assert.equal(p.el('ws-cw-input').value, '', 'Undo empties the box it filled');

    await p.act('workshop-cw-edit', { message: ids[2] });
    await p.say('A promise kept, and kept again.');
    deepEq(p.chat().messages.map(m => m.text), ['Help me slow her down.', 'Agreed, she warms up too fast.', 'A promise kept, and kept again.', 'A promise, then.']);
    assert.equal(p.chat().messages[1].ask.picked, 'other', 'the new words answer the open question');
    deepEq(p.calls[2].messages.slice(1).map(m => m.role), ['user', 'assistant', 'user'], 'and the co-writer reads the chat as it is now');
});

const CARDS_REPLY = [
    "Here's what I'd change.",
    '<card>{"type":"pin","section":"appearance","add":"a scar over one eye","why":"A history you can see."}</card>',
    '<card>{"type":"rewrite","section":"personality","brief":"Colder at first.","pins":{"add":["cold at first"],"remove":["P2"]},"why":"Fits the slow burn."}</card>',
    '<card>{"type":"notes","text":"Act 2 at the festival.","why":"Pacing."}</card>',
    '<card>{"type":"opening","opening":"O1","brief":"No free drink.","why":"Too warm."}</card>'
].join('\n');

/** cowriterPage with cowriterState's character in its Workshop: pins on Personality, Voice locked, two decisions. */
function cardsPage(answers) {
    const p = cowriterPage(answers);
    p.view().ws = WorkshopStore.create({ state: cowriterState(), now: 1, commitId: 'c0' });
    p.card = id => WorkshopStore.cowriterOf(p.view().ws).cards[id];
    return p;
}

test("Co-writer cards: a reply's cards wait under it, the writer drafts its rewrites and openings from the briefs, and using them is one step", async () => {
    const p = cardsPage([CARDS_REPLY, { text: 'Cold, and slow to trust.', pins: { P1: 'slow to trust', P2: 'Cold' } }, { text: 'Kael waits for the coin.' }, 'Noted.']);
    await p.say('Make her harder to win over.');
    const reply = p.chat().messages[1];
    const ids = reply.cards;
    deepEq(ids.map(id => [p.card(id).type, p.card(id).status, p.card(id).variant]),
        [['pin', 'waiting', 'v_main'], ['rewrite', 'waiting', 'v_main'], ['notes', 'waiting', 'v_main'], ['opening', 'waiting', 'v_main']]);
    assert.equal(p.calls.length, 3, 'right after the reply, the writer drafts the rewrite, then the opening');
    assert.match(p.calls[1].messages[1].content, /What should change: Colder at first\./, "the co-writer's brief steers the writer");
    const draft = p.card(ids[1]).draft;
    deepEq([draft.text, draft.newPins.map(x => x.text), draft.missing, Object.values(draft.pinMap)], ['Cold, and slow to trust.', ['cold at first'], [], ['slow to trust', 'Cold']], 'with the pin check');
    deepEq([p.card(ids[3]).draft.text, p.card(ids[3]).draft.name], ['Kael waits for the coin.', 'Default Start']);
    const log = p.log();
    assert.ok(log.includes('Cold, and slow to trust.') && log.includes('data-action="workshop-card-use"') && log.includes('data-action="workshop-card-all"'));
    assert.ok(log.includes('Use all 4 suggestions'), 'they are suggestions: a card is the finished character card');
    assert.ok(log.includes('Nothing changes until you use them.') && log.split('data-action="workshop-card-all"').length === 3, 'with Use all at the top of the list too, and why it matters');
    assert.equal(p.view().ws.commits.length, 1, 'nothing changes until a card is used');

    await p.act('workshop-card-use', { card: ids[0] });
    let last = p.view().ws.commits.at(-1);
    deepEq([last.origin, last.summary, p.card(ids[0]).status, p.card(ids[0]).commit], ['cowriter', 'Pinned "a scar over one eye" to Appearance & body', 'used', last.id]);
    await p.act('workshop-card-reject', { card: ids[3] });
    assert.equal(p.card(ids[3]).status, 'turned-down');
    await p.act('workshop-card-all', { message: reply.id });
    last = p.view().ws.commits.at(-1);
    deepEq([last.summary, p.view().ws.commits.length], ['Used 2 suggestions from the co-writer', 3], 'Use all is one step for what still waits');
    let state = WorkshopStore.active(p.view().ws).state;
    const personality = state.sections.find(s => s.id === 'personality');
    deepEq([personality.text, personality.pins.map(x => x.text), state.notes], ['Cold, and slow to trust.', ['slow to trust', 'an idea not kept yet', 'cold at first'], 'Act 2 at the festival.']);

    await p.act('workshop-card-undo', { card: ids[2] });
    state = WorkshopStore.active(p.view().ws).state;
    deepEq([p.view().ws.commits.at(-1).origin, state.notes, p.card(ids[1]).status, p.card(ids[2]).status], ['restore', 'Slow burn.', 'waiting', 'waiting'],
        'Undo goes back to before that step, and its cards wait again');
    await p.act('workshop-card-use', { card: ids[2] });
    await p.WC._change('Edited the concept', next => { next.concept = 'Changed.'; });
    await p.act('workshop-card-undo', { card: ids[2] });
    deepEq([p.view().historyOpen, WorkshopStore.active(p.view().ws).state.notes], [true, 'Act 2 at the festival.'], 'with a step since, Undo opens the history instead');

    await p.say('Thanks.');
    const sent = p.calls.at(-1).messages[2].content;
    assert.ok(sent.includes('new pin on Appearance & body: "a scar over one eye" (used)') && sent.includes('(turned down)'), 'what became of each card reaches the next request');
});

test('Co-writer cards: a locked section is never rewritten, a card whose part changed says so and can be written again, and a card waits for its own variant', async () => {
    const reply = ['Three changes.',
        '<card>{"type":"rewrite","section":"voice","brief":"Warmer.","why":"Softer."}</card>',
        '<card>{"type":"pin","section":"appearance","add":"freckles","why":"Soft."}</card>',
        '<card>{"type":"rewrite","section":"appearance","brief":"Taller still.","why":"Presence."}</card>'].join('\n');
    const p = cardsPage([reply, { text: 'Very tall.', pins: {} }, { text: 'Very, very tall.', pins: {} }]);
    await p.say('Go.');
    const ids = p.chat().messages[1].cards;
    deepEq([p.calls.length, p.card(ids[0]).draft], [2, null], 'the locked Voice is not written; Appearance is');
    assert.ok(p.log().includes('Voice is locked.'));
    await p.act('workshop-card-use', { card: ids[0] });
    assert.equal(p.view().ws.commits.length, 1, 'and it cannot be used');

    assert.equal(p.card(ids[2]).draft.basis, 'Tall.');
    await p.WC._change('Edited Appearance & body', next => { next.sections.find(s => s.id === 'appearance').text = 'Tall, and scarred.'; });
    assert.ok(p.log().includes('Changed since it was written.'));
    await p.act('workshop-card-write', { card: ids[2] });
    deepEq([p.card(ids[2]).draft.text, p.card(ids[2]).draft.basis], ['Very, very tall.', 'Tall, and scarred.'], 'Write it again reads the section as it is now');
    assert.ok(!p.log().includes('Changed since it was written.'));

    p.view().ws = WorkshopStore.branch(p.view().ws, WorkshopStore.active(p.view().ws).head, { name: 'Darker', variantId: 'v2' });
    assert.ok(p.log().includes('Written for Main.'));
    await p.act('workshop-card-use', { card: ids[1] });
    assert.equal(p.card(ids[1]).status, 'waiting', 'on another variant it waits');
    p.view().ws = WorkshopStore.switchVariant(p.view().ws, 'v_main');
    await p.act('workshop-card-use', { card: ids[1] });
    assert.equal(p.card(ids[1]).status, 'used');
});

test("Co-writer cards: Change it writes a card again from your note or edits its words, and a variant card takes its reply's other cards with it", async () => {
    const reply = ['Try it apart.',
        '<card>{"type":"variant","name":"Darker","why":"Try it apart."}</card>',
        '<card>{"type":"rewrite","section":"appearance","brief":"Scarred.","why":"History."}</card>',
        '<card>{"type":"concept","text":"A medic who trusts no one.","why":"Tighter."}</card>'].join('\n');
    const p = cardsPage([reply, { text: 'Tall and scarred.', pins: {} }, { text: 'Tall, scarred and tired.', pins: {} }]);
    await p.say('Darker?');
    const ids = p.chat().messages[1].cards;
    assert.equal(p.WC._waitingCards(p.view()), 3, 'the Co-writer tab shows a dot while cards wait');

    p.act('workshop-card-change', { card: ids[1] });
    assert.ok(p.log().includes('What should change?'));
    p.el('ws-card-note').value = 'Tired too.';
    await p.act('workshop-card-change-save', { card: ids[1] });
    assert.match(p.calls[2].messages[1].content, /What should change: Scarred\.\nThe author also asked: Tired too\./);
    deepEq([p.card(ids[1]).draft.text, p.card(ids[1]).note], ['Tall, scarred and tired.', 'Tired too.']);

    p.act('workshop-card-change', { card: ids[2] });
    p.el('ws-card-text').value = 'A night medic who trusts no one.';
    await p.act('workshop-card-change-save', { card: ids[2] });
    deepEq([p.card(ids[2]).text, p.card(ids[2]).edited], ['A night medic who trusts no one.', true], 'the other cards change their words in place');

    await p.act('workshop-card-use', { card: ids[0] });
    const darker = WorkshopStore.active(p.view().ws);
    assert.equal(darker.name, 'Darker');
    deepEq([p.card(ids[1]).variant, p.card(ids[2]).variant], [darker.id, darker.id], "the reply's other cards go with it");
    await p.act('workshop-card-all', { message: p.chat().messages[1].id });
    deepEq([WorkshopStore.active(p.view().ws).name, WorkshopStore.active(p.view().ws).state.concept], ['Darker', 'A night medic who trusts no one.']);
    assert.equal(p.view().ws.variants.find(v => v.id === 'v_main').state.concept, 'A medic on the night shift.', 'Main is left as it was');
    assert.equal(p.WC._waitingCards(p.view()), 0);
    const source = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'workshop.js'), 'utf8');
    assert.ok(source.includes("classList.toggle('has-dot'"), 'the dot is on the Co-writer tab');
});

test('Co-writer cards: Stop while the writer drafts leaves the rest to write later, and a failed draft says why, with Write it', async () => {
    const reply = ['Two rewrites.',
        '<card>{"type":"rewrite","section":"appearance","brief":"Scarred.","why":"History."}</card>',
        '<card>{"type":"rewrite","section":"background","brief":"Dockside.","why":"Roots."}</card>'].join('\n');
    const p = cardsPage([reply, { stop: '' }, new Error('Too many requests right now.'), { text: 'Raised on the docks.', pins: {} }]);
    await p.say('Go.');
    const ids = p.chat().messages[1].cards;
    deepEq([p.calls.length, p.card(ids[0]).draft, p.card(ids[1]).draft, p.view().busy], [2, null, null, null], 'Stop ends the drafting');
    assert.ok(p.log().includes('Not written yet.') && p.log().includes('data-action="workshop-card-write"'));
    await p.act('workshop-card-write', { card: ids[0] });
    assert.equal(p.card(ids[0]).error, 'Too many requests right now.');
    assert.ok(p.log().includes('Too many requests right now.'));
    await p.act('workshop-card-write', { card: ids[1] });
    deepEq([p.card(ids[1]).draft.text, p.card(ids[1]).error], ['Raised on the docks.', null]);
});

test('Co-writer screen: its tab shows on the phone, and on a wide screen it shares the right column with the card', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    for (const id of ['ws-cowriter', 'ws-cw-head', 'ws-cw-log', 'ws-cw-input', 'ws-cw-starters', 'ws-cw-sheet', 'ws-cw-sheet-body']) {
        assert.ok(html.includes(`id="${id}"`), `${id} is in the page`);
    }
    assert.ok(!/class="ws-tab hidden"[^>]*data-tab="cowriter"/.test(html), 'the Co-writer tab is no longer hidden');
    const side = html.slice(html.indexOf('class="ws-side"'), html.indexOf('id="ws-history"'));
    assert.ok(side.includes('data-tab="cowriter"') && side.includes('data-tab="card"') && side.includes('id="ws-card"'), 'the right column holds both');
});

test('Co-writer prompts: loaded with the other Workshop files, before the actions are wired', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const at = html.indexOf('js/util/cowriter-prompts.js');
    assert.ok(at > html.indexOf('js/util/workshop-prompts.js'), 'after the Workshop prompts it builds on');
    assert.ok(at < html.indexOf('js/controllers/action-dispatcher.js'));
});

// ─── tools/mailbox.js, the PC's mailbox for RP logs ─────────────────────────────
// Rolecraft on the phone sends each exchange here over Tailscale, so the PC holds the record.

const Mailbox = require('./tools/mailbox.js');

test('Mailbox: keeps a message carrying its key as a line of JSON, turns away anything else, and answers the browser checks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolecraft-mailbox-'));
    const box = await Mailbox.start({ port: 0, dir, quiet: true, maxBytes: 200 });
    const url = `http://127.0.0.1:${box.port}`;
    try {
        assert.equal(fs.readFileSync(path.join(dir, 'key.txt'), 'utf8').trim(), box.key, 'its key is kept in its own folder');
        assert.ok(box.key.length >= 20);
        assert.equal(await (await fetch(`${url}/ping`)).text(), 'mailbox ok');

        const check = await fetch(`${url}/log`, {
            method: 'OPTIONS',
            headers: { Origin: 'https://macegac.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-mailbox-key', 'Access-Control-Request-Private-Network': 'true' }
        });
        deepEq([check.status, check.headers.get('access-control-allow-origin'), check.headers.get('access-control-allow-private-network')],
            [204, 'https://macegac.github.io', 'true'], 'the app may send from its own site to a private address');
        const stranger = await fetch(`${url}/log`, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } });
        assert.equal(stranger.headers.get('access-control-allow-origin'), null, 'no other site may');

        const post = (body, key) => fetch(`${url}/log`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Mailbox-Key': key } : {}) }, body });
        assert.equal((await post(JSON.stringify({ kind: 'test' }), 'wrong')).status, 403, 'a wrong key is turned away');
        assert.equal((await post(JSON.stringify({ kind: 'test' }))).status, 403, 'and so is none');
        assert.equal((await post('not json', box.key)).status, 400);
        assert.equal((await post(JSON.stringify({ kind: 'reply', text: 'x'.repeat(300) }), box.key)).status, 413, 'a message too big for it is refused');
        const ok = await post(JSON.stringify({ kind: 'reply', text: 'Hello.' }), box.key);
        deepEq([ok.status, await ok.json()], [200, { ok: true }]);

        const files = fs.readdirSync(path.join(dir, 'logs'));
        assert.equal(files.length, 1);
        assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/, 'a file a day');
        const lines = fs.readFileSync(path.join(dir, 'logs', files[0]), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        deepEq(lines.map(l => [l.kind, l.text, typeof l.received]), [['reply', 'Hello.', 'string']], 'only the message with the key was kept, with when it arrived');
    } finally {
        await box.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ─── js/services/mailbox.js, sending a session to the PC's mailbox ───────────────

/** MailboxService with a phone's settings and a stand-in fetch that records each post. */
function mailboxPage({ settings = {}, hash = '', fetchImpl } = {}) {
    const calls = [];
    const notices = [];
    const saved = [];
    const globalSettings = { ...settings };
    const library = { active_story_id: 's1', active_narrative_id: 'n1', stories: [{ id: 's1', name: 'Night Medic' }] };
    const ctx = {
        URLSearchParams,
        console,
        fetch: fetchImpl || (async (url, init) => {
            calls.push({ url, init });
            return { ok: true, status: 200 };
        }),
        StateManager: {
            data: { globalSettings },
            saveGlobalSettings() { saved.push({ ...globalSettings }); },
            getState: () => ({ apiProvider: 'openrouter' }),
            getLibrary: () => library
        },
        UIManager: { showNotification: (text, type) => notices.push([text, type]) },
        location: { hash, pathname: '/rolecraft/', search: '' },
        history: { replaceState: (state, title, url) => calls.push({ replaced: url }) },
        navigator: { userAgent: 'TestPhone' },
        APP_BUILD_TIMESTAMP: 'Rolecraft 1.1.0 (build test)'
    };
    ctx.globalThis = ctx;
    const source = ['js/util/diag-log.js', 'js/services/mailbox.js'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
    const MailboxService = vm.runInNewContext(`${source}\nMailboxService`, ctx);
    return { MailboxService, calls, notices, saved, globalSettings };
}

const MAILBOX_ON = { mailboxOn: true, mailboxUrl: 'https://pc.example.ts.net:8790/', mailboxKey: 'abcdefghijklmnopqrstuv' };

test('MailboxService: the setup link gives the mailbox address and key and switches sending on, then leaves the address bar', () => {
    const p = mailboxPage({ hash: '#mailbox=https%3A%2F%2Fpc.example.ts.net%3A8790&key=abcdefghijklmnopqrstuv' });
    deepEq(p.MailboxService.readLink('#mailbox=https%3A%2F%2Fpc.example.ts.net%3A8790%2F&key=abcdefghijklmnopqrstuv'), { url: 'https://pc.example.ts.net:8790', key: 'abcdefghijklmnopqrstuv' });
    assert.equal(p.MailboxService.readLink('#mailbox=http%3A%2F%2Fpc%3A8790&key=abcdefghijklmnopqrstuv'), null, 'only an https address: the app itself is served over https');
    assert.equal(p.MailboxService.readLink('#mailbox=https%3A%2F%2Fpc%3A8790&key=short'), null, 'and a real key');
    assert.equal(p.MailboxService.readLink(''), null);

    assert.equal(p.MailboxService.applyLink(), true);
    deepEq([p.globalSettings.mailboxUrl, p.globalSettings.mailboxKey, p.globalSettings.mailboxOn], ['https://pc.example.ts.net:8790', 'abcdefghijklmnopqrstuv', true]);
    assert.equal(p.saved.length, 1, 'saved with the other settings');
    assert.ok(p.calls.some(c => c.replaced === '/rolecraft/'), 'the address and key leave the address bar');
    assert.match(p.notices[0][0], /mailbox on your PC/);
    deepEq(p.calls.filter(c => c.url).map(c => JSON.parse(c.init.body).kind), ['setup'], 'and it says hello to the mailbox');
    assert.equal(mailboxPage().MailboxService.applyLink(), false, 'with no link, nothing changes');
});

test('MailboxService: each event goes to the mailbox numbered, with its story, scrubbed of keys; nothing goes while it is off or half set up', async () => {
    const p = mailboxPage({ settings: MAILBOX_ON });
    assert.equal(await p.MailboxService.send('ai', { prompt: 'A key sk-or-v1-abcdef1234567890 in a prompt.', reply: 'Hi.' }), true);
    await p.MailboxService.send('reply', { text: 'Second.' });
    const posts = p.calls.filter(c => c.url);
    deepEq(posts.map(c => [c.url, c.init.method, c.init.headers['X-Mailbox-Key']]),
        [['https://pc.example.ts.net:8790/log', 'POST', 'abcdefghijklmnopqrstuv'], ['https://pc.example.ts.net:8790/log', 'POST', 'abcdefghijklmnopqrstuv']]);
    const first = JSON.parse(posts[0].init.body);
    deepEq([first.kind, first.n, first.story, first.storyId, first.chat, first.build, first.reply], ['ai', 1, 'Night Medic', 's1', 'n1', 'Rolecraft 1.1.0 (build test)', 'Hi.']);
    assert.ok(!posts[0].init.body.includes('sk-or-v1-abcdef1234567890') && first.prompt.includes('[key removed]'), 'keys are scrubbed, as in the problem report');
    assert.equal(JSON.parse(posts[1].init.body).n, 2, 'numbered, so they read in order');
    assert.ok(p.MailboxService.lastSent > 0);

    p.globalSettings.mailboxOn = false;
    assert.equal(await p.MailboxService.send('ai', {}), false);
    p.globalSettings.mailboxOn = true;
    p.globalSettings.mailboxKey = '';
    assert.equal(await p.MailboxService.send('ai', {}), false);
    assert.equal(p.calls.filter(c => c.url).length, 2, 'nothing goes while it is off or has no key');
});

test("MailboxService: when the PC can't be reached the event is skipped, and why is kept for Settings to show", async () => {
    const off = mailboxPage({ settings: MAILBOX_ON, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    assert.equal(await off.MailboxService.send('ai', {}), false);
    assert.equal(off.MailboxService.lastError, "Couldn't reach the mailbox (Failed to fetch).");
    const refused = mailboxPage({ settings: MAILBOX_ON, fetchImpl: async () => ({ ok: false, status: 403 }) });
    assert.equal(await refused.MailboxService.send('ai', {}), false);
    assert.equal(refused.MailboxService.lastError, 'The mailbox answered 403.');
});

test("MailboxService: a request's settings go without its long text, which the AI event carries in full", () => {
    const p = mailboxPage();
    const body = JSON.stringify({
        model: 'deepseek/x', temperature: 0.8, max_tokens: 900, provider: { ignore: ['X'] },
        messages: [
            { role: 'system', content: 'S'.repeat(5000) },
            { role: 'user', content: [{ type: 'text', text: 'Hi.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(3000)}` } }] }
        ]
    });
    deepEq(p.MailboxService.requestParams(body), {
        model: 'deepseek/x', temperature: 0.8, max_tokens: 900, provider: { ignore: ['X'] },
        messages: [
            { role: 'system', content: '[5000 characters]' },
            { role: 'user', content: [{ type: 'text', text: 'Hi.' }, { type: 'image_url', image_url: { url: '[data, 3022 characters]' } }] }
        ]
    });
    deepEq(p.MailboxService.requestParams('not json'), { body: '8 characters, not JSON' });
});

test('Mailbox wiring: the watchers that fill the problem report also send to the mailbox, the setup link is read at startup, and Settings has the switch', () => {
    const diag = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'diagnostics.js'), 'utf8');
    for (const kind of ['ai', 'workshop', 'request', 'send', 'reroll', 'direct', 'reply', 'agent', 'error']) {
        assert.ok(diag.includes(`MailboxService.send('${kind}'`), `${kind} events go to the mailbox`);
    }
    assert.ok(diag.includes("ActionHandler.register('mailbox-test'") && diag.includes("ActionHandler.register('mailbox-toggle'"));
    const boot = fs.readFileSync(path.join(__dirname, 'js', 'boot.js'), 'utf8');
    assert.ok(boot.includes('MailboxService.applyLink();') && boot.includes("window.addEventListener('hashchange', () => MailboxService.applyLink());"), 'at startup, and when the link opens in a tab already showing Rolecraft');
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const at = html.indexOf('js/services/mailbox.js');
    assert.ok(at !== -1 && at < html.indexOf('js/controllers/diagnostics.js'), 'loaded before the watchers');
    for (const id of ['mailbox-on', 'mailbox-status']) assert.ok(html.includes(`id="${id}"`), `${id} is in Settings`);
    assert.ok(html.includes('data-action="mailbox-test"'));
    const app = fs.readFileSync(path.join(__dirname, 'js', 'controllers', 'app.js'), 'utf8');
    assert.ok(app.includes('MailboxService.renderSettings()'), 'Settings shows whether it is on');
});
