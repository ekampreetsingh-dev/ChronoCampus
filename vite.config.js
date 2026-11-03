import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 5175 rather than 5173: another project of yours already owns 5173 on ::1,
  // which makes http://localhost:5173 serve that app instead of this one.
  server: { port: 5175, host: true, strictPort: true },
  preview: { port: 5176, host: true, strictPort: true },
})
