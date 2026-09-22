import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Security headers — dipasang di dev server & preview.
 * Untuk produksi, pasang header yang sama di host (Netlify `_headers`,
 * Vercel `vercel.json`, atau Nginx).
 */
const securityHeaders: Record<string, string> = {
  // Klikjacking: larang halaman ini di-framing situs lain
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(self), geolocation=(self), midi=(), microphone=(), payment=()",
  // Naikkan isolasi proses untuk memitigasi Spectre terhadap IndexedDB berisi foto
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
  // HSTS hanya efektif di produksi HTTPS — aman disertakan
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const securityHeadersPlugin: Plugin = {
  name: "siplap-security-headers",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
      next();
    });
  },
};

export default defineConfig({
  // Tanda waktu build — disuntikkan sebagai konstanta global `__BUILD_TIME__`
  // (dipakai di LoginPage untuk verifikasi visual "app sudah ke-update").
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"),
  },
  plugins: [
    react(),
    tailwindcss(),
    securityHeadersPlugin,
    VitePWA({
      // Custom service worker (src/sw.ts) untuk offline queue + push notification
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // "prompt" = SW baru menunggu sampai user menekan tombol Perbarui di
      // UpdateToast (pesan SKIP_WAITING dari appUpdate.ts). "autoUpdate" salah
      // untuk alur tombol karena SW baru langsung aktif sendiri di tengah sesi.
      registerType: "prompt",
      injectRegister: "script-defer",
      manifest: {
        name: "SALAM PRESISI — Pelaporan Giat Polres",
        short_name: "SALAM PRESISI",
        description: "Sistem Informasi Pelaporan Giat Lapangan Polres",
        lang: "id",
        theme_color: "#0f3d6e",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-180.png",
            sizes: "180x180",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
});
