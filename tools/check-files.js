#!/usr/bin/env node
// Verify that index.html and the js/ + css/ folders agree.
//
// The app has no build step: index.html loads every stylesheet and script
// file directly, in order. Because the scripts are classic scripts (not
// modules) they share one global scope, exactly as the old single <script>
// block did. That makes three mistakes easy and silent, so this checks them:
//
//   1. A file on disk that index.html never loads (dead code, or a feature
//      that was added but never wired in).
//   2. A file index.html loads that does not exist (404 on the live site).
//   3. The same top-level name declared in two files (a SyntaxError that
//      stops every later script from running).
//   4. A version stamp (?v=) that no longer matches the file. The service
//      worker serves stamped files from the phone's cache without asking the
//      network, so a stale stamp would keep an old file on every phone.
//   5. A call to a method one of the app's objects does not have, such as
//      UIManager.renderChatHistory() when the method is called renderChat().
//      Nothing complains until that line runs, which for error handlers and
//      rarely used buttons can be months later, on a phone.
//
// It also parses every script, so a syntax error fails here instead of on a
// phone.
//
// Usage: node tools/check-files.js     exit 0 = clean, 1 = problems found

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const { stamp, buildInfo, BUILD_INFO_FILE } = require('./stamp-versions.js');

const ROOT = path.resolve(__dirname, '..');

function listFiles(dir, ext) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return listFiles(rel, ext);
        return entry.name.endsWith(ext) ? [rel] : [];
    });
}

function topLevelNames(ast) {
    const names = [];
    for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id.type === 'Identifier') names.push(decl.id.name);
            }
        } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
            names.push(node.id.name);
        }
    }
    return names;
}

// Walk every node of a parsed file, calling visit on each one.
function walkAst(node, visit) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach(c => walkAst(c, visit));
        else if (child && typeof child.type === 'string') walkAst(child, visit);
    }
}

/**
 * Every file declares one object (const UIManager = { ... }) and the other files call its
 * methods by name. A name that does not exist is only found when the line runs, so collect
 * what each object actually has and check every Namespace.method() call against it.
 *
 * @param {Array<{file: string, ast: Object}>} parsed
 * @param {string} allSource - every script, for spotting deliberate typeof-checks.
 * @returns {string[]} one line per call that cannot work.
 */
function missingMembers(parsed, allSource) {
    const members = new Map();
    for (const { ast } of parsed) {
        for (const node of ast.body) {
            if (node.type !== 'VariableDeclaration') continue;
            for (const d of node.declarations) {
                if (d.id.type !== 'Identifier' || !d.init || d.init.type !== 'ObjectExpression') continue;
                const set = members.get(d.id.name) || new Set();
                for (const p of d.init.properties) if (p.key) set.add(p.key.name || p.key.value);
                members.set(d.id.name, set);
            }
        }
    }

    // A method attached after the object was written (UIManager.foo = ...) counts too.
    const calls = [];
    for (const { file, ast } of parsed) {
        walkAst(ast, node => {
            if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression'
                && !node.left.computed && node.left.object.type === 'Identifier'
                && members.has(node.left.object.name) && node.left.property.type === 'Identifier') {
                members.get(node.left.object.name).add(node.left.property.name);
            }
            if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
                && !node.callee.computed && node.callee.object.type === 'Identifier'
                && node.callee.property.type === 'Identifier') {
                calls.push({ file, line: node.loc.start.line, ns: node.callee.object.name, prop: node.callee.property.name });
            }
        });
    }

    // Code that asks "typeof X.y === 'function'" first already knows it might be absent.
    const guarded = new Set();
    for (const m of allSource.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\.([\w$]+)\s*===\s*['"]function['"]/g)) {
        guarded.add(`${m[1]}.${m[2]}`);
    }

    const seen = new Set();
    const out = [];
    for (const c of calls) {
        if (!members.has(c.ns)) continue;
        if (members.get(c.ns).has(c.prop)) continue;
        if (guarded.has(`${c.ns}.${c.prop}`)) continue;
        const line = `${c.file}:${c.line} calls ${c.ns}.${c.prop}(), which ${c.ns} does not have`;
        if (!seen.has(line)) { seen.add(line); out.push(line); }
    }
    return out;
}

function check() {
    const problems = [];
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const loadedScripts = [...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g)].map(m => m[1]);
    const loadedStyles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(css\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g)].map(m => m[1]);

    const stamps = stamp(html);
    if (stamps.stale.length) {
        problems.push(`version stamps out of date (run node tools/stamp-versions.js): ${stamps.stale.join(', ')}`);
    }

    // The version line in Settings and at the top of every problem report is generated, not
    // typed. If it no longer matches the app, the reports people send back name the wrong build.
    const infoPath = path.join(ROOT, BUILD_INFO_FILE);
    const currentInfo = fs.existsSync(infoPath) ? fs.readFileSync(infoPath, 'utf8') : '';
    if (currentInfo !== buildInfo(html)) {
        problems.push(`${BUILD_INFO_FILE} is out of date (run node tools/stamp-versions.js)`);
    }

    const pairs = [
        { kind: 'script', loaded: loadedScripts, onDisk: listFiles('js', '.js') },
        { kind: 'stylesheet', loaded: loadedStyles, onDisk: listFiles('css', '.css') },
    ];
    for (const { kind, loaded, onDisk } of pairs) {
        const seen = new Set();
        for (const file of loaded) {
            if (seen.has(file)) problems.push(`${kind} loaded twice by index.html: ${file}`);
            seen.add(file);
            if (!onDisk.includes(file)) problems.push(`index.html loads a ${kind} that does not exist: ${file}`);
        }
        for (const file of onDisk) {
            if (!seen.has(file)) problems.push(`${kind} is never loaded by index.html: ${file}`);
        }
    }

    const owner = new Map();
    const parsed = [];
    const sources = [];
    for (const file of loadedScripts) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        const source = fs.readFileSync(full, 'utf8');
        let ast;
        try {
            ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
        } catch (e) {
            problems.push(`syntax error in ${file}: ${e.message}`);
            continue;
        }
        parsed.push({ file, ast });
        sources.push(source);
        for (const name of topLevelNames(ast)) {
            if (owner.has(name)) problems.push(`"${name}" is declared in both ${owner.get(name)} and ${file}`);
            else owner.set(name, file);
        }
    }

    const missing = missingMembers(parsed, sources.join('\n'));
    problems.push(...missing);

    return {
        problems, scripts: loadedScripts.length, styles: loadedStyles.length,
        names: owner.size, calls: missing.length
    };
}

if (require.main === module) {
    const { problems, scripts, styles, names } = check();
    console.log(`Scripts: ${scripts}  |  Stylesheets: ${styles}  |  Top-level names: ${names}  |  Problems: ${problems.length}`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(problems.length ? 1 : 0);
}

module.exports = { check };
