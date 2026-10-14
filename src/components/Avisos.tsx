// Avisos de lectura: la invitación (en "Seguir leyendo") y el control del pie de página.
import { useCallback, useEffect, useState } from 'react';
import {
  activarAvisos, cerrarInvitacion, desactivarAvisos, estadoAvisos, invitacionCerrada, probarAviso,
  type EstadoAvisos,
} from '../notificaciones';
import { contarEvento } from '../estadisticas';

function useAvisos() {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const actualizar = useCallback(() => estadoAvisos().then(setEstado), []);
  // La invitación y el pie usan cada uno su copia del estado: si una cambia, avisa a la otra.
  useEffect(() => {
    actualizar();
    window.addEventListener('lecb-avisos', actualizar);
    return () => window.removeEventListener('lecb-avisos', actualizar);
  }, [actualizar]);
  const avisarCambio = () => window.dispatchEvent(new Event('lecb-avisos'));

  async function activar() {
    setOcupado(true);
    setMensaje(null);
    try {
      const ok = await activarAvisos((conZona) => {
        contarEvento(conZona ? 'avisos-con-zona' : 'avisos-sin-zona');
        setMensaje(
          conZona
            ? '¡Listo! Te vamos a avisar cuando sea un lindo momento para leer.'
            : 'Listo. Sin tu ubicación no sabemos el clima: te mandaremos un recordatorio por semana.',
        );
      });
      if (!ok) setMensaje('No diste permiso para las notificaciones. Podés activarlas cuando quieras desde acá.');
      else setMensaje('¡Avisos activados! Si te pregunta, compartí tu ubicación para saber el clima.');
    } catch (err) {
      console.error(err);
      setMensaje('No se pudieron activar los avisos. Probá de nuevo en un rato.');
    } finally {
      setOcupado(false);
      avisarCambio();
    }
  }

  async function desactivar() {
    setOcupado(true);
    await desactivarAvisos().catch(console.error);
    setMensaje('Avisos desactivados.');
    setOcupado(false);
    avisarCambio();
  }

  return { estado, ocupado, mensaje, activar, desactivar };
}

/* ---------- invitación (aparece una sola vez, para quien ya está leyendo) ---------- */
export function InvitacionAvisos() {
  const { estado, ocupado, mensaje, activar } = useAvisos();
  const [cerrada, setCerrada] = useState(invitacionCerrada);
  if (cerrada || (estado !== 'desactivados' && !mensaje)) return null;
  const cerrar = () => {
    cerrarInvitacion();
    setCerrada(true);
  };
  return (
    <div className="invitacion-avisos" role="region" aria-label="Avisos de lectura">
      <span className="invitacion-emoji" aria-hidden>🌧️</span>
      <div className="invitacion-texto">
        {mensaje ? (
          <p>{mensaje}</p>
        ) : (
          <>
            <b>¿Te avisamos cuando sea un buen momento para leer?</b>
            <p>
              Una lluvia, un lindo día de sol, un buen frío… Como mucho un aviso por semana. Para saber el clima te vamos a
              pedir tu ubicación aproximada; si preferís no darla, te mandamos un recordatorio general.
            </p>
          </>
        )}
      </div>
      <div className="invitacion-botones">
        {mensaje ? (
          <button className="btn btn-secundario btn-chico" onClick={cerrar}>Cerrar</button>
        ) : (
          <>
            <button className="btn btn-primario btn-chico" onClick={activar} disabled={ocupado}>
              {ocupado ? 'Activando…' : 'Sí, avisame'}
            </button>
            <button className="btn btn-secundario btn-chico" onClick={cerrar}>Ahora no</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- control del pie de página ---------- */
export function ControlAvisos() {
  const { estado, ocupado, mensaje, activar, desactivar } = useAvisos();
  const [prueba, setPrueba] = useState<string | null>(null);
  if (!estado || estado === 'no-disponible') return null;

  async function probar() {
    setPrueba('Enviando…');
    try {
      await probarAviso(['lluvia', 'sol', 'frio', 'calor', 'generica'][Math.floor(Math.random() * 5)]);
      setPrueba('Enviado: te tiene que llegar en unos segundos.');
    } catch {
      setPrueba('No se pudo enviar la prueba.');
    }
  }

  return (
    <span className="control-avisos">
      Avisos de lectura:{' '}
      {estado === 'instalar-ios' && 'en iPhone, instalá LECB en la pantalla de inicio para recibirlos'}
      {estado === 'bloqueados' && 'bloqueados en este navegador (se habilitan desde los permisos del sitio)'}
      {estado === 'desactivados' && (
        <button className="enlace" onClick={activar} disabled={ocupado}>activar</button>
      )}
      {estado === 'activados' && (
        <>
          activados ·{' '}
          <button className="enlace" onClick={desactivar} disabled={ocupado}>desactivar</button> ·{' '}
          <button className="enlace" onClick={probar}>enviarme uno de prueba</button>
        </>
      )}
      {(prueba || mensaje) && <em> {prueba ?? mensaje}</em>}
    </span>
  );
}
