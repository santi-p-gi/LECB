// Ventana para descargar o restaurar la copia de seguridad de la biblioteca.
import { useRef, useState } from 'react';
import { crearCopia, ErrorCopia, nombreArchivoCopia, restaurarCopia } from '../copiaSeguridad';
import { enMB } from '../almacenamiento';
import { contarEvento } from '../estadisticas';

interface Props {
  cantidadLibros: number;
  pesoLibros: number; // bytes (aproximado)
  onCerrar: () => void;
  onRestaurada: () => void; // para volver a leer la biblioteca
}

export default function CopiaSeguridad({ cantidadLibros, pesoLibros, onCerrar, onRestaurada }: Props) {
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function descargar() {
    setTrabajando(true);
    setError(null);
    try {
      const copia = await crearCopia(setMensaje);
      // Descarga el archivo en el dispositivo (no se envía a ningún lado).
      const url = URL.createObjectURL(copia);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombreArchivoCopia();
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMensaje(`Listo: se descargó la copia (${enMB(copia.size)}). Guardala en un lugar seguro, por ejemplo en tu nube o un pendrive.`);
      contarEvento('copia-exportada');
    } catch (err) {
      console.error(err);
      setMensaje(null);
      setError('No se pudo crear la copia. Si la biblioteca es muy grande, probá desde una computadora.');
    } finally {
      setTrabajando(false);
    }
  }

  async function restaurar(archivo: File) {
    setTrabajando(true);
    setError(null);
    try {
      const r = await restaurarCopia(archivo, setMensaje);
      const partes = [
        r.agregados && `${r.agregados} ${r.agregados === 1 ? 'libro agregado' : 'libros agregados'}`,
        r.combinados && `${r.combinados} ${r.combinados === 1 ? 'libro que ya tenías, actualizado' : 'libros que ya tenías, actualizados'}`,
        r.fallidos && `${r.fallidos} no se ${r.fallidos === 1 ? 'pudo' : 'pudieron'} restaurar`,
      ].filter(Boolean);
      setMensaje(`Copia restaurada: ${partes.join(', ') || 'no había libros en la copia'}.`);
      contarEvento('copia-restaurada');
      onRestaurada();
    } catch (err) {
      console.error(err);
      setMensaje(null);
      setError(err instanceof ErrorCopia ? err.message : 'No se pudo restaurar la copia.');
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="dialogo-fondo" onClick={() => !trabajando && onCerrar()}>
      <div className="dialogo" role="dialog" aria-label="Copia de seguridad" onClick={(e) => e.stopPropagation()}>
        <h2>Copia de seguridad</h2>
        <p>
          Tus libros, subrayados y notas se guardan solo en este navegador. Si se borran los datos del navegador o
          cambiás de dispositivo, se pierden. Con una copia los podés recuperar o pasar a otro dispositivo.
        </p>

        <div className="dialogo-acciones">
          <button className="btn btn-primario" onClick={descargar} disabled={trabajando || cantidadLibros === 0}>
            Descargar copia
            {cantidadLibros > 0 && (
              <small>
                {cantidadLibros} {cantidadLibros === 1 ? 'libro' : 'libros'} · ≈ {enMB(pesoLibros)}
              </small>
            )}
          </button>
          <button className="btn btn-secundario" onClick={() => entrada.current?.click()} disabled={trabajando}>
            Restaurar desde un archivo
          </button>
          <input
            ref={entrada}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              e.target.value = '';
              if (archivo) restaurar(archivo);
            }}
          />
        </div>

        {mensaje && <p className="dialogo-mensaje" aria-live="polite">{mensaje}</p>}
        {error && <p className="dialogo-error" role="alert">{error}</p>}

        <button className="enlace dialogo-cerrar" onClick={onCerrar} disabled={trabajando}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
