#!/usr/bin/env node
// Stamp every stylesheet and script tag in index.html with a version taken from
// the file's contents: <script src="js/boot.js?v=3f9a12c4e1">.
//
// Why: the service worker serves a stamped file straight from the phone's cache
// with no network trip, because a changed file always gets a new stamp and so a
// new address. Startup then costs one request (index.html) instead of one per
// file, and old and new files can still never mix.
//
// Usage:
//   node tools/stamp-versions.js           rewrite index.html with current stamps
//   node tools/stamp-versions.js --check   exit 1 if any stamp is out of date

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

// Matches <script src="js/..."> and <link rel="stylesheet" href="css/...">, with or without ?v=.
const TAG = /(<script\s+src="|<link\s+rel="stylesheet"\s+href=")((?:js|css)\/[^"?]+)(?:\?v=([0-9a-f]*))?"/g;

function versionOf(file) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

/**
 * @param {string} html
 * @returns {{html: string, stale: string[], missing: string[]}}
 */
function stamp(html) {
    const stale = [];
    const missing = [];
    const out = html.replace(TAG, (match, opener, file, current) => {
        if (!fs.existsSync(path.join(ROOT, file))) {
            missing.push(file);
            return match;
        }
        const version = versionOf(file);
        if (current !== version) stale.push(file);
        return `${opener}${file}?v=${version}"`;
    });
    return { html: out, stale, missing };
}

if (require.main === module) {
    const check = process.argv.includes('--check');
    const html = fs.readFileSync(INDEX, 'utf8');
    const result = stamp(html);
    if (check) {
        if (result.stale.length) {
            console.log(`Version stamps out of date for ${result.stale.length} file(s): ${result.stale.join(', ')}`);
            console.log('Run: node tools/stamp-versions.js');
            process.exit(1);
        }
        console.log('Version stamps: all current');
    } else {
        if (result.html !== html) fs.writeFileSync(INDEX, result.html);
        console.log(`Version stamps: ${result.stale.length} updated`);
    }
}

module.exports = { stamp, versionOf, TAG };
