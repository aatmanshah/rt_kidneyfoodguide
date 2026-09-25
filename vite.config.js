import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        book: resolve(__dirname, "book/index.html"),
        fallrecipes: resolve(__dirname, "fallrecipes/index.html"),
        fallrecipesThankYou: resolve(__dirname, "fallrecipes/thank-you/index.html"),
      },
    },
  },
});
