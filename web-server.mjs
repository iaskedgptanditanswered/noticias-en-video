/**
 * web-server.mjs  —  UI web para generar videos de noticias.
 *
 * Iniciar:  node web-server.mjs
 * Abrir:    http://localhost:4000
 */

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 4000;

// ─── .env parser ──────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ─── Settings persistence ─────────────────────────────────────────────────────
const SETTINGS_PATH = join(__dirname, 'settings.json');
function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) return { service: process.env.AI_SERVICE || 'anthropic' };
  try { return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')); }
  catch { return { service: 'anthropic' }; }
}
function saveSettings(s) { writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }

// ─── AI provider abstraction ──────────────────────────────────────────────────
async function callAI(prompt) {
  const { service } = loadSettings();

  if (service === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || key.includes('REEMPLAZAR')) throw new Error('ANTHROPIC_API_KEY no configurada en .env');
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0].text.trim();
  }

  if (service === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3-0324';
    if (!key || key.includes('REEMPLAZAR')) throw new Error('OPENROUTER_API_KEY no configurada en .env');
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:4000',
        'X-Title': 'News Video Generator',
      },
      body: JSON.stringify({ model, max_tokens: 10000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(180000),
    });
    if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  if (service === 'ollama') {
    const key = process.env.OLLAMA_API_KEY;
    const url = process.env.OLLAMA_API_URL;
    const model = process.env.OLLAMA_MODEL;
    if (!key || key.includes('REEMPLAZAR')) throw new Error('OLLAMA_API_KEY no configurada en .env');
    if (!url || url.includes('REEMPLAZAR')) throw new Error('OLLAMA_API_URL no configurada en .env');
    if (!model || model.includes('REEMPLAZAR')) throw new Error('OLLAMA_MODEL no configurado en .env');
    const endpoint = url.replace(/\/$/, '') + '/chat/completions';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 10000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(180000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  throw new Error(`Servicio desconocido: ${service}`);
}

// Carpeta temporal para los videos generados
const OUTPUT_DIR = join(__dirname, 'rendered-videos');
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR);

// Map de jobs activos: id → { progress, status, filename, error }
const jobs = new Map();

// ─── Parser (igual que make-video.mjs) ────────────────────────────────────────
function parseBriefing(text, theme) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const headerLine = lines.find(l => l.includes('|')) || '';
  const datePart = headerLine.includes('|')
    ? headerLine.split('|').pop().trim().replace(/\*+/g, '').trim()
    : new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣'];
  const news = [];

  for (let n = 0; n < 3; n++) {
    const startEmoji = NUM_EMOJIS[n];
    const startIdx = lines.findIndex(l => l.startsWith(startEmoji) || l.includes(startEmoji));
    if (startIdx === -1) throw new Error(`No se encontró la noticia ${n + 1}. Revisá el formato.`);

    const endIdx = (() => {
      if (n < 2) {
        const next = NUM_EMOJIS[n + 1];
        const idx = lines.findIndex((l, i) => i > startIdx && (l.startsWith(next) || l.includes(next)));
        return idx !== -1 ? idx : lines.length;
      }
      const idx = lines.findIndex((l, i) => i > startIdx && (l.includes('PATRÓN') || l.includes('PATRON') || l.includes('DEBATE')));
      return idx !== -1 ? idx : lines.length;
    })();

    const block = lines.slice(startIdx, endIdx);

    const title = block[0].replace(startEmoji, '').replace(/\*+/g, '').trim();

    const summaryLine = block.find(l => /lo clave/i.test(l)) || '';
    const summary = summaryLine
      .replace(/^\*+\s*/, '').replace(/\*+lo clave:\*+\s*/i, '')
      .replace(/lo clave:\s*/i, '').replace(/\*+/g, '').trim();

    const bulletLines = block.filter(l => l.includes('✅'));
    const bullets = bulletLines.slice(0, 3).map(l =>
      l.replace('✅', '').replace(/^\*+\s*/, '').replace(/\*+/g, '').trim()
    );
    while (bullets.length < 3) bullets.push('—');

    news.push({ title, summary, bullets: [bullets[0], bullets[1], bullets[2]] });
  }

  const patternIdx = lines.findIndex(l => l.includes('PATRÓN') || l.includes('PATRON'));
  let pattern = '';
  if (patternIdx !== -1) {
    const inlineText = lines[patternIdx]
      .replace(/💡\s*/g, '').replace(/\*+EL PATR[OÓ]N DE HOY:\*+\s*/i, '')
      .replace(/EL PATR[OÓ]N DE HOY:\s*/i, '').replace(/\*+/g, '').trim();
    if (inlineText) {
      pattern = inlineText;
    } else {
      const debateIdx = lines.findIndex((l, i) => i > patternIdx && l.includes('DEBATE'));
      const end = debateIdx !== -1 ? debateIdx : lines.length;
      pattern = lines.slice(patternIdx + 1, end).filter(l => !l.startsWith('#') && !l.startsWith('━')).join(' ').replace(/\*+/g, '').trim();
    }
  }

  const debateIdx = lines.findIndex(l => l.includes('DEBATE'));
  let debate = '';
  if (debateIdx !== -1) {
    const inlineText = lines[debateIdx]
      .replace(/🗣️\s*/g, '').replace(/\*+DEBATE:\*+\s*/i, '')
      .replace(/DEBATE:\s*/i, '').replace(/\*+/g, '').trim();
    if (inlineText) {
      debate = inlineText;
    } else {
      debate = lines.slice(debateIdx + 1).filter(l => !l.startsWith('#') && !l.startsWith('━')).join(' ').replace(/\*+/g, '').trim();
    }
  }

  // Validación
  const issues = [];
  news.forEach((item, i) => {
    if (!item.title)   issues.push(`Noticia ${i + 1}: falta título`);
    if (!item.summary) issues.push(`Noticia ${i + 1}: falta resumen (Lo clave:)`);
    if (item.bullets.filter(b => b !== '—').length < 3) issues.push(`Noticia ${i + 1}: menos de 3 bullets ✅`);
  });
  if (!pattern) issues.push('Falta el bloque 💡 EL PATRÓN DE HOY');
  if (!debate)  issues.push('Falta el bloque 🗣️ DEBATE');
  if (issues.length > 0) throw new Error(issues.join('\n'));

  return { theme, date: datePart, news, pattern, debate };
}

