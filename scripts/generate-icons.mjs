#!/usr/bin/env node
// Gera os ícones do PWA (public/icons/*.png) sem depender de bibliotecas de
// imagem: escreve o PNG na mão (zlib é nativo do Node) e desenha as formas com
// supersampling 4x para as bordas saírem suaves.
//
//   node scripts/generate-icons.mjs
//
// Rode de novo sempre que quiser mudar a identidade visual do app instalado.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

// Paleta do app: emerald-500 → emerald-700 (mesma cor dos botões e do header).
const TOP = [16, 185, 129];
const BOTTOM = [4, 120, 87];
const WHITE = [255, 255, 255];

const SS = 4; // subamostras por eixo (16 amostras por pixel)

// ─── PNG mínimo (RGBA, 8 bits, sem entrelaçamento) ───────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  // 10..12 = compression / filter / interlace = 0

  // Cada scanline é prefixada pelo byte de filtro (0 = None).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1);
    raw[off] = 0;
    rgba.copy(raw, off + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Geometria ────────────────────────────────────────────────────────────────

// Retângulo de cantos arredondados: true se o ponto está dentro.
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const rr = Math.min(r, w / 2, h / 2);
  const cx = Math.min(Math.max(px, x + rr), x + w - rr);
  const cy = Math.min(Math.max(py, y + rr), y + h - rr);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rr * rr;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Desenha o ícone: fundo em degradê verde + três barras brancas crescentes
 * (as mesmas do gráfico da "Visão Geral").
 *
 * @param {number} size    lado do PNG em pixels
 * @param {boolean} maskable  true = fundo sangrando até a borda e glifo menor,
 *                            dentro da zona segura exigida pelo Android
 */
function render(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.225;

  // Caixa do glifo (centralizada).
  const gw = size * (maskable ? 0.5 : 0.62);
  const gh = gw * 0.82;
  const gx = (size - gw) / 2;
  const gy = (size - gh) / 2;

  // Três barras de alturas crescentes, alinhadas pela base.
  const barW = gw * 0.22;
  const gap = (gw - 3 * barW) / 2;
  const bars = [0.46, 0.73, 1.0].map((f, i) => ({
    x: gx + i * (barW + gap),
    y: gy + gh * (1 - f),
    w: barW,
    h: gh * f,
    r: barW * 0.42,
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!inRoundRect(px, py, 0, 0, size, size, radius)) continue;
          bgHits++;
          for (const b of bars) {
            if (inRoundRect(px, py, b.x, b.y, b.w, b.h, b.r)) { fgHits++; break; }
          }
        }
      }

      const total = SS * SS;
      const alpha = bgHits / total;
      const i = (y * size + x) * 4;
      if (alpha === 0) continue; // fora do quadrado arredondado: transparente

      // Degradê vertical do fundo, com as barras brancas por cima.
      const t = y / (size - 1);
      const fg = fgHits / total;
      for (let c = 0; c < 3; c++) {
        const bg = lerp(TOP[c], BOTTOM[c], t);
        rgba[i + c] = Math.round(lerp(bg, WHITE[c], fg / Math.max(alpha, 1e-6)));
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePNG(size, rgba);
}

// ─── Saída ────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-192.png", 192, true],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true], // iOS não recorta: fundo sangrando fica melhor
  ["favicon-32.png", 32, false],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(path.join(OUT_DIR, name), render(size, maskable));
  console.log(`✓ public/icons/${name} (${size}×${size})`);
}
