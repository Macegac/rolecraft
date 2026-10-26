#!/usr/bin/env node
// The mailbox: a small receiver on the PC that Rolecraft on the phone sends each RP exchange
// to, so a session can be read back on the PC without copying anything off the phone.
//
// Rolecraft runs at https://macegac.github.io, and a page served over https can only reach an
// https address, so the PC gets one from Tailscale (tailscale serve, below). The mailbox itself
// listens on this PC only.
//
// Every message it keeps is one line of JSON in <dir>/logs/<date>.jsonl, with the time it
// arrived. It keeps only messages that carry its key, which is made on first start and kept in
// <dir>/key.txt. The logs hold story text, so <dir> sits outside the repo, which is public.
//
// Usage:
//   node tools/mailbox.js                          port 8790, files in ../rolecraft-mailbox
//   node tools/mailbox.js --port 8791 --dir D:/somewhere
// then, in another window, give it the PC's Tailscale https address:
//   tailscale serve --https=443 http://127.0.0.1:8790
//
//   GET  /ping    "mailbox ok": whether the phone can reach it at all
//   POST /log     a message to keep: JSON, with the key in X-Mailbox-Key
//
// Tests require() it and call start({ port: 0, dir }).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PORT = 8790;
const DEFAULT_DIR = path.join(__dirname, '..', '..', 'rolecraft-mailbox');
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

// The pages that may send: the app online, and the local copy used to try changes.
const ORIGINS = ['https://macegac.github.io', 'http://localhost:8785', 'http://127.0.0.1:8785'];

/** The mailbox's key, made the first time and kept in its folder. */
function keyIn(dir) {
    const file = path.join(dir, 'key.txt');
    try {
        const key = fs.readFileSync(file, 'utf8').trim();
        if (key) return key;
    } catch (e) {
        // None yet.
    }
    const key = crypto.randomBytes(18).toString('base64url');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${key}\n`);
    return key;
}

/**
 * What the browser checks before the app's page may post here: which site may send, and, since
 * this is a private address, that a public page may reach it.
 */
function corsHeaders(req) {
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Mailbox-Key',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
    };
    if (ORIGINS.includes(req.headers.origin)) headers['Access-Control-Allow-Origin'] = req.headers.origin;
    return headers;
}

/** The request's body as text. One past the limit is read to the end, then refused. */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size <= limit) chunks.push(chunk);
        });
        req.on('end', () => {
            if (size > limit) reject(Object.assign(new Error('too large'), { status: 413 }));
            else resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function start({ port = DEFAULT_PORT, dir = DEFAULT_DIR, quiet = false, host = '127.0.0.1', maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const key = keyIn(dir);
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const say = text => { if (!quiet) console.log(text); };

    const server = http.createServer(async (req, res) => {
        const send = (status, body, type = 'text/plain; charset=utf-8') => {
            res.writeHead(status, { ...corsHeaders(req), 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        };
        const where = new URL(req.url, 'http://mailbox').pathname;
        if (req.method === 'OPTIONS') return send(204, '');
        if (req.method === 'GET' && where === '/ping') return send(200, 'mailbox ok');
        if (req.method !== 'POST' || where !== '/log') return send(404, 'not found');
        if (req.headers['x-mailbox-key'] !== key) return send(403, 'wrong key');

        let text;
        try {
            text = await readBody(req, maxBytes);
        } catch (err) {
            return send(err.status || 400, err.message);
        }
        let message;
        try {
            message = JSON.parse(text);
        } catch (err) {
            return send(400, 'not JSON');
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return send(400, 'not a JSON object');

        const now = new Date();
        fs.appendFileSync(path.join(logs, `${now.toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ received: now.toISOString(), ...message })}\n`);
        say(`${now.toISOString()} ${message.kind || 'message'}, ${text.length} bytes`);
        return send(200, JSON.stringify({ ok: true }), 'application/json');
    });

    return new Promise(resolve => {
        server.listen(port, host, () => {
            const actual = server.address().port;
            say(`Mailbox listening on http://${host}:${actual}, files in ${dir}`);
            resolve({ port: actual, key, dir, close: () => new Promise(done => server.close(done)) });
        });
    });
}

if (require.main === module) {
    const arg = name => {
        const i = process.argv.indexOf(name);
        return i === -1 ? undefined : process.argv[i + 1];
    };
    start({ port: Number(arg('--port')) || DEFAULT_PORT, dir: arg('--dir') ? path.resolve(arg('--dir')) : DEFAULT_DIR, host: arg('--host') || '127.0.0.1' })
        .then(box => console.log(`Key: in ${path.join(box.dir, 'key.txt')}`));
}

module.exports = { start };