function clampSecs(val, min, max, def) {
  const n = parseFloat(val);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// ─── Rutas ─────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

// Servir videos generados
app.use('/videos', express.static(OUTPUT_DIR));
// Servir assets públicos (logos, etc.)
app.use('/public', express.static(join(__dirname, 'public')));

// ── POST /render  —  inicia un job de render ───────────────────────────────────
app.post('/render', async (req, res) => {
  const { briefing, theme, secsPerNews, secsOutroCards } = req.body;

  if (!briefing || !theme) {
    return res.status(400).json({ error: 'Faltan campos: briefing y theme son requeridos.' });
  }

  let data;
  try {
    data = parseBriefing(briefing, theme);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  data.secsPerNews    = clampSecs(secsPerNews,    5, 60, 7);
  data.secsOutroCards = clampSecs(secsOutroCards, 5, 60, 10);

  const jobId = randomUUID();
  const filename = `video-${theme}-${new Date().toISOString().slice(0, 10)}-${jobId.slice(0, 8)}.mp4`;
  const outputPath = join(OUTPUT_DIR, filename);

  jobs.set(jobId, { progress: 0, status: 'bundling', filename, error: null, data });

  // Render en background (no bloqueamos la respuesta)
  (async () => {
    try {
      const job = jobs.get(jobId);
      job.status = 'bundling';

      const bundleLocation = await bundle({
        entryPoint: resolve(__dirname, 'src/index.ts'),
        webpackOverride: (config) => config,
      });

      job.status = 'rendering';

      const composition = await selectComposition({
        serveUrl: bundleLocation,
        id: 'NewsVideo',
        inputProps: { data },
      });

      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps: { data },
        onProgress: ({ progress }) => {
          job.progress = Math.round(progress * 100);
        },
      });

      job.status = 'done';
      job.progress = 100;
    } catch (err) {
      const job = jobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
      console.error('[render error]', err.message);
    }
  })();

  res.json({ jobId });
});

// ── POST /generate-briefing  —  Genera briefing desde URLs usando Claude ──────
app.post('/generate-briefing', async (req, res) => {
  const { urls, theme } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length !== 3) {
    return res.status(400).json({ error: 'Se requieren exactamente 3 URLs.' });
  }

  // 1. Fetch each URL and strip HTML
  const stripHtml = (html) => html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ').trim();

  let articleTexts;
  try {
    articleTexts = await Promise.all(urls.map(async (url, i) => {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`URL ${i + 1}: HTTP ${resp.status}`);
      const html = await resp.text();
      const text = stripHtml(html).slice(0, 6000); // limit per article
      if (text.length < 100) throw new Error(`URL ${i + 1}: contenido muy corto o inaccesible`);
      return { url, text };
    }));
  } catch (err) {
    return res.status(400).json({ error: `Error al obtener las URLs: ${err.message}` });
  }

  // 2. Build theme display names
  const THEME_NAMES = { insaights: 'INSAIGHTS', h2newsweb: 'H2NEWSWEB' };
  const themeLabel = THEME_NAMES[theme] || 'INSAIGHTS';
  const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  // 3. Call the configured AI service
  const prompt = `Sos un editor de noticias profesional. Vas a generar un briefing de noticias en español en un formato exacto.

El briefing debe seguir EXACTAMENTE este formato (sin modificarlo):

**BRIEFING ${themeLabel}** | ${today}

1️⃣ **[Título conciso y atractivo de la noticia 1]**
* **Lo clave:** [Resumen en 1-2 frases, directo al punto]
* ✅ [Dato o consecuencia clave]
* ✅ [Otro dato o implicación]
* ✅ [Tercer dato relevante]

2️⃣ **[Título conciso y atractivo de la noticia 2]**
* **Lo clave:** [Resumen en 1-2 frases, directo al punto]
* ✅ [Dato o consecuencia clave]
* ✅ [Otro dato o implicación]
* ✅ [Tercer dato relevante]

3️⃣ **[Título conciso y atractivo de la noticia 3]**
* **Lo clave:** [Resumen en 1-2 frases, directo al punto]
* ✅ [Dato o consecuencia clave]
* ✅ [Otro dato o implicación]
* ✅ [Tercer dato relevante]

💡 **EL PATRÓN DE HOY:** [Una frase que conecta las 3 noticias con un patrón o tendencia común]
🗣️ **DEBATE:** [Una pregunta abierta que invite a la reflexión o discusión sobre las noticias]

REGLAS ESTRICTAS:
- Usá SOLO información de los artículos provistos. No inventes ni agregues nada.
- Respetá los emojis exactos: 1️⃣ 2️⃣ 3️⃣ 💡 🗣️ ✅
- Los títulos van en negrita con **
- "Lo clave:" va en negrita con **
- "EL PATRÓN DE HOY:" y "DEBATE:" van en negrita con **
- No agregues texto adicional antes ni después del briefing
- No incluyas introducciones, explicaciones ni reflexiones/razonamientos internos. Genera directamente el briefing formateado.

Artículos:

ARTÍCULO 1 (${articleTexts[0].url}):
${articleTexts[0].text}

ARTÍCULO 2 (${articleTexts[1].url}):
${articleTexts[1].text}

ARTÍCULO 3 (${articleTexts[2].url}):
${articleTexts[2].text}`;

  try {
    const briefing = await callAI(prompt);
    writeFileSync(join(__dirname, 'briefing-generado.txt'), briefing, 'utf-8');
    res.json({ briefing });
  } catch (err) {
    res.status(500).json({ error: `Error al generar el briefing: ${err.message}` });
  }
});

// ── GET /status/:id  —  Server-Sent Events para progreso en tiempo real ────────
app.get('/status/:id', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const interval = setInterval(() => {
    const job = jobs.get(id);
    if (!job) { send({ status: 'not_found' }); clearInterval(interval); res.end(); return; }

    send({ status: job.status, progress: job.progress, filename: job.filename, error: job.error });

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      setTimeout(() => res.end(), 500);
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

// ── GET /open-folder  —  abre la carpeta de videos en el explorador ───────────
app.get('/open-folder', (req, res) => {
  spawn('explorer.exe', [OUTPUT_DIR], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
});

// ── GET /api/settings  —  estado actual ───────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const s = loadSettings();
  const masked = (v) => v && !v.includes('REEMPLAZAR') ? v.slice(0, 8) + '••••••••' : null;
  res.json({
    service: s.service,
    configured: {
      anthropic:   !!process.env.ANTHROPIC_API_KEY   && !process.env.ANTHROPIC_API_KEY.includes('REEMPLAZAR'),
      openrouter:  !!process.env.OPENROUTER_API_KEY  && !process.env.OPENROUTER_API_KEY.includes('REEMPLAZAR'),
      ollama:      !!process.env.OLLAMA_API_KEY       && !process.env.OLLAMA_API_KEY.includes('REEMPLAZAR'),
    },
    models: {
      openrouter: process.env.OPENROUTER_MODEL || '',
      ollama:     process.env.OLLAMA_MODEL     || '',
    },
    keys: {
      anthropic:  masked(process.env.ANTHROPIC_API_KEY),
      openrouter: masked(process.env.OPENROUTER_API_KEY),
      ollama_url: process.env.OLLAMA_API_URL && !process.env.OLLAMA_API_URL.includes('REEMPLAZAR') ? process.env.OLLAMA_API_URL : null,
    },
  });
});

// ── POST /api/settings  —  guardar servicio activo ────────────────────────────
app.post('/api/settings', (req, res) => {
  const { service } = req.body;
  if (!['anthropic', 'openrouter', 'ollama'].includes(service)) {
    return res.status(400).json({ error: 'Servicio inválido.' });
  }
  saveSettings({ service });
  res.json({ ok: true });
});

// ── GET /settings  —  página de configuración ─────────────────────────────────
app.get('/settings', (req, res) => res.send(SETTINGS_HTML));

// ── GET /  —  UI ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(UI_HTML);
});

