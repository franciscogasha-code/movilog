/**
 * Sistema de branding SANSEI — fuente única de verdad.
 *
 * Usado por piezas comerciales (PDFs cliente, futuras presentaciones).
 * NO usar en UI web (la UI web usa tokens semánticos de Tailwind/index.css).
 *
 * Tuplas RGB compatibles con jsPDF / canvas APIs.
 */
export type RGB = [number, number, number];

export const BRAND: {
  primary: RGB;
  primaryDark: RGB;
  secondary: RGB;
  accent: RGB;
  text: RGB;
  ink: RGB;
  muted: RGB;
  line: RGB;
  rowAlt: RGB;
  background: RGB;
  white: RGB;
} = {
  primary: [227, 6, 19],        // #E30613 rojo SANSEI
  primaryDark: [176, 0, 14],    // hover/acento
  secondary: [0, 160, 184],     // teal extendido
  accent: [243, 146, 0],        // naranja extendido
  text: [33, 37, 41],
  ink: [26, 43, 58],
  muted: [110, 118, 125],
  line: [225, 228, 232],
  rowAlt: [250, 250, 250],
  background: [255, 255, 255],
  white: [255, 255, 255],
};

export const BRAND_TAGLINE = "más que un bazar, un paseo de compras";
export const BRAND_CONTACT = {
  web: "sansei.com.py",
  phone: "0986 364 000",
  email: "sansei.py@gmail.com",
  city: "Encarnación, Paraguay",
};
