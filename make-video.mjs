/**
 * make-video.mjs  —  Parsea un briefing de texto y renderiza el video.
 *
 * USO:
 *   node make-video.mjs <briefing.txt> <theme> [output.mp4]
 *   cat briefing.txt | node make-video.mjs - <theme> [output.mp4]
 *   node make-video.mjs <briefing.txt> <theme> --dry-run    (solo muestra el JSON)
 *
 * TEMAS: insaights | h2newsweb
 *
 * EJEMPLOS:
 *   node make-video.mjs briefing-ai.txt insaights
 *   node make-video.mjs briefing-h2.txt h2newsweb video-h2-$(date +%Y%m%d).mp4
 *   node make-video.mjs briefing-ai.txt insaights --dry-run
 */

import { readFileSync } from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ──────────────────────────────────────────────────────────────────
const [inputArg, themeArg, outputArg] = process.argv.slice(2);

if (!inputArg || !themeArg) {
  console.error('Uso: node make-video.mjs <briefing.txt|-> <insaights|h2newsweb> [output.mp4] [--dry-run]');
  process.exit(1);
}

const VALID_THEMES = ['insaights', 'h2newsweb'];
if (!VALID_THEMES.includes(themeArg)) {
  console.error(`Tema inválido: "${themeArg}". Opciones: ${VALID_THEMES.join(', ')}`);
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const outputFile = (outputArg && !outputArg.startsWith('--'))
  ? outputArg
  : `video-${themeArg}-${new Date().toISOString().slice(0, 10)}.mp4`;

// ─── Leer texto ────────────────────────────────────────────────────────────────
let rawText;
if (inputArg === '-') {
  rawText = readFileSync(0, 'utf-8'); // stdin
} else {
  rawText = readFileSync(inputArg, 'utf-8');
}

// ─── Parser ────────────────────────────────────────────────────────────────────
/**
 * Convierte el briefing en formato texto al NewsData JSON que consume Remotion.
 *
 * Formato de entrada esperado (flexible, tolera variaciones menores):
 *
 *   📰 **BRIEFING ...** | 9 de junio, 2026
 *   1️⃣ **Titular de la noticia**
 *   * **Lo clave:** Resumen en dos frases.
 *   * ✅ Bullet 1
 *   * ✅ Bullet 2
 *   * ✅ Bullet 3
 *   * 🔗 https://...
 *   (repetir para 2️⃣ y 3️⃣)
 *   💡 **EL PATRÓN DE HOY:** Texto del patrón.
 *   🗣️ **DEBATE:** Pregunta del debate.
 */
function parseBriefing(text, theme) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // ── Fecha ────────────────────────────────────────────────────────────────────
  // Busca la primera línea que contenga '|'
  const headerLine = lines.find(l => l.includes('|')) || '';
  const datePart = headerLine.includes('|')
    ? headerLine.split('|').pop().trim().replace(/\*+/g, '').trim()
    : new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Noticias ─────────────────────────────────────────────────────────────────
  const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣'];
  const news = [];

  for (let n = 0; n < 3; n++) {
    const startEmoji = NUM_EMOJIS[n];
    const startIdx = lines.findIndex(l => l.startsWith(startEmoji) || l.includes(startEmoji));
    if (startIdx === -1) throw new Error(`No encontré la noticia ${n + 1}. Revisá el formato del briefing.`);

    // Fin del bloque = inicio del siguiente número o de PATRÓN / DEBATE
    const endIdx = (() => {
      if (n < 2) {
        const next = NUM_EMOJIS[n + 1];
        const idx = lines.findIndex((l, i) => i > startIdx && (l.startsWith(next) || l.includes(next)));
        return idx !== -1 ? idx : lines.length;
      }
      // Para la 3ra noticia, termina en PATRÓN o DEBATE
      const idx = lines.findIndex((l, i) => i > startIdx && (l.includes('PATRÓN') || l.includes('PATRON') || l.includes('DEBATE')));
      return idx !== -1 ? idx : lines.length;
    })();

    const block = lines.slice(startIdx, endIdx);

    // Título: primera línea del bloque, sin emoji y sin **
    const title = block[0]
      .replace(startEmoji, '')
      .replace(/\*+/g, '')
      .trim();

    // Resumen: línea que contiene "Lo clave:" (case-insensitive)
    const summaryLine = block.find(l => /lo clave/i.test(l)) || '';
    const summary = summaryLine
      .replace(/^\*+\s*/, '')
      .replace(/\*+lo clave:\*+\s*/i, '')
      .replace(/lo clave:\s*/i, '')
      .replace(/\*+/g, '')
      .trim();

    // Bullets: líneas con ✅
    const bulletLines = block.filter(l => l.includes('✅'));
    const bullets = bulletLines.slice(0, 3).map(l =>
      l.replace('✅', '').replace(/^\*+\s*/, '').replace(/\*+/g, '').trim()
    );
    // Rellena con guión si faltan bullets (nunca debería pasar, pero por si acaso)
    while (bullets.length < 3) bullets.push('—');

    news.push({ title, summary, bullets: [bullets[0], bullets[1], bullets[2]] });
  }

  // ── Patrón ────────────────────────────────────────────────────────────────────
  const patternIdx = lines.findIndex(l => l.includes('PATRÓN') || l.includes('PATRON'));
  let pattern = '';
  if (patternIdx !== -1) {
    // El texto puede estar en la misma línea (inline) o en la siguiente
    const inlineText = lines[patternIdx]
      .replace(/💡\s*/g, '')
      .replace(/\*+EL PATRÓN DE HOY:\*+\s*/i, '')
      .replace(/\*+EL PATRON DE HOY:\*+\s*/i, '')
      .replace(/EL PATRÓN DE HOY:\s*/i, '')
      .replace(/EL PATRON DE HOY:\s*/i, '')
      .replace(/\*+/g, '')
      .trim();

    if (inlineText) {
      pattern = inlineText;
    } else {
      // Acumula líneas hasta DEBATE o fin
      const debateIdx = lines.findIndex((l, i) => i > patternIdx && l.includes('DEBATE'));
      const end = debateIdx !== -1 ? debateIdx : lines.length;
      pattern = lines.slice(patternIdx + 1, end)
        .filter(l => !l.startsWith('#') && !l.startsWith('━'))
        .join(' ')
        .replace(/\*+/g, '')
        .trim();
    }
  }

  // ── Debate ────────────────────────────────────────────────────────────────────
  const debateIdx = lines.findIndex(l => l.includes('DEBATE'));
  let debate = '';
  if (debateIdx !== -1) {
    const inlineText = lines[debateIdx]
      .replace(/🗣️\s*/g, '')
      .replace(/\*+DEBATE:\*+\s*/i, '')
      .replace(/DEBATE:\s*/i, '')
      .replace(/\*+/g, '')
      .trim();

    if (inlineText) {
      debate = inlineText;
    } else {
      debate = lines.slice(debateIdx + 1)
        .filter(l => !l.startsWith('#') && !l.startsWith('━'))
        .join(' ')
        .replace(/\*+/g, '')
        .trim();
    }
  }

  return { theme, date: datePart, news, pattern, debate };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📄 Parseando briefing...');

  let data;
  try {
    data = parseBriefing(rawText, themeArg);
  } catch (err) {
    console.error('❌ Error al parsear:', err.message);
    process.exit(1);
  }

  // Validación básica
  const issues = [];
  data.news.forEach((item, i) => {
    if (!item.title)   issues.push(`Noticia ${i + 1}: falta título`);
    if (!item.summary) issues.push(`Noticia ${i + 1}: falta resumen (Lo clave:)`);
    if (item.bullets.filter(b => b !== '—').length < 3)
      issues.push(`Noticia ${i + 1}: menos de 3 bullets ✅`);
  });
  if (!data.pattern) issues.push('Falta el bloque 💡 EL PATRÓN DE HOY');
  if (!data.debate)  issues.push('Falta el bloque 🗣️ DEBATE');

  // Mostrar resumen del parse
  console.log('\n────────────────────────────────────────');
  console.log(`📰 Tema  : ${data.theme}`);
  console.log(`📅 Fecha : ${data.date}`);
  data.news.forEach((item, i) =>
    console.log(`  ${i + 1}. ${item.title.slice(0, 60)}${item.title.length > 60 ? '…' : ''}`)
  );
  console.log(`💡 Patrón: ${data.pattern.slice(0, 70)}…`);
  console.log(`🗣️ Debate : ${data.debate.slice(0, 70)}…`);
  console.log('────────────────────────────────────────\n');

  if (issues.length > 0) {
    console.error('⚠️  Problemas detectados en el briefing:');
    issues.forEach(w => console.error(`  · ${w}`));
    console.error('\nCorregí el texto y volvé a correr el script.');
    process.exit(1);
  }

  if (isDryRun) {
    console.log('🔍 Dry run — JSON generado:\n');
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  console.log('📦 Bundling...');
  const bundleLocation = await bundle({
    entryPoint: resolve(__dirname, 'src/index.ts'),
    webpackOverride: (config) => config,
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'NewsVideo',
    inputProps: { data },
  });

  const duration = (composition.durationInFrames / composition.fps).toFixed(1);
  console.log(`⏱  Duración: ${composition.durationInFrames}f (${duration}s)`);
  console.log('🎬 Renderizando...');

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputFile,
    inputProps: { data },
    onProgress: ({ progress }) => {
      process.stdout.write(`\r  ${Math.round(progress * 100)}%`);
    },
  });

  console.log(`\n✅ Listo → ${outputFile}`);
}

main().catch(err => {
  console.error('\n❌', err.message || err);
  process.exit(1);
});