// ─── Settings HTML ────────────────────────────────────────────────────────────
const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Configuración — News Video Generator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0F0F1A;
      color: #E8E8F0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
    }
    .container { width: 100%; max-width: 560px; }

    .header { text-align: center; margin-bottom: 36px; }
    .header h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    .header p { font-size: 14px; color: #9090A8; }

    .card {
      background: #1A1A2E;
      border: 2px solid #2A2A3E;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
      cursor: pointer;
      transition: all 0.18s;
      position: relative;
    }
    .card:hover { border-color: #4A4A6E; }
    .card.active-anthropic  { border-color: #7B35E8; background: #7B35E810; }
    .card.active-openrouter { border-color: #F4A261; background: #F4A26110; }
    .card.active-ollama     { border-color: #52C878; background: #52C87810; }

    .card-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 12px;
    }
    .card-icon { font-size: 28px; }
    .card-title { font-size: 16px; font-weight: 800; }
    .card-subtitle { font-size: 12px; color: #6060A0; margin-top: 2px; }

    .active-badge {
      display: none;
      margin-left: auto;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 99px;
      letter-spacing: 0.5px;
    }
    .card.active-anthropic  .active-badge { display: block; background: #7B35E830; color: #A870FF; }
    .card.active-openrouter .active-badge { display: block; background: #F4A26130; color: #F4C87F; }
    .card.active-ollama     .active-badge { display: block; background: #52C87830; color: #80E8A0; }

    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.ok  { background: #52C878; box-shadow: 0 0 6px #52C87880; }
    .dot.err { background: #FF6060; }

    .key-value { color: #6060A0; font-family: monospace; margin-left: auto; font-size: 11px; }

    .model-row {
      margin-top: 10px;
      font-size: 12px;
      color: #6060A0;
    }
    .model-row span { color: #A0A0C0; font-family: monospace; }

    .env-hint {
      background: #12122A;
      border: 1px solid #2A2A3E;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 12px;
      color: #6060A0;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .env-hint code {
      color: #A870FF;
      background: #2A1A4A;
      padding: 1px 6px;
      border-radius: 4px;
      font-family: monospace;
    }

    .open-btn {
      display: block;
      width: 100%;
      padding: 16px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #7B35E8, #5B15C8);
      color: white;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.18s;
      text-align: center;
      text-decoration: none;
      margin-top: 8px;
    }
    .open-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 32px #7B35E840; }

    .save-status { text-align: center; font-size: 13px; color: #52C878; min-height: 20px; margin-top: 12px; }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>⚙️ Configuración</h1>
    <p>Elegí el servicio de IA para generar briefings</p>
  </div>

  <div class="env-hint">
    Las API keys se leen del archivo <code>.env</code> en la carpeta del proyecto.<br>
    Ruta: <code>C:\\Users\\elgon\\.claude\\Sandbox\\Noticias en video\\.env</code>
  </div>

  <div id="cards-container">
    <!-- Cards se generan con JS -->
  </div>

  <div class="save-status" id="save-status"></div>

  <a class="open-btn" href="/">🎬 Abrir generador de videos</a>
</div>

<script>
  let currentService = 'anthropic';

  const SERVICES = [
    {
      id: 'anthropic',
      icon: '🤖',
      title: 'Anthropic Claude',
      subtitle: 'claude-haiku-4-5 · Rápido y preciso',
      activeClass: 'active-anthropic',
    },
    {
      id: 'openrouter',
      icon: '🔀',
      title: 'OpenRouter',
      subtitle: 'Acceso a múltiples modelos',
      activeClass: 'active-openrouter',
    },
    {
      id: 'ollama',
      icon: '🦙',
      title: 'Ollama (cloud)',
      subtitle: 'Modelo propio en la nube',
      activeClass: 'active-ollama',
    },
  ];

  async function loadSettings() {
    const data = await fetch('/api/settings').then(r => r.json());
    currentService = data.service;
    renderCards(data);
  }

  function renderCards(data) {
    const container = document.getElementById('cards-container');
    container.innerHTML = SERVICES.map(s => {
      const isActive = s.id === data.service;
      const ok = data.configured[s.id];
      let statusText = ok ? 'API configurada' : 'API no configurada — completá el .env';
      let keyText = '';
      let modelText = '';

      if (s.id === 'anthropic' && data.keys.anthropic)
        keyText = data.keys.anthropic;
      if (s.id === 'openrouter') {
        if (data.keys.openrouter) keyText = data.keys.openrouter;
        if (data.models.openrouter) modelText = 'Modelo: <span>' + data.models.openrouter + '</span>';
      }
      if (s.id === 'ollama') {
        if (data.keys.ollama_url) keyText = data.keys.ollama_url.replace(/^https?:\\/\\//, '').slice(0, 30) + '…';
        if (data.models.ollama) modelText = 'Modelo: <span>' + data.models.ollama + '</span>';
      }

      return \`
        <div class="card \${isActive ? s.activeClass : ''}" onclick="selectService('\${s.id}')">
          <div class="card-header">
            <span class="card-icon">\${s.icon}</span>
            <div>
              <div class="card-title">\${s.title}</div>
              <div class="card-subtitle">\${s.subtitle}</div>
            </div>
            <span class="active-badge">ACTIVO</span>
          </div>
          <div class="status-row">
            <span class="dot \${ok ? 'ok' : 'err'}"></span>
            <span>\${statusText}</span>
            \${keyText ? '<span class="key-value">' + keyText + '</span>' : ''}
          </div>
          \${modelText ? '<div class="model-row">' + modelText + '</div>' : ''}
        </div>
      \`;
    }).join('');
  }

  async function selectService(id) {
    if (id === currentService) return;
    currentService = id;

    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: id }),
    });

    document.getElementById('save-status').textContent = '✅ Guardado';
    setTimeout(() => document.getElementById('save-status').textContent = '', 2000);
    loadSettings();
  }

  loadSettings();
</script>
</body>
</html>`;

// ─── UI HTML ───────────────────────────────────────────────────────────────────
const UI_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NVG Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent:        #7B35E8;
      --accent-light:  #A870FF;
      --accent-end:    #3B0EA0;
      --accent-glow:   rgba(123,53,232,0.25);
      --accent-dim:    rgba(123,53,232,0.08);
      --accent-border: rgba(123,53,232,0.35);
      --bg-base:    #07071A;
      --bg-sidebar: #0B0B1E;
      --bg-card:    #0E0E23;
      --bg-card2:   #121228;
      --border:        rgba(255,255,255,0.065);
      --border-subtle: rgba(255,255,255,0.04);
      --text-primary:   #EEEEFF;
      --text-secondary: #8080A0;
      --text-dim:       #44445A;
      --sidebar-w: 240px;
      --r-xl: 16px;
      --r-lg: 12px;
      --r-md: 8px;
      --spring: cubic-bezier(0.32, 0.72, 0, 1);
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg-base);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      overflow-x: hidden;
      font-size: 14px;
    }

    /* ──────────── SIDEBAR ────────────────────────────── */
    .sidebar {
      width: var(--sidebar-w);
      min-height: 100vh;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      position: fixed;
      left: 0; top: 0;
      z-index: 100;
      overflow: hidden;
    }
    .sidebar::before {
      content: '';
      position: absolute;
      bottom: -80px; left: -80px;
      width: 280px; height: 280px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
      pointer-events: none;
    }

    .sidebar-brand {
      padding: 20px 20px 16px;
      border-bottom: 1px solid var(--border-subtle);
      position: relative;
    }
    .brand-inner {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .brand-gem {
      width: 32px; height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent) 0%, #3B0EA0 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 18px var(--accent-glow);
      flex-shrink: 0;
    }
    .brand-name {
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.3px;
      color: var(--text-primary);
    }
    .brand-name em { font-style: normal; color: var(--accent-light); }
    .brand-sub {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-dim);
      margin-top: 2px;
    }

    .sidebar-nav {
      flex: 1;
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-y: auto;
      position: relative;
    }

    .nav-group-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-dim);
      padding: 10px 10px 6px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: var(--r-md);
      cursor: pointer;
      transition: background 0.22s var(--spring), color 0.22s var(--spring);
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 600;
      position: relative;
      user-select: none;
    }
    .nav-item:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
    .nav-item.active { background: rgba(255,255,255,0.07); color: #EEEEFF; }
    .nav-item.active::before {
      content: '';
      position: absolute;
      left: 0; top: 50%;
      transform: translateY(-50%);
      width: 3px; height: 16px;
      border-radius: 0 3px 3px 0;
      background: rgba(255,255,255,0.3);
    }

    .nav-swatch {
      width: 22px; height: 22px;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-card2);
      flex-shrink: 0;
      transition: background 0.22s var(--spring);
      font-size: 13px;
    }
    .nav-item.active .nav-swatch { background: rgba(255,255,255,0.1); }

    .nav-swatch-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
    }

    .nav-divider {
      height: 1px;
      background: var(--border-subtle);
      margin: 6px 0;
    }

    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }

    .service-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--bg-card2);
      border-radius: var(--r-md);
      border: 1px solid var(--border);
    }
    .service-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #52C878;
      box-shadow: 0 0 6px #52C87888;
      flex-shrink: 0;
    }
    .service-dot.bad { background: #FF6060; box-shadow: 0 0 6px #FF606088; }
    .service-name { font-size: 12px; font-weight: 600; color: var(--text-secondary); }

    .footer-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--r-md);
      background: none;
      border: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s var(--spring);
      font-family: inherit;
      width: 100%;
      text-align: left;
    }
    .footer-btn:hover {
      color: var(--text-primary);
      background: rgba(255,255,255,0.04);
      border-color: rgba(255,255,255,0.12);
    }

    /* ──────────── MAIN ───────────────────────────────── */
    .main {
      margin-left: var(--sidebar-w);
      flex: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ──────────── CHANNEL CONTENT ────────────────────── */
    #channel-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    #channel-content.hidden { display: none; }

    /* ──────────── CHANNEL HERO ───────────────────────── */
    .channel-hero {
      display: none;
      padding: 24px 40px 18px;
      position: relative;
      overflow: hidden;
    }
    .channel-hero.visible { display: block; }
    .channel-hero::after {
      content: '';
      position: absolute;
      top: -120px; right: -120px;
      width: 550px; height: 550px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 65%);
      pointer-events: none;
    }

    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 99px;
      background: var(--accent-dim);
      border: 1px solid var(--accent-border);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--accent-light);
      margin-bottom: 12px;
    }

    .hero-title {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.8px;
      line-height: 1.1;
      margin-bottom: 8px;
    }
    .hero-title .hl { color: var(--accent-light); }
    .hero-sub { font-size: 15px; color: var(--text-secondary); font-weight: 500; }

    /* ──────────── PAGE CONTENT ───────────────────────── */
    .page-content {
      padding: 0 40px 36px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 920px;
    }

    /* ──────────── DOUBLE-BEZEL CARD ──────────────────── */
    .card-shell {
      background: rgba(255,255,255,0.025);
      border: 1px solid var(--border);
      border-radius: var(--r-xl);
      padding: 4px;
    }
    .card-core {
      background: var(--bg-card);
      border-radius: calc(var(--r-xl) - 4px);
      border: 1px solid var(--border-subtle);
      box-shadow: inset 0 1px 1px rgba(255,255,255,0.035);
      overflow: hidden;
    }

    /* ──────────── TABS ───────────────────────────────── */
    .input-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      padding: 0 6px;
    }
    .tab {
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-dim);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: color 0.2s var(--spring), border-color 0.2s var(--spring);
      user-select: none;
      white-space: nowrap;
    }
    .tab:hover { color: var(--text-secondary); }
    .tab.active { color: var(--accent-light); border-bottom-color: var(--accent-light); }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    textarea {
      width: 100%;
      min-height: 200px;
      padding: 16px 18px;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 14px;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      font-family: 'Menlo', 'Consolas', monospace;
    }

    /* Upload zone */
    .upload-zone {
      margin: 16px;
      border: 2px dashed rgba(255,255,255,0.08);
      border-radius: var(--r-lg);
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.22s var(--spring);
    }
    .upload-zone:hover, .upload-zone.drag-over {
      border-color: var(--accent-border);
      background: var(--accent-dim);
    }
    .upload-icon { font-size: 36px; margin-bottom: 8px; }
    .upload-text { font-size: 14px; color: var(--text-secondary); line-height: 1.5; }
    .upload-text strong { color: var(--text-primary); }

    .file-loaded {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px;
    }
    .file-loaded-icon { font-size: 24px; }
    .file-loaded-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .file-loaded-size { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
    .file-clear {
      margin-left: auto; background: none;
      border: 1px solid var(--border); border-radius: var(--r-md);
      color: var(--text-secondary); font-size: 13px; cursor: pointer;
      padding: 4px 8px; transition: all 0.15s; font-family: inherit;
    }
    .file-clear:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
    #file-input { display: none; }

    /* URL panel */
    .urls-panel { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .url-field { display: flex; flex-direction: column; gap: 4px; }
    .url-label {
      font-size: 11px; font-weight: 700;
      color: var(--text-dim); letter-spacing: 0.12em; text-transform: uppercase;
    }
    .url-input {
      width: 100%; padding: 8px 12px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border); border-radius: var(--r-md);
      color: var(--text-primary); font-size: 14px; outline: none;
      transition: border-color 0.2s var(--spring);
      font-family: 'Menlo', 'Consolas', monospace;
    }
    .url-input:focus { border-color: var(--accent-border); }
    .url-input::placeholder { color: var(--text-dim); }

    /* ──────────── BUTTONS ────────────────────────────── */
    .btn-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .btn-ai {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px 8px 16px;
      border-radius: 99px; border: none;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-end) 100%);
      color: white; font-size: 14px; font-weight: 700;
      cursor: pointer; transition: all 0.3s var(--spring);
      box-shadow: 0 4px 20px var(--accent-glow);
      font-family: inherit;
    }
    .btn-ai:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 7px 28px var(--accent-glow); }
    .btn-ai:active:not(:disabled) { transform: scale(0.97); }
    .btn-ai:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-ai-icon {
      width: 20px; height: 20px; border-radius: 50%;
      background: rgba(0,0,0,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; transition: transform 0.3s var(--spring);
    }
    .btn-ai:hover .btn-ai-icon { transform: translateX(2px) translateY(-1px) scale(1.08); }

    .gen-status {
      font-size: 13px; color: var(--text-secondary); min-height: 20px;
    }
    .gen-status.error { color: #FF7070; }
    .gen-status.success { color: #52C878; }

    /* Parse preview */
    .parse-preview {
      display: none; padding: 12px 16px;
      background: rgba(82,200,120,0.06);
      border: 1px solid rgba(82,200,120,0.2);
      border-radius: var(--r-lg);
      font-size: 13px; line-height: 1.6; color: #80C880;
    }
    .parse-preview.visible { display: block; }
    .parse-preview .label { color: #508050; font-weight: 600; margin-right: 6px; }

    /* ──────────── TIMING ─────────────────────────────── */
    .timing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      align-items: stretch;
    }
    .timing-cell {
      padding: 16px 18px;
      border-right: 1px solid var(--border-subtle);
    }
    .timing-cell:last-child { border-right: none; }
    .timing-lbl {
      display: block; font-size: 11px; font-weight: 700;
      color: var(--text-dim); letter-spacing: 0.12em; text-transform: uppercase;
      margin-bottom: 8px;
    }
    .timing-inp-wrap { display: flex; align-items: center; gap: 6px; }
    .timing-inp {
      width: 56px; padding: 6px 8px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border); border-radius: var(--r-md);
      color: var(--text-primary); font-size: 22px; font-weight: 800;
      text-align: center; outline: none;
      transition: border-color 0.2s var(--spring); font-family: inherit;
    }
    .timing-inp:focus { border-color: var(--accent-border); }
    .timing-unit { font-size: 14px; color: var(--text-dim); font-weight: 600; }
    .timing-hint { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
    .timing-total-val {
      font-size: 32px; font-weight: 800; color: var(--accent-light); margin-top: 4px;
    }

    /* ──────────── RENDER CTA ─────────────────────────── */
    .render-cta {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px;
    }
    .cta-label { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px; }
    .cta-sub { font-size: 13px; color: var(--text-secondary); }

    .btn-render {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 10px 16px 10px 20px;
      border-radius: 99px; border: none;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-end) 100%);
      color: white; font-size: 15px; font-weight: 800;
      cursor: pointer; transition: all 0.35s var(--spring);
      box-shadow: 0 6px 28px var(--accent-glow);
      font-family: inherit; white-space: nowrap;
    }
    .btn-render:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 36px var(--accent-glow); }
    .btn-render:active:not(:disabled) { transform: scale(0.97); }
    .btn-render:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-render-icon {
      width: 24px; height: 24px; border-radius: 50%;
      background: rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; transition: transform 0.35s var(--spring);
    }
    .btn-render:hover .btn-render-icon { transform: translateX(3px) translateY(-1px) scale(1.08); }

    /* ──────────── PROGRESS ───────────────────────────── */
    .progress-panel {
      display: none; flex-direction: column; gap: 12px;
      padding: 0 20px 16px;
    }
    .progress-panel.visible { display: flex; }

    .progress-hdr {
      display: flex; align-items: center; justify-content: space-between;
    }
    .progress-status { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .progress-pct { font-size: 13px; font-weight: 800; color: var(--accent-light); }

    .progress-track {
      height: 4px; background: rgba(255,255,255,0.06);
      border-radius: 99px; overflow: hidden;
    }
    .progress-fill {
      height: 100%; border-radius: 99px;
      background: linear-gradient(90deg, var(--accent), var(--accent-light));
      transition: width 0.4s var(--spring); width: 0%;
    }

    .progress-steps { display: flex; gap: 6px; }
    .step {
      flex: 1; padding: 6px 8px;
      border-radius: var(--r-md);
      background: rgba(255,255,255,0.025);
      text-align: center; font-size: 12px; font-weight: 600;
      color: var(--text-dim); transition: all 0.28s var(--spring);
      border: 1px solid transparent;
    }
    .step.active {
      background: var(--accent-dim); color: var(--accent-light);
      border-color: var(--accent-border);
    }
    .step.done {
      background: rgba(82,200,120,0.1); color: #52C878;
      border-color: rgba(82,200,120,0.25);
    }

    .error-msg {
      display: none; padding: 10px 14px;
      border-radius: var(--r-lg);
      background: rgba(255,80,80,0.08);
      border: 1px solid rgba(255,80,80,0.2);
      color: #FF7070; font-size: 13px;
      white-space: pre-line; line-height: 1.5;
    }
    .error-msg.visible { display: block; }

    .download-btn {
      display: none; padding: 10px 16px;
      border-radius: var(--r-lg);
      border: 1px solid rgba(82,200,120,0.3);
      font-size: 14px; font-weight: 700; cursor: pointer;
      background: rgba(82,200,120,0.08); color: #52C878;
      text-decoration: none; text-align: center;
      transition: all 0.2s var(--spring);
    }
    .download-btn:hover { background: rgba(82,200,120,0.15); }
    .download-btn.visible { display: block; }

    /* ──────────── PREVIEW PAGE ───────────────────────── */
    #page-preview {
      display: none;
      flex-direction: column;
      height: 100vh;
    }
    #page-preview.visible { display: flex; }
    #page-preview iframe {
      flex: 1; width: 100%; border: none;
    }

    /* ──────────── SCROLLBAR ──────────────────────────── */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
  </style>
