import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mlServer } from './vite-plugin-ml-server'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mlServer()],
  optimizeDeps: {
    include: ['recharts', '@reduxjs/toolkit'],
  },
})
