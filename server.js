// Servidor do Dev Quest: serve os arquivos e liga a TELA GRANDE (host) ao CELULAR (controle).
// Cada sala (sala = uma sessao de jogo) tem um codigo unico e aceita UM unico controle.
// Quem chega com a sala ocupada pode entrar na FILA; quando a vez chega, o celular recebe a nova sala sozinho.
//
// Uso:   npm start
// Opcoes por variavel de ambiente:
//   PORT=8787                       porta do servidor
//   PUBLIC_URL=https://xxxx.trycloudflare.com   endereco que vai dentro do QR (use com tunel/internet)
//   ADMIN_PASS=segredo              senha do painel /admin.html (sem ela, so abre no proprio notebook)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ROOM_TTL_MS = 10 * 60 * 1000;   // sala sem controle conectado expira em 10 min
const QUEUE_MAX = 15;                 // tamanho maximo da fila
const RESERVE_MS = 30 * 1000;         // tempo que a sala fica reservada para quem foi chamado da fila
const QUEUE_GRACE_MS = 60 * 1000;     // quem some da fila (celular dormiu) mantem o lugar por 1 min
const PAD_MSG_PER_SEC = 30;           // limite de mensagens por segundo vindas de um celular
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/* ---------- endereco que vai no QR ---------- */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || [])
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  // prioriza redes privadas comuns (hotspot do Windows = 192.168.137.1)
  const score = a => (a.startsWith('192.168.137.') ? 0 : a.startsWith('192.168.') ? 1 : a.startsWith('10.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}
function baseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `http://${lanAddresses()[0] || 'localhost'}:${PORT}`;
}

/* ---------- dados do organizador (estatisticas anonimas e ranking) ---------- */
// Nao coletamos dado pessoal: so a contagem das partidas e o ranking (apelido + pontos).
function readList(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; }
  catch (e) {
    if (e.code !== 'ENOENT') { try { fs.renameSync(file, file + '.corrompido-' + Date.now()); } catch {} } // nao sobrescreve arquivo estragado
    return [];
  }
}
function writeAtomic(file, text) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); }
  catch (e) { console.error('  ! nao consegui gravar ' + path.basename(file) + ': ' + e.message); }
}
const F_PARTIDAS = path.join(DATA_DIR, 'partidas.json');
const F_RANKING = path.join(DATA_DIR, 'ranking.json');
const F_ANTIGOS = ['contatos.json', 'contatos.csv'].map(f => path.join(DATA_DIR, f)); // sobras de versoes antigas que coletavam contato
F_ANTIGOS.forEach(f => { try { fs.unlinkSync(f); } catch {} });
let partidas = readList(F_PARTIDAS);
let ranking = readList(F_RANKING);

