import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { registerSW } from 'virtual:pwa-register'
import { router } from './router.tsx'
import './global.css'

if (import.meta.env.DEV) {
  void import('virtual:stylex:runtime')
}

registerSW({ immediate: true })
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
