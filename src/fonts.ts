import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/montserrat/800.css'
import '@fontsource/montserrat/900.css'
import '@fontsource/montserrat/900-italic.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import '@fontsource/poppins/900.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/anton/400.css'
import '@fontsource/roboto-mono/500.css'
import '@fontsource/playfair-display/600.css'
import '@fontsource/playfair-display/600-italic.css'
import '@fontsource/playfair-display/900.css'
import { engine } from './lib/engine'

/** Canvas text only uses a web font once it's loaded, so warm them up. */
export function preloadFonts() {
  const specs = [
    '400 16px Inter', '500 16px Inter', '600 16px Inter', '700 16px Inter',
    '500 16px Montserrat', '700 16px Montserrat', '800 16px Montserrat', '900 16px Montserrat', 'italic 900 16px Montserrat',
    '700 16px Poppins', '900 16px Poppins', '400 16px "Bebas Neue"', '400 16px Anton',
    '500 16px "Roboto Mono"', 'italic 600 16px "Playfair Display"', '900 16px "Playfair Display"',
  ]
  Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null))).then(() => engine.invalidate())
  document.fonts.addEventListener?.('loadingdone', () => engine.invalidate())
}
