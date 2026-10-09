// Colores de los subrayados y exportación a archivo de texto.
import type { BookMeta, ColorSubrayado, Subrayado } from './db';

export const COLORES_SUBRAYADO: Record<ColorSubrayado, { nombre: string; color: string }> = {
  amarillo: { nombre: 'Amarillo', color: '#f2c94c' },
  verde: { nombre: 'Verde', color: '#7bc67e' },
  azul: { nombre: 'Azul', color: '#6fb1e8' },
  rosa: { nombre: 'Rosa', color: '#ee8fb8' },
};

export const ORDEN_COLORES = Object.keys(COLORES_SUBRAYADO) as ColorSubrayado[];

// Arma un archivo Markdown (se abre con cualquier editor de texto) agrupado por capítulo.
export function textoExportado(libro: BookMeta, subrayados: Subrayado[]) {
  const fecha = new Date().toLocaleDateString('es');
  const lineas = [`# ${libro.title}`, '', libro.author, '', `_Subrayados exportados desde LECB el ${fecha}._`, ''];
  let capituloAnterior: string | null = null;
  for (const s of subrayados) {
    if (s.etiqueta !== capituloAnterior) {
      lineas.push(`## ${s.etiqueta || 'Sin capítulo'}`, '');
      capituloAnterior = s.etiqueta;
    }
    lineas.push(`> ${s.texto.replace(/\n+/g, ' ')}`, '');
    const datos = [s.pagina ? `Pág. ${s.pagina}` : null, COLORES_SUBRAYADO[s.color].nombre].filter(Boolean).join(' · ');
    lineas.push(`— ${datos}`, '');
    if (s.nota) lineas.push(`**Nota:** ${s.nota}`, '');
  }
  return lineas.join('\n');
}

// Descarga el archivo en el dispositivo (no se envía a ningún lado).
export function descargarSubrayados(libro: BookMeta, subrayados: Subrayado[]) {
  const blob = new Blob([textoExportado(libro, subrayados)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${libro.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'libro'} - subrayados.md`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
