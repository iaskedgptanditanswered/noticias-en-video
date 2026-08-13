import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3] || 'output.mp4';

  if (!inputFile) {
    console.error('Usage: node render.mjs <input.json> [output.mp4]');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));

  console.log(`🎬 Rendering "${data.theme}" — ${data.date}`);
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

  console.log(`⏱  Duration: ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(1)}s)`);
  console.log('🖥  Rendering...');

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

  console.log(`\n✅ Done → ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
