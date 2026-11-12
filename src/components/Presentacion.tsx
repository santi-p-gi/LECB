// Presentación de LECB: qué se puede hacer y cómo empezar. Va arriba para quien llega por primera
// vez y al final de la página para quien ya tiene libros (esa persona viene a leer).
import { Altavoz, Cinta, Diccionario, LibroAbierto, Pellizco, Resaltador } from './Iconos';

const FUNCIONES = [
  {
    icono: <LibroAbierto />,
    titulo: 'Como un libro de verdad',
    texto: 'Doble página, márgenes y números de página. Temas papel, sepia y noche, con la letra y el tamaño que te queden cómodos.',
  },
  {
    icono: <Resaltador />,
    titulo: 'Subrayá y anotá',
    texto: 'Cuatro colores de subrayado y notas al margen. Después las encontrás todas juntas y las podés descargar.',
  },
  {
    icono: <Diccionario />,
    titulo: 'Diccionario a un toque',
    texto: '¿Una palabra que no conocés? Seleccionala y tocá «Definir», sin salir del libro.',
  },
  {
    icono: <Altavoz />,
    titulo: 'Escuchalo en voz alta',
    texto: 'LECB te lee el libro mientras cocinás, viajás o descansás la vista.',
  },
  {
    icono: <Pellizco />,
    titulo: 'PDF cómodos en el celu',
    texto: 'Pellizcá para agrandar, o pasá al modo texto: la página se acomoda a tu pantalla como un EPUB.',
  },
  {
    icono: <Cinta />,
    titulo: 'Nunca perdés el hilo',
    texto: 'Retomás donde lo dejaste. Y si volviste atrás a releer algo, un toque te devuelve a donde ibas.',
  },
];

export default function Presentacion({ onSubir }: { onSubir: () => void }) {
  return (
    <section className="seccion presentacion" id="como">
      <div className="contenedor">
        <div className="seccion-cab">
          <div>
            <p className="eyebrow">Qué podés hacer</p>
            <h2 className="titulo-seccion">Pensado para leer, no para mirar pantallas</h2>
          </div>
        </div>
        <div className="caracts">
          {FUNCIONES.map((f) => (
            <div className="caract" key={f.titulo}>
              <div className="caract-ico">{f.icono}</div>
              <div>
                <h3>{f.titulo}</h3>
                <p>{f.texto}</p>
              </div>
            </div>
          ))}
        </div>

        <h2 className="titulo-seccion titulo-pasos">Empezar es así de fácil</h2>
        <ol className="pasos">
          <li>
            <span className="paso-num">1</span>
            <h3>Conseguí un libro</h3>
            <p>
              Un archivo EPUB o PDF. Hay miles gratis y legales: <a href="#conseguir">te mostramos dónde</a>.
            </p>
          </li>
          <li>
            <span className="paso-num">2</span>
            <h3>Subilo a LECB</h3>
            <p>
              <button className="enlace" onClick={onSubir}>Elegí el archivo</button> o arrastralo a la página. Queda
              guardado solo en tu dispositivo.
            </p>
          </li>
          <li>
            <span className="paso-num">3</span>
            <h3>Leé</h3>
            <p>En la compu o en el celu, con o sin internet. Si la instalás como app, la tenés a un toque.</p>
          </li>
        </ol>
        <p className="ornamento">❦</p>
      </div>
    </section>
  );
}
