import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1000, // Lower threshold for better monitoring
    rollupOptions: {
      output: {
        // Optimize chunk naming for better caching
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    // Enable source maps for production debugging
    sourcemap: false,
    // Minimize for smaller bundles
    minify: "esbuild",
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ["vue", "vue-router", "axios", "chart.js", "vue-chartjs"],
  },
});
