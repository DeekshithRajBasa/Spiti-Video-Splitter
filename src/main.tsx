import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { preloadFonts } from './fonts'
import './index.css'
import App from './App.tsx'

preloadFonts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