</head>
<body>

<!-- ──────────────────── SIDEBAR ──────────────────────────── -->
<aside class="sidebar">
  <div class="sidebar-brand">
    <div class="brand-inner">
      <div class="brand-gem">🎬</div>
      <div>
        <div class="brand-name">NVG <em>Studio</em></div>
        <div class="brand-sub">News Video Generator</div>
      </div>
    </div>
  </div>

  <nav class="sidebar-nav">
    <div class="nav-group-label">Canales</div>

    <div class="nav-item active" id="nav-insaights" onclick="selectPage('insaights')">
      <div class="nav-swatch">
        <span class="nav-swatch-dot" style="background:#7B35E8"></span>
      </div>
      InsAIghts — IA
    </div>

    <div class="nav-item" id="nav-h2newsweb" onclick="selectPage('h2newsweb')">
      <div class="nav-swatch">
        <span class="nav-swatch-dot" style="background:#3BA8C8"></span>
      </div>
      H2NewsWeb — H&#x2082;
    </div>

    <div class="nav-divider"></div>
    <div class="nav-group-label">Herramientas</div>

    <div class="nav-item" id="nav-preview" onclick="selectPage('preview')">
      <div class="nav-swatch">&#x1F441;</div>
      Preview Studio
    </div>
  </nav>

  <div class="sidebar-footer">
    <div class="service-badge">
      <div class="service-dot" id="service-dot"></div>
      <span class="service-name" id="service-name">Cargando...</span>
    </div>
    <a href="/settings" class="footer-btn">&#x2699;&#xFE0F; Configuraci&#xF3;n IA</a>
    <button class="footer-btn" onclick="fetch('/open-folder').catch(()=>{})">&#x1F4C1; Carpeta de videos</button>
  </div>
