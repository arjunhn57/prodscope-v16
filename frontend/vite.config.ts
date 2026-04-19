import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://34.10.240.173:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion')) return 'framer-motion';
          if (id.includes('@lottiefiles')) return 'lottie';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('lucide-react')) return 'lucide';
          if (
            id.includes('@react-oauth') ||
            id.includes('jwt-decode')
          )
            return 'auth-vendor';
          if (id.includes('react-router') || id.includes('@remix-run')) return 'react-router';
          if (
            id.includes('react-dom') ||
            id.includes('scheduler') ||
            /node_modules\\react\\/.test(id) ||
            /node_modules\/react\//.test(id)
          )
            return 'react';
          if (id.includes('@tanstack')) return 'query';
          return 'vendor';
        },
      },
    },
  },
})
