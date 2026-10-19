import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const templateDir = resolve(process.cwd(), 'templates');
const pageInputs = Object.fromEntries(
  readdirSync(templateDir)
    .filter((file) => file.endsWith('.html') && file !== 'account settings.html')
    .map((file) => [file.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''), resolve(templateDir, file)])
);

export default defineConfig({
  base: './',
  plugins: [{
    name: 'copy-static-assets',
    closeBundle() {
      const outputDir = resolve(process.cwd(), 'dist');
      mkdirSync(outputDir, { recursive: true });
      cpSync(resolve(process.cwd(), 'static'), resolve(outputDir, 'static'), { recursive: true });
    }
  }],
  build: {
    rollupOptions: {
      input: { home: resolve(process.cwd(), 'index.html'), ...pageInputs }
    }
  }
});
