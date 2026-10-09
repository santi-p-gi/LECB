// Punto de entrada: monta el componente principal <App /> dentro de <div id="root">.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { cargarTemaSitio } from './preferencias';
import './index.css';

// Si el usuario eligió tema claro u oscuro antes, lo aplicamos antes de dibujar.
const tema = cargarTemaSitio();
if (tema) document.documentElement.dataset.theme = tema;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
