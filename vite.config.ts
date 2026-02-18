import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          onstart(args) {
            args.startup()
          },
          vite: {
            define: {
              'process.env.GOOGLE_CLIENT_ID': JSON.stringify(env.GOOGLE_CLIENT_ID || ''),
              'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(env.GOOGLE_CLIENT_SECRET || ''),
            },
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron'],
              },
              watch: {
                exclude: ['dist-electron/**'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(args) {
            args.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron'],
              },
              watch: {
                exclude: ['dist-electron/**'],
              },
            },
          },
        },
      ]),
      electronRenderer(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      watch: {
        ignored: ['**/dist-electron/**'],
      },
    },
  }
})