</aside>

<!-- ──────────────────── MAIN ─────────────────────────────── -->
<main class="main">

  <!-- Channel content (InsAIghts / H2NewsWeb shared form) -->
  <div id="channel-content">

    <!-- Hero area switches between channels -->
    <div id="hero-insaights" class="channel-hero visible" style="background:linear-gradient(160deg,#0C071E 0%,#0F0925 100%)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:24px">
        <div>
          <div class="hero-eyebrow">
            <span style="width:6px;height:6px;border-radius:50%;background:#7B35E8;display:inline-block;flex-shrink:0"></span>
            Canal &middot; Inteligencia Artificial
          </div>
          <h1 class="hero-title">Ins<span class="hl">AI</span>ghts</h1>
          <p class="hero-sub">Noticias de IA en video para LinkedIn. Peg&#xE1; el briefing y gener&#xE1;.</p>
        </div>
        <img src="/public/logo-insaights.png" alt="InsAIghts" style="height:80px;width:auto;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 0 20px rgba(123,53,232,0.5))">
      </div>
    </div>

    <div id="hero-h2newsweb" class="channel-hero" style="background:linear-gradient(160deg,#051A0A 0%,#081F0D 100%)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:24px">
        <div>
          <div class="hero-eyebrow">
            <span style="width:6px;height:6px;border-radius:50%;background:#52B788;display:inline-block;flex-shrink:0"></span>
            Canal &middot; Hidr&#xF3;geno Verde
          </div>
          <h1 class="hero-title">H2<span style="color:#52B788">News</span>Web</h1>
          <p class="hero-sub">Noticias de H&#x2082; verde en video para LinkedIn.</p>
        </div>
        <img src="/public/logo-h2newsweb.png" alt="H2NewsWeb" style="height:80px;width:auto;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 0 20px rgba(82,183,136,0.4)) brightness(1.1)">
      </div>
    </div>

    <!-- Shared form -->
    <div class="page-content">

      <!-- Briefing input -->
      <div class="card-shell">
        <div class="card-core">
          <div class="input-tabs">
            <div class="tab active" id="tab-paste" onclick="switchTab('paste')">&#x270F;&#xFE0F; Pegar texto</div>
            <div class="tab" id="tab-file" onclick="switchTab('file')">&#x1F4C1; Archivo</div>
            <div class="tab" id="tab-urls" onclick="switchTab('urls')">&#x1F517; Desde URLs</div>
          </div>

          <div class="tab-panel active" id="panel-paste">
            <textarea id="briefing-text" placeholder="&#x1F4F0; **BRIEFING INSAIGHTS** | 12 de junio, 2026&#10;&#10;1&#xFE0F;&#x20E3; **T&#xED;tulo de la noticia...**&#10;* **Lo clave:** Resumen en dos frases.&#10;* &#x2705; Bullet 1&#10;* &#x2705; Bullet 2&#10;* &#x2705; Bullet 3&#10;...&#10;&#10;&#x1F4A1; **EL PATR&#xD3;N DE HOY:** An&#xE1;lisis del patr&#xF3;n.&#10;&#x1F5E3;&#xFE0F; **DEBATE:** Pregunta de debate."></textarea>
          </div>

          <div class="tab-panel" id="panel-file">
            <div class="upload-zone" id="upload-zone"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event)"
                 onclick="document.getElementById('file-input').click()">
              <div class="upload-icon">&#x1F4C4;</div>
              <div class="upload-text">
                Arrastr&#xE1; el archivo ac&#xE1; o <strong>hac&#xE9; clic para elegir</strong><br>
                <span style="font-size:12px;margin-top:6px;display:block">Formatos: .txt &middot; .md</span>
              </div>
            </div>
            <div class="file-loaded" id="file-loaded" style="display:none">
              <span class="file-loaded-icon">&#x1F4C4;</span>
              <div>
                <div class="file-loaded-name" id="file-loaded-name"></div>
                <div class="file-loaded-size" id="file-loaded-size"></div>
              </div>
              <button class="file-clear" onclick="clearFile()">&#x2715;</button>
            </div>
            <input type="file" id="file-input" accept=".txt,.md" onchange="handleFileSelect(event)">
          </div>

          <div class="tab-panel" id="panel-urls">
            <div class="urls-panel">
              <div class="url-field">
                <label class="url-label">Noticia 1</label>
                <input type="url" id="url-1" class="url-input" placeholder="https://..." autocomplete="off">
              </div>
              <div class="url-field">
                <label class="url-label">Noticia 2</label>
                <input type="url" id="url-2" class="url-input" placeholder="https://..." autocomplete="off">
              </div>
              <div class="url-field">
                <label class="url-label">Noticia 3</label>
                <input type="url" id="url-3" class="url-input" placeholder="https://..." autocomplete="off">
              </div>
              <div class="btn-row">
                <button class="btn-ai" id="gen-briefing-btn" onclick="generateBriefing()">
                  Generar briefing con IA
                  <div class="btn-ai-icon">&#x2728;</div>
                </button>
                <span class="gen-status" id="gen-status"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Parse preview -->
      <div class="parse-preview" id="parse-preview"></div>

      <!-- Timing controls -->
      <div class="card-shell">
        <div class="card-core">
          <div class="timing-grid">
            <div class="timing-cell">
              <label class="timing-lbl" for="secs-news">&#x23F1; Segundos por noticia</label>
              <div class="timing-inp-wrap">
                <input type="number" id="secs-news" class="timing-inp" value="7" min="5" max="60" step="1">
                <span class="timing-unit">s</span>
              </div>
              <div class="timing-hint">Cada noticia (&#xD7;3) &middot; m&#xED;n. 5 s</div>
            </div>
            <div class="timing-cell">
              <label class="timing-lbl" for="secs-cards">&#x23F1; Tarjetas outro</label>
              <div class="timing-inp-wrap">
                <input type="number" id="secs-cards" class="timing-inp" value="10" min="5" max="60" step="1">
                <span class="timing-unit">s</span>
              </div>
              <div class="timing-hint">Patr&#xF3;n + Debate &middot; m&#xED;n. 5 s</div>
            </div>
            <div class="timing-cell">
              <div class="timing-lbl">&#x1F4D0; Duraci&#xF3;n estimada</div>
              <div class="timing-total-val" id="total-dur">&#x2014;</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Render CTA -->
      <div class="card-shell">
        <div class="card-core">
          <div class="render-cta">
            <div>
              <div class="cta-label">Generar video</div>
              <div class="cta-sub">Renderiza con Remotion y descarga el MP4</div>
            </div>
            <button class="btn-render" id="render-btn" onclick="startRender()">
              Generar video
              <div class="btn-render-icon">&#x1F3AC;</div>
            </button>
          </div>

          <div class="progress-panel" id="progress-panel">
            <div class="progress-hdr">
              <span class="progress-status" id="progress-status">Iniciando...</span>
              <span class="progress-pct" id="progress-pct">0%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" id="progress-fill"></div>
            </div>
            <div class="progress-steps">
              <div class="step" id="step-parse">&#x2713; Parseo</div>
              <div class="step" id="step-bundle">&#x1F4E6; Bundle</div>
              <div class="step" id="step-render">&#x1F39E; Render</div>
              <div class="step" id="step-done">&#x2705; Listo</div>
            </div>
            <div class="error-msg" id="error-msg"></div>
            <a class="download-btn" id="download-btn" href="#" download>&#x2B07;&#xFE0F; Descargar video MP4</a>
          </div>
        </div>
      </div>

    </div><!-- /page-content -->
  </div><!-- /channel-content -->

  <!-- Preview page -->
  <div id="page-preview">
    <iframe src="http://localhost:4001" title="Remotion Studio"></iframe>
  </div>

</main>

<script>
  let currentTheme = 'insaights';
  let fileContent  = null;

  var THEMES = {
    insaights: {
      accent: '#7B35E8', light: '#A870FF', end: '#3B0EA0',
      glow: 'rgba(123,53,232,0.25)', dim: 'rgba(123,53,232,0.08)',
      border: 'rgba(123,53,232,0.35)'
    },
    h2newsweb: {
      accent: '#52B788', light: '#74D4A4', end: '#1B5C35',
      glow: 'rgba(82,183,136,0.25)', dim: 'rgba(82,183,136,0.08)',
      border: 'rgba(82,183,136,0.35)'
    }
  };

  function showToast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(container);
    }
    
    var toast = document.createElement('div');
    toast.style.cssText = 'padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;color:white;box-shadow:0 8px 24px rgba(0,0,0,0.25);transition:all 0.35s cubic-bezier(0.32, 0.72, 0, 1);opacity:0;transform:translateY(20px);pointer-events:auto;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.05);';
    
    if (type === 'success') {
      toast.style.background = 'linear-gradient(135deg, #1B5C35 0%, #123C22 100%)';
      toast.style.borderColor = 'rgba(82,183,136,0.3)';
    } else if (type === 'error') {
      toast.style.background = 'linear-gradient(135deg, #6C1C1C 0%, #4C1313 100%)';
      toast.style.borderColor = 'rgba(255,80,80,0.3)';
    } else {
      toast.style.background = 'linear-gradient(135deg, #1F1F35 0%, #141423 100%)';
      toast.style.borderColor = 'rgba(255,255,255,0.1)';
    }
    
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 10);
    
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(function() {
        toast.remove();
      }, 350);
    }, 5000);
  }

  function applyTheme(key) {
    var t = THEMES[key];
    if (!t) return;
    var s = document.documentElement.style;
    s.setProperty('--accent',        t.accent);
    s.setProperty('--accent-light',  t.light);
    s.setProperty('--accent-end',    t.end);
    s.setProperty('--accent-glow',   t.glow);
    s.setProperty('--accent-dim',    t.dim);
    s.setProperty('--accent-border', t.border);
  }

  function selectPage(page) {
    ['insaights','h2newsweb','preview'].forEach(function(p) {
      document.getElementById('nav-' + p).classList.toggle('active', p === page);
    });

    if (page === 'preview') {
      document.getElementById('channel-content').style.display = 'none';
      document.getElementById('page-preview').classList.add('visible');
      return;
    }

    document.getElementById('channel-content').style.display = 'flex';
    document.getElementById('page-preview').classList.remove('visible');

    document.querySelectorAll('.channel-hero').forEach(function(el) {
      el.classList.remove('visible');
    });
    document.getElementById('hero-' + page).classList.add('visible');

    currentTheme = page;
    applyTheme(page);
  }

  // Load AI service status
  var SERVICE_LABELS = { anthropic: 'Claude (Anthropic)', openrouter: 'OpenRouter', ollama: 'Ollama Cloud' };
  fetch('/api/settings').then(function(r) { return r.json(); }).then(function(d) {
    var name = document.getElementById('service-name');
    var dot  = document.getElementById('service-dot');
    if (name) name.textContent = SERVICE_LABELS[d.service] || d.service;
    var ok = d.configured && d.configured[d.service];
    if (dot && !ok) dot.classList.add('bad');
  }).catch(function() {});

  function updateTotal() {
    var news  = parseFloat(document.getElementById('secs-news').value)  || 7;
    var cards = parseFloat(document.getElementById('secs-cards').value) || 10;
    document.getElementById('total-dur').textContent = (2 + news * 3 + cards + 5).toFixed(0) + ' s';
  }
  document.getElementById('secs-news').addEventListener('input', updateTotal);
  document.getElementById('secs-cards').addEventListener('input', updateTotal);
  updateTotal();

  function switchTab(tab) {
    ['paste','file','urls'].forEach(function(t) {
      document.getElementById('tab-'   + t).className = 'tab'       + (tab === t ? ' active' : '');
      document.getElementById('panel-' + t).className = 'tab-panel' + (tab === t ? ' active' : '');
    });
  }

  function getBriefingText() {
    if (document.getElementById('tab-paste').classList.contains('active'))
      return document.getElementById('briefing-text').value.trim();
    if (document.getElementById('tab-file').classList.contains('active'))
      return fileContent;
    return document.getElementById('briefing-text').value.trim();
  }

  async function generateBriefing() {
    var urls = [
      document.getElementById('url-1').value.trim(),
      document.getElementById('url-2').value.trim(),
      document.getElementById('url-3').value.trim()
    ];
    if (urls.some(function(u) { return !u; })) {
      showToast('⚠️ Por favor completa las 3 URLs.', 'error');
      setGenStatus('Completá las 3 URLs.', 'error');
      return;
    }
    var btn = document.getElementById('gen-briefing-btn');
    btn.disabled = true;
    btn.innerHTML = 'Generando... <div class="btn-ai-icon">⏳</div>';
    showToast('⏳ Generando briefing con IA (suele tardar entre 1 y 2 minutos por el razonamiento del modelo)...', 'info');
    setGenStatus('Obteniendo artículos...', '');

    try {
      var res  = await fetch('/generate-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urls, theme: currentTheme })
      });
      var json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error del servidor');
      
      document.getElementById('briefing-text').value = json.briefing;
      
      // Cambiar a la pestaña de Pegar texto
      switchTab('paste');
      
      showToast('✅ Briefing generado con éxito. ¡Revisalo antes de generar el video!', 'success');
      setGenStatus('✅ Briefing generado con éxito.', 'success');
    } catch (err) {
      showToast('❌ Error: ' + err.message, 'error');
      setGenStatus('❌ ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Generar briefing con IA <div class="btn-ai-icon">✨</div>';
    }
  }

  function setGenStatus(msg, cls) {
    var el = document.getElementById('gen-status');
    el.textContent = msg;
    el.className = 'gen-status' + (cls ? ' ' + cls : '');
  }

  function handleFileSelect(e) { var f = e.target.files[0]; if (f) loadFile(f); }
  function handleDragOver(e)  { e.preventDefault(); document.getElementById('upload-zone').classList.add('drag-over'); }
  function handleDragLeave()  { document.getElementById('upload-zone').classList.remove('drag-over'); }
  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('upload-zone').classList.remove('drag-over');
    var f = e.dataTransfer.files[0]; if (f) loadFile(f);
  }
  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      fileContent = e.target.result;
      document.getElementById('upload-zone').style.display    = 'none';
      document.getElementById('file-loaded').style.display    = 'flex';
      document.getElementById('file-loaded-name').textContent  = file.name;
      document.getElementById('file-loaded-size').textContent  = (file.size / 1024).toFixed(1) + ' KB';
    };
    reader.readAsText(file, 'utf-8');
  }
  function clearFile() {
    fileContent = null;
    document.getElementById('upload-zone').style.display = 'block';
    document.getElementById('file-loaded').style.display = 'none';
    document.getElementById('file-input').value = '';
  }

  async function startRender() {
    var briefing = getBriefingText();
    if (!briefing) { alert('Primer\xE1 peg\xE1 el texto del briefing o sub\xED un archivo.'); return; }

    var renderBtn = document.getElementById('render-btn');
    renderBtn.disabled = true;
    renderBtn.innerHTML = 'Procesando... <div class="btn-render-icon">⏳</div>';

    document.getElementById('progress-panel').classList.add('visible');
    document.getElementById('error-msg').classList.remove('visible');
    document.getElementById('download-btn').classList.remove('visible');
    document.getElementById('parse-preview').classList.remove('visible');
    setStep('parse','active'); setStep('bundle',''); setStep('render',''); setStep('done','');
    setProgress(0, 'Enviando briefing...');

    var jobId;
    try {
      var secsPerNews    = parseFloat(document.getElementById('secs-news').value)  || 7;
      var secsOutroCards = parseFloat(document.getElementById('secs-cards').value) || 10;
      var res  = await fetch('/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing: briefing, theme: currentTheme, secsPerNews: secsPerNews, secsOutroCards: secsOutroCards })
      });
      var json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error del servidor');
      jobId = json.jobId;
    } catch (err) {
      showError(err.message);
      renderBtn.disabled = false;
      renderBtn.innerHTML = 'Generar video <div class="btn-render-icon">🎬</div>';
      return;
    }

    setStep('parse','done'); setStep('bundle','active');
    setProgress(5, 'Preparando bundle...');

    var evtSource = new EventSource('/status/' + jobId);
    evtSource.onmessage = function(e) {
      var d = JSON.parse(e.data);
      if (d.status === 'bundling') {
        setStep('bundle','active'); setProgress(10, 'Compilando...');
      } else if (d.status === 'rendering') {
        setStep('bundle','done'); setStep('render','active');
        var pct = Math.max(10, d.progress);
        setProgress(pct, 'Renderizando... ' + pct + '%');
      } else if (d.status === 'done') {
        setStep('render','done'); setStep('done','done');
        setProgress(100, '\xA1Video listo!');
        var dl = document.getElementById('download-btn');
        dl.href = '/videos/' + d.filename;
        dl.download = d.filename;
        dl.textContent = '⬇️ Descargar ' + d.filename;
        dl.classList.add('visible');
        evtSource.close();
        renderBtn.disabled = false;
        renderBtn.innerHTML = 'Generar otro <div class="btn-render-icon">🎬</div>';
      } else if (d.status === 'error') {
        showError(d.error); evtSource.close();
        renderBtn.disabled = false;
        renderBtn.innerHTML = 'Reintentar <div class="btn-render-icon">🔄</div>';
      }
    };
    evtSource.onerror = function() { evtSource.close(); };
  }

  function setProgress(pct, label) {
    document.getElementById('progress-fill').style.width   = pct + '%';
    document.getElementById('progress-pct').textContent    = pct + '%';
    document.getElementById('progress-status').textContent = label;
  }

  function setStep(id, state) {
    var el = document.getElementById('step-' + id);
    el.className = 'step' + (state ? ' ' + state : '');
  }

  function showError(msg) {
    var el = document.getElementById('error-msg');
    el.textContent = '❌ ' + msg;
    el.classList.add('visible');
    setProgress(0, 'Error');
  }
</script>
</body>
</html>
`;

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬 News Video Generator`);
  console.log(`   Abrir en: http://localhost:${PORT}\n`);
});
