// Sección "¿De dónde saco libros EPUB?": guía para quien no conoce el formato.
import type { ReactNode } from 'react';
import { contarEvento } from '../estadisticas';

// Enlace externo: se abre en otra pestaña y cuenta (anónimamente) que alguien lo usó.
function Enlace({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => contarEvento('ver-fuente')}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

export default function Fuentes() {
  return (
    <section className="seccion" id="conseguir">
      <div className="contenedor">
        <div className="seccion-cab">
          <h2 className="titulo-seccion">¿De dónde saco libros EPUB?</h2>
        </div>
        <p className="fuentes-intro">
          El <b>EPUB</b> es el formato estándar de los libros digitales: a diferencia del PDF, el texto se adapta a
          cualquier pantalla y podés elegir la letra y el tamaño. Son archivos que terminan en <code>.epub</code>.
          Así los podés conseguir:
        </p>

        <div className="fuentes">
          <article className="fuente">
            <h3>Clásicos gratis y legales</h3>
            <p>Obras de dominio público (de autores que murieron hace décadas), gratis y sin protección anticopia:</p>
            <ul>
              <li>
                <Enlace href="https://www.gutenberg.org/browse/languages/es">Project Gutenberg</Enlace> — cientos de
                clásicos en español. En cada libro elegí «EPUB3».
              </li>
              <li>
                <Enlace href="https://es.wikisource.org/wiki/Portada">Wikisource</Enlace> — la biblioteca de Wikipedia.
                Abrí una obra y buscá el botón «Descargar» → EPUB.
              </li>
              <li>
                <Enlace href="https://www.elejandria.com/">Elejandría</Enlace> — clásicos en español para descargar
                gratis.
              </li>
              <li>
                <Enlace href="https://standardebooks.org/">Standard Ebooks</Enlace> — ediciones muy cuidadas (en
                inglés).
              </li>
              <li>
                <Enlace href="https://archive.org/">Internet Archive</Enlace> — usá los libros de descarga libre; los
                de «préstamo» vienen con DRM y no abren.
              </li>
            </ul>
          </article>

          <article className="fuente">
            <h3>Comprar libros sin DRM</h3>
            <p>
              Amazon, Apple Books y Google Play Libros suelen vender con <b>DRM</b>, una protección que hace que el
              libro solo se lea en su propia app: esos no abren en LECB.
            </p>
            <ul>
              <li>
                <Enlace href="https://lektu.com/">Lektu</Enlace> — tienda en español con muchos libros sin DRM.
              </li>
              <li>Muchos autores independientes y editoriales venden directo desde su web.</li>
              <li>
                En la ficha del libro fijate que diga <b>«sin DRM»</b> o <b>«DRM social / marca de agua»</b>: esos sí
                funcionan.
              </li>
            </ul>
          </article>

          <article className="fuente">
            <h3>Convertí tus propios textos</h3>
            <p>¿Tenés apuntes, un cuento o un documento? Podés convertirlo en EPUB:</p>
            <ul>
              <li>
                <b>Google Docs:</b> Archivo → Descargar → <i>Publicación EPUB</i>.
              </li>
              <li>
                <Enlace href="https://calibre-ebook.com/">Calibre</Enlace> (gratis, para computadora): convierte Word,
                páginas web y otros formatos a EPUB.
              </li>
            </ul>
          </article>

          <article className="fuente">
            <h3>Paso a paso en el celular</h3>
            <ol>
              <li>Descargá el archivo <code>.epub</code> desde el navegador.</li>
              <li>
                En LECB tocá <b>Subir libro</b>.
              </li>
              <li>Elegilo en la carpeta <b>Descargas</b>.</li>
            </ol>
            <p>Listo: el libro queda guardado en tu celular y lo podés leer sin internet.</p>
          </article>
        </div>

        <p className="fuentes-aviso">
          Evitá los sitios que ofrecen gratis libros actuales con derechos de autor: además de no ser legales, suelen
          tener publicidad engañosa o archivos con virus.
        </p>
      </div>
    </section>
  );
}
