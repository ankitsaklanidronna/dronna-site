import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('chart.js')) return 'charting'
          if (id.includes('katex')) return 'math'
          if (id.includes('react')) return 'react-vendor'

          return 'vendor'
        },
      },
    },
  },
})