const clampNum = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
function addPartida(m) {
  const perfil = String(m.perfil || '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'desconhecido';
  partidas.push({ t: Date.now(), perfil, pontos: clampNum(m.pontos, 100000), duracao: clampNum(m.duracao, 3600), modo: m.modo === 'duelo' ? 'duelo' : 'solo', dif: m.dif === 'hard' ? 'hard' : 'normal' });
  if (partidas.length > 5000) partidas = partidas.slice(-5000);
  writeAtomic(F_PARTIDAS, JSON.stringify(partidas));
}
// o ranking aparece na tela grande, entao o servidor guarda uma copia: o painel (outro navegador/aparelho) enxerga o mesmo placar
function addRanking(m) {
  const n = String(m.n || '').replace(/\s+/g, ' ').trim().slice(0, 14).trim() || 'Anônimo';
  const p = String(m.p || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(m.d)) ? m.d : '';
  ranking.push({ n, s: clampNum(m.s, 100000), p, d, t: Date.now() });
  ranking.sort((a, b) => b.s - a.s);
  ranking = ranking.slice(0, 200);
  writeAtomic(F_RANKING, JSON.stringify(ranking));
}
function resetAll() {                                  // zera tudo para recomecar do zero (testes antes da feira)
  partidas = []; ranking = [];
  [F_PARTIDAS, F_RANKING, ...F_ANTIGOS].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  hosts.forEach(h => send(h, { t: 'ranking', list: [] })); // a tela grande esvazia o ranking que guarda no navegador
}
function stats() {
  const n = partidas.length, now = Date.now(), H = 3600e3;
  const sum = k => partidas.reduce((a, p) => a + (p[k] || 0), 0);
  const perfis = {}; partidas.forEach(p => { perfis[p.perfil] = (perfis[p.perfil] || 0) + 1; });
  const startHour = Math.floor(now / H) * H;
  const porHora = Array.from({ length: 12 }, (_, i) => {
    const t0 = startHour - (11 - i) * H;
    return { h: new Date(t0).getHours() + 'h', n: partidas.filter(p => p.t >= t0 && p.t < t0 + H).length };
  });
  const modos = { solo: 0, duelo: 0 }, difs = { normal: 0, hard: 0 };
  partidas.forEach(p => { modos[p.modo === 'duelo' ? 'duelo' : 'solo']++; difs[p.dif === 'hard' ? 'hard' : 'normal']++; });
  return {
    modos, difs, total: n, pontosMedio: n ? Math.round(sum('pontos') / n) : 0, duracaoMedia: n ? Math.round(sum('duracao') / n) : 0,
    perfis, porHora, ranking: ranking.slice(0, 20), totalRanking: ranking.length
  };
}

/* ---------- seguranca do painel ---------- */
function isLocal(req) { // pelo tunel a conexao tambem chega de 127.0.0.1, mas com cabecalhos de proxy
  const a = req.socket.remoteAddress || '';
  return (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
}
function adminOk(req) {
  const pass = process.env.ADMIN_PASS;
  return pass ? req.headers['x-admin-pass'] === pass : isLocal(req);
}

/* ---------- salas e fila ---------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para ninguem confundir
const rooms = new Map(); // code -> { host, pads[2], tokens[2], max (1 = solo, 2 = duelo), createdAt, reservedFor, reservedEntry, reserveTimer }
const padCount = r => r.pads.filter(Boolean).length;
const hosts = new Set();
const queue = []; // { token, name, ws, seen }
function newCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => ALPHABET[Math.random() * ALPHABET.length | 0]).join(''); } while (rooms.has(code));
  return code;
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function notifyQueue() {
  queue.forEach((e, i) => send(e.ws, { t: 'queue', pos: i + 1, n: queue.length }));
  for (const [, r] of rooms) send(r.host, { t: 'queue', n: queue.length, next: queue[0] ? queue[0].name : null, calling: r.reservedEntry ? r.reservedEntry.name : null });
}
function release(room) { // libera a reserva (chegou, expirou ou a sala fechou)
  clearTimeout(room.reserveTimer);
  room.reservedFor = null; room.reservedEntry = null; room.reserveTimer = null;
}
function dispatch() { // salas vazias e sem reserva chamam o proximo da fila
  for (const [code, room] of rooms) {
    if (padCount(room) >= room.max || room.reservedFor || !queue.length) continue;
    const i = queue.findIndex(e => e.ws && e.ws.readyState === 1);
    if (i < 0) break;
    const [entry] = queue.splice(i, 1);
    room.reservedFor = entry.token; room.reservedEntry = entry;
    room.reserveTimer = setTimeout(() => { release(room); notifyQueue(); dispatch(); }, RESERVE_MS); // nao veio: chama o proximo
    send(entry.ws, { t: 'go', code });
  }
  notifyQueue();
}
function setMode(host, max) {
  const r = rooms.get(host.room); if (!r) return;
  r.max = max === 2 ? 2 : 1;
  if (r.max === 1 && r.pads[1]) { send(r.pads[1], { t: 'end', reason: 'fim' }); r.pads[1].close(); r.pads[1] = null; r.tokens[1] = null; }
  dispatch();
}
function closeRoom(code, reason) {
  const r = rooms.get(code); if (!r) return;
  if (r.reservedEntry && padCount(r) < r.max) queue.unshift(r.reservedEntry); // quem foi chamado e nao chegou volta para o inicio
  release(r);
  rooms.delete(code);
  r.pads.forEach(p => { send(p, { t: 'end', reason }); if (p) p.close(); });
}
function openRoom(host) {
  if (host.room) closeRoom(host.room, 'fim');
  const code = newCode();
  rooms.set(code, { host, pads: [null, null], tokens: [null, null], max: 1, createdAt: Date.now(), reservedFor: null, reservedEntry: null, reserveTimer: null });
  host.room = code;
  const url = `${baseUrl()}/pad.html?r=${code}`;
  send(host, { t: 'room', code, url });
  dispatch();
}
function joinQueue(ws, token, name) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Visitante';
  let e = queue.find(q => q.token === token);
  if (e) { e.ws = ws; e.seen = Date.now(); e.name = name; }
  else if (queue.length >= QUEUE_MAX) return send(ws, { t: 'queue-full' });
  else queue.push({ token, name, ws, seen: Date.now() });
  dispatch();
}
function leaveQueue(token) {
  const i = queue.findIndex(q => q.token === token);
  if (i >= 0) { queue.splice(i, 1); notifyQueue(); }
}

/* ---------- http ---------- */
async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/qr.svg') {
    const data = u.searchParams.get('u') || '';
    if (!data || data.length > 300) { res.writeHead(400); return res.end(); }
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a0e1a', light: '#ffffff' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  if (u.pathname.startsWith('/api/')) { // painel do organizador
    if (!adminOk(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"erro":"nao autorizado"}'); }
    if (u.pathname === '/api/stats') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(stats())); }
    if (u.pathname === '/api/reset') {               // so com POST e o cabecalho proprio (impede que outra pagina aberta no navegador zere por engano)
      if (req.method !== 'POST' || req.headers['x-devquest'] !== 'zerar') { res.writeHead(405); return res.end(); }
      resetAll(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
    }
    res.writeHead(404); return res.end();
  }
  let file = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  file = path.normalize(path.join(PUBLIC_DIR, file));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Nao encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}
