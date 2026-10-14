#!/usr/bin/env node
// A stand-in for the AI services Rolecraft talks to, so new AI features can be tried and
// tested without a key or a bill.
//
// It answers chat requests the way OpenRouter, KoboldCpp, LM Studio and Ollama do:
// POST /v1/chat/completions (also /api/v1/chat/completions, OpenRouter's path), plain or with
// "stream": true. A streamed reply arrives word by word as server-sent events: thinking
// first, then the reply, then a finish reason and "data: [DONE]". GET /v1/models lists one
// model, for connection tests.
//
// A marker anywhere in the messages chooses what it says and how it misbehaves, so a test
// picks its case in the prompt it sends. Words combine: [[fake json delay=0]].
//
//   (no marker)        a short made-up reply that quotes the last message
//   json               a JSON object instead (also whenever response_format asks for JSON)
//   fenced             that JSON inside ```json fences, with a line of chat around it
//   badjson            broken JSON while the marker is in the last message, so a retry
//                      that adds a message gets good JSON
//   empty              no reply text at all
//   length             cut off halfway, finish reason "length"
//   status=429         fail with this HTTP status and an OpenRouter-style error
//   midstream-error    start the reply, then send an error chunk and stop (streams only)
//   stall=5            go quiet for 5 seconds before the first word (decimals work)
//   keepalive=1        during a stall, send ": OPENROUTER PROCESSING" this often, in seconds
//   split              send every event in two pieces, so lines arrive cut in half
//   provider=Name      the provider named in X-Provider-Name and the "provider" field
//   delay=15           milliseconds between words
//   reasoning_content  thinking in delta.reasoning_content (DeepSeek, LM Studio) instead of
//                      delta.reasoning (OpenRouter)
//   thinktags          thinking inside the reply between <think> tags, the way many local
//                      models send it
//   nothink            no thinking. It's also left out when the request turns reasoning off.
//
// POST /fake/next {"replies": ["...", "..."]} queues exact reply texts for the next chat
// requests, in order, so a screen can be driven through real-looking answers in the browser.
// A queued reply still streams and thinks like any other.
//
// Every chat request is added to the log, one JSON object per line, with the key hidden. The
// log is emptied each time the server starts.
//
// Usage:
//   node tools/fake-ai.js                          port 8786, log at tools/fake-ai.log
//   node tools/fake-ai.js --port 9000 --log x.log
//   node tools/fake-ai.js --host 0.0.0.0           reachable from a phone on the home
//                                                  network or Tailscale, to test that path
//
// It listens on 127.0.0.1 unless told otherwise. Tests require() it and call start({ port: 0 }).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 8786;
const DEFAULT_LOG = path.join(__dirname, 'fake-ai.log');
const MARKER = /\[\[fake\b([^\]]*)\]\]/g;
const THINKING = 'The request is clear. Keep every detail it asks for and answer in the shape it wants.';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The text of a message, whether its content is a string or a list of parts. */
function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(part => (part && part.type === 'text' ? part.text : '')).join(' ');
    return '';
}

/** The words of every [[fake ...]] marker in the messages, and whether the last message has one. */
function readMarker(messages) {
    const opts = {};
    let inLast = false;
    messages.forEach((message, i) => {
        for (const match of textOf(message && message.content).matchAll(MARKER)) {
            if (i === messages.length - 1) inLast = true;
            for (const word of match[1].trim().split(/\s+/).filter(Boolean)) {
                const eq = word.indexOf('=');
                if (eq === -1) opts[word] = true;
                else opts[word.slice(0, eq)] = word.slice(eq + 1);
            }
        }
    });
    return { opts, inLast };
}

