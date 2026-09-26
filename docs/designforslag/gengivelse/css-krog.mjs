// Landkort.tsx importerer leaflet.css. Next bundter den; Node kan ikke.
// Krogen giver et tomt modul for .css, så komponenterne kan gengives.
import { register } from 'node:module'
register(import.meta.url.replace(/css-krog\.mjs$/, 'css-tom.mjs'))