// qualquer requisicao estranha (URL malformada etc.) vira erro 400 em vez de derrubar o jogo
const server = http.createServer((req, res) => {
  handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(400); res.end(); });
});

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const role = q.get('role');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  if (role === 'host') {
    hosts.add(ws);
    send(ws, { t: 'ranking', list: ranking.slice(0, 100) });   // a tela grande mostra o ranking guardado aqui
    openRoom(ws);
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'new-room') openRoom(ws);                         // proxima pessoa: novo codigo
      else if (m.t === 'view') {                                    // o que o celular deve mostrar (to: 0/1 = so aquele jogador)
        const r = rooms.get(ws.room); if (!r) return;
        const { to, ...view } = m;
        (to === 0 || to === 1 ? [to] : [0, 1]).forEach(i => send(r.pads[i], view));
      }
      else if (m.t === 'mode') setMode(ws, m.max);                  // 1 jogador ou duelo (2 celulares)
      else if (m.t === 'partida') addPartida(m);
      else if (m.t === 'rank-add') addRanking(m);
    });
    ws.on('close', () => { hosts.delete(ws); if (ws.room) closeRoom(ws.room, 'fim'); dispatch(); });
    return;
  }

  if (role === 'pad') {
    const code = (q.get('r') || '').toUpperCase(), token = (q.get('k') || '').slice(0, 40);
    const room = rooms.get(code);
    const queued = queue.find(e => e.token === token);

    // ocupada, reservada para outra pessoa ou ja expirada: o celular pode esperar na fila
    const busy = reason => {
      send(ws, { t: 'busy', reason, queued: !!queued, pos: queued ? queue.indexOf(queued) + 1 : 0, n: queue.length });
      if (queued) { queued.ws = ws; queued.seen = Date.now(); }       // voltou depois de dormir: mantem o lugar
      let hits = 0, t0 = Date.now();
      ws.on('message', raw => {
        if (raw.length > 300) return;
        if (Date.now() - t0 > 1000) { t0 = Date.now(); hits = 0; } if (++hits > 10) return;
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.t === 'queue-join') joinQueue(ws, token, m.name);
        else if (m.t === 'queue-leave') leaveQueue(token);
      });
      ws.on('close', () => { const e = queue.find(x => x.token === token); if (e && e.ws === ws) { e.ws = null; e.seen = Date.now(); notifyQueue(); } });
      if (queued) dispatch();                                        // pode ter uma sala livre esperando por ele
    };

    if (!room) { if (queued) return busy('espera'); send(ws, { t: 'err', reason: 'expirada' }); return ws.close(); }
    // o mesmo aparelho reconectando volta para o seu lugar; senao pega o primeiro lugar livre (ate room.max)
    let slot = token ? room.tokens.indexOf(token) : -1;
    if (slot >= room.max) slot = -1;
    if (slot < 0) {
      if (padCount(room) >= room.max) return busy('ocupada');                                      // sessao cheia
      if (room.reservedFor && room.reservedFor !== token) return busy('reservada');               // vez de quem estava na fila
      slot = room.pads.findIndex((p, i) => i < room.max && !p);
    }
    if (room.reservedFor === token) { release(room); }
    if (room.pads[slot]) room.pads[slot].close();            // mesmo aparelho reconectando
    leaveQueue(token);
    room.pads[slot] = ws; room.tokens[slot] = token; ws.room = code; ws.slot = slot;
    send(ws, { t: 'joined', slot });
    send(room.host, { t: 'pad', slot, online: true, count: padCount(room) });
    notifyQueue();
    // limite de mensagens por segundo: um celular com defeito (ou curioso) nao trava a tela grande
    let hits = 0, t0 = Date.now();
    ws.on('message', raw => {
      if (raw.length > 1024) return;
      if (Date.now() - t0 > 1000) { t0 = Date.now(); hits = 0; }
      if (++hits > PAD_MSG_PER_SEC) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'in') send(rooms.get(code)?.host, { ...m, p: slot });
    });
    ws.on('close', () => {
      const r = rooms.get(code);
      if (r && r.pads[slot] === ws) { r.pads[slot] = null; send(r.host, { t: 'pad', slot, online: false, count: padCount(r) }); }
    });
    return;
  }
  ws.close();
});

// derruba conexoes mortas, salas esquecidas e quem sumiu da fila
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  for (const [code, r] of rooms) if (!padCount(r) && Date.now() - r.createdAt > ROOM_TTL_MS && r.host.readyState !== 1) closeRoom(code, 'expirada');
  const before = queue.length;
  for (let i = queue.length - 1; i >= 0; i--) if (!(queue[i].ws && queue[i].ws.readyState === 1) && Date.now() - queue[i].seen > QUEUE_GRACE_MS) queue.splice(i, 1);
  if (queue.length !== before) notifyQueue();
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  DEV QUEST rodando!\n');
  console.log('  Tela grande (abra no navegador do notebook/TV):  http://localhost:' + PORT);
  console.log('  Endereco dentro do QR do celular:               ' + baseUrl());
  console.log('  Painel do organizador:                          http://localhost:' + PORT + '/admin.html' + (process.env.ADMIN_PASS ? '  (senha: ADMIN_PASS)' : '  (so neste notebook)'));
  const all = lanAddresses();
  if (all.length > 1) console.log('  (outras redes detectadas: ' + all.join(', ') + ')');
  console.log('\n  O celular precisa estar na MESMA rede do notebook (ou use PUBLIC_URL com um tunel).\n');
});