/** What to answer: the thinking, the reply and the finish reason. A queued reply is used as it is. */
function compose(body, n, { opts, inLast }, queued = null) {
    const reasoningOff = opts.nothink || (body.reasoning || {}).enabled === false || (body.reasoning || {}).effort === 'none';
    if (queued !== null) return { thinking: reasoningOff ? '' : THINKING, content: String(queued), finish: 'stop' };
    const lastUser = body.messages.filter(m => m && m.role === 'user').pop();
    const quote = textOf(lastUser && lastUser.content).replace(MARKER, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const format = body.response_format && body.response_format.type;
    const wantsJson = opts.json || opts.fenced || opts.badjson || format === 'json_object' || format === 'json_schema';
    const reasoning = body.reasoning || {};

    let content = `This is a made-up reply from the fake AI server, request ${n}. You said: "${quote}"`;
    if (wantsJson) {
        const json = JSON.stringify({ fake: true, request: n, quote });
        if (opts.badjson && inLast) content = json.slice(0, -2);
        else if (opts.fenced) content = `Here it is:\n\`\`\`json\n${json}\n\`\`\`\nTell me if you want changes.`;
        else content = json;
    }
    if (opts.empty) content = '';
    let finish = 'stop';
    if (opts.length) {
        content = content.slice(0, Math.ceil(content.length / 2));
        finish = 'length';
    }
    const thinkingOff = opts.nothink || reasoning.enabled === false || reasoning.effort === 'none';
    if (opts.thinktags && !thinkingOff) return { thinking: '', content: `<think>${THINKING}</think>\n${content}`, finish };
    return { thinking: thinkingOff ? '' : THINKING, content, finish };
}

/** Text cut into word-sized pieces that join back into exactly the same text. */
function pieces(text) {
    return text.match(/\s*\S+\s*/g) || [];
}

function usageOf(body, reply) {
    const prompt = Math.ceil(JSON.stringify(body.messages).length / 4);
    const completion = Math.ceil((reply.thinking.length + reply.content.length) / 4);
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

/** Lets the app, served from another port or from GitHub Pages, call this server and read its headers. */
function corsHeaders(req) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type, Authorization',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Expose-Headers': 'X-Provider-Name, X-Generation-Id',
        'Access-Control-Max-Age': '600',
    };
}

/** The request's headers with the key replaced, so the log never holds one. */
function hideKey(headers) {
    return headers.authorization ? { ...headers, authorization: '[hidden]' } : headers;
}

