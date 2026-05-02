// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "/sessions/eager-gallant-lamport/mnt/Agents Terminal";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/main/index.ts"),
        output: {
          // Emit ESM so we can consume the ESM-only Claude Agent SDK.
          format: "es",
          entryFileNames: "[name].mjs",
          chunkFileNames: "[name]-[hash].mjs"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
        output: {
          // Preload runs via Electron's preload loader; CJS stays fine
          // because it only touches electron/ipcRenderer and our own code.
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared"),
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer/src")
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/renderer/index.html")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