function sendJson(res, status, headers, data) {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

/** Waits out a stall, sending OpenRouter's keep-alive comment lines if asked to and able to. */
async function stall(opts, write) {
    const end = Date.now() + Number(opts.stall || 0) * 1000;
    const every = opts.keepalive === true ? 1000 : Number(opts.keepalive || 0) * 1000;
    while (Date.now() < end) {
        if (every && write) await write(': OPENROUTER PROCESSING\n\n');
        await sleep(Math.min(every || Infinity, end - Date.now()));
    }
}

async function streamReply(res, headers, meta, reply, usage, opts) {
    const delay = opts.delay === undefined ? 15 : Number(opts.delay);
    const thinkingField = opts.reasoning_content ? 'reasoning_content' : 'reasoning';
    let gone = false;
    res.on('close', () => { gone = true; });

    const write = async text => {
        if (gone) return;
        if (opts.split) {
            const cut = Math.floor(text.length / 2);
            res.write(text.slice(0, cut));
            await sleep(5);
            if (!gone) res.write(text.slice(cut));
        } else {
            res.write(text);
        }
    };
    const event = (extra, delta, finish = null) => write(`data: ${JSON.stringify({
        ...meta, object: 'chat.completion.chunk', ...extra,
        choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish }],
    })}\n\n`);

    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    await stall(opts, write);
    await event({}, { role: 'assistant', content: '' });
    for (const word of pieces(reply.thinking)) {
        if (gone) return;
        await event({}, { content: opts.reasoning_content ? null : '', [thinkingField]: word });
        if (delay) await sleep(delay);
    }
    const words = pieces(reply.content);
    for (const [i, word] of words.entries()) {
        if (gone) return;
        if (opts['midstream-error'] && i === Math.floor(words.length / 2)) {
            await event({ error: { code: 502, message: 'The fake provider dropped the connection mid-reply.' } }, { content: '' }, 'error');
            return res.end();
        }
        await event({}, { content: word });
        if (delay) await sleep(delay);
    }
    await event({ usage }, { content: '' }, reply.finish);
    await write('data: [DONE]\n\n');
    res.end();
}

/** Starts the server. Resolves to { port, close } once it's listening. */
function start({ port = DEFAULT_PORT, log = DEFAULT_LOG, quiet = false, host = '127.0.0.1' } = {}) {
    if (log) fs.writeFileSync(log, '');
    let count = 0;
    const queue = [];

    const server = http.createServer(async (req, res) => {
        const headers = corsHeaders(req);
        const route = req.url.split('?')[0].replace(/^\/api(?=\/v1\/)/, '');
        // Every request, browser checks included, so a blocked call from a phone shows how far it got.
        if (!quiet) console.log(`${req.method} ${req.url} from ${req.socket.remoteAddress} origin=${req.headers.origin || '-'}${req.headers['access-control-request-private-network'] ? ' private-network-check' : ''}`);
        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            return res.end();
        }
        if (req.method === 'GET' && route === '/v1/models') {
            return sendJson(res, 200, headers, { object: 'list', data: [{ id: 'fake/model', object: 'model', owned_by: 'fake-ai', context_length: 1048576 }] });
        }
        if (req.method === 'POST' && route === '/fake/next') {
            let asked = {};
            try { asked = JSON.parse(await readBody(req)); } catch { /* an empty queue request */ }
            const replies = Array.isArray(asked.replies) ? asked.replies : [];
            queue.push(...replies.map(r => (typeof r === 'string' ? r : JSON.stringify(r))));
            return sendJson(res, 200, headers, { queued: queue.length });
        }
        if (req.method === 'GET' && route === '/') {
            res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(`Fake AI server for Rolecraft.\nPOST /v1/chat/completions\nChat requests so far: ${count}\nLog: ${log || 'off'}\n`);
        }
        if (req.method !== 'POST' || route !== '/v1/chat/completions') {
            return sendJson(res, 404, headers, { error: { code: 404, message: `Nothing at ${req.method} ${req.url}` } });
        }

        let body;
        try {
            body = JSON.parse(await readBody(req));
        } catch {
            return sendJson(res, 400, headers, { error: { code: 400, message: 'The request body is not JSON.' } });
        }
        const n = ++count;
        if (log) fs.appendFileSync(log, JSON.stringify({ n, at: new Date().toISOString(), method: req.method, path: req.url, headers: hideKey(req.headers), body }) + '\n');
        if (!Array.isArray(body.messages) || !body.messages.length) {
            return sendJson(res, 400, headers, { error: { code: 400, message: '"messages" must be a list with at least one message.' } });
        }

        const marker = readMarker(body.messages);
        const { opts } = marker;
        if (!quiet) console.log(`#${n} ${req.url} model=${body.model} stream=${!!body.stream}${Object.keys(opts).length ? ` marker=${JSON.stringify(opts)}` : ''}`);
        const provider = typeof opts.provider === 'string' ? opts.provider : 'Fake';
        if (opts.status) {
            const code = Number(opts.status);
            return sendJson(res, code, headers, { error: { code, message: `Fake error ${code}, asked for by the marker.`, metadata: { provider_name: provider } } });
        }

        const reply = compose(body, n, marker, queue.length ? queue.shift() : null);
        const usage = usageOf(body, reply);
        const meta = { id: `gen-fake-${n}`, created: Math.floor(Date.now() / 1000), model: body.model || 'fake/model', provider };
        const replyHeaders = { ...headers, 'X-Provider-Name': provider, 'X-Generation-Id': meta.id };
        if (body.stream) return streamReply(res, replyHeaders, meta, reply, usage, opts);

        await stall(opts);
        const thinkingField = opts.reasoning_content ? 'reasoning_content' : 'reasoning';
        sendJson(res, 200, replyHeaders, {
            ...meta, object: 'chat.completion',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: reply.content, [thinkingField]: reply.thinking || null },
                finish_reason: reply.finish, native_finish_reason: reply.finish,
            }],
            usage,
        });
    });

    return new Promise(resolve => server.listen(port, host, () => resolve({
        port: server.address().port,
        close: () => new Promise(done => {
            server.close(done);
            server.closeAllConnections();
        }),
    })));
}

if (require.main === module) {
    const arg = name => {
        const i = process.argv.indexOf(name);
        return i === -1 ? undefined : process.argv[i + 1];
    };
    const log = arg('--log') ? path.resolve(arg('--log')) : DEFAULT_LOG;
    const host = arg('--host') || '127.0.0.1';
    start({ port: Number(arg('--port') || DEFAULT_PORT), log, host })
        .then(({ port }) => console.log(`Fake AI server on http://${host}:${port} (log: ${log})`));
}

module.exports = { start };
