// Guías de ayuda (lecb.ar/guias/…): páginas simples, sin React, pensadas para que Google las
// encuentre y para que quien llega con una duda concreta la resuelva (y conozca LECB).
//
// Cada guía es un archivo guias/<direccion>.html: arriba, entre <!-- -->, los datos de la página
// (titulo, corto, descripcion, fecha); abajo, el texto. Al construir la web (vite.config.ts) se
// arma la página completa con el diseño de LECB, y también el índice /guias/ y el sitemap.
import { readdirSync, readFileSync } from 'node:fs';

const SITIO = 'https://lecb.ar';

interface Guia {
  direccion: string; // "abrir-epub-en-el-celular"
  titulo: string; // el <h1> y el título de la pestaña
  corto: string; // para listas de "otras guías"
  descripcion: string; // lo que muestra Google debajo del título
  fecha: string; // última actualización, AAAA-MM-DD
  cuerpo: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (f: string) => {
  const [a, m, d] = f.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
};
const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function leerGuias(carpeta = 'guias'): Guia[] {
  return readdirSync(carpeta)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((archivo) => {
      const texto = readFileSync(`${carpeta}/${archivo}`, 'utf8');
      const datos = texto.match(/^<!--([\s\S]*?)-->/);
      if (!datos) throw new Error(`guias/${archivo}: faltan los datos entre <!-- -->`);
      const campos = Object.fromEntries(
        datos[1].split('\n').map((l) => l.match(/^\s*(\w+):\s*(.+?)\s*$/)).filter((m) => m).map((m) => [m![1], m![2]]),
      );
      for (const c of ['titulo', 'corto', 'descripcion', 'fecha']) {
        if (!campos[c]) throw new Error(`guias/${archivo}: falta "${c}"`);
      }
      return { direccion: archivo.replace(/\.html$/, ''), ...campos, cuerpo: texto.slice(datos[0].length).trim() } as Guia;
    });
}

function pagina({ titulo, descripcion, url, contenido, datos }: { titulo: string; descripcion: string; url: string; contenido: string; datos: object }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapar(titulo)} | LECB</title>
<meta name="description" content="${escapar(descripcion)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="LECB" />
<meta property="og:locale" content="es_AR" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${escapar(titulo)}" />
<meta property="og:description" content="${escapar(descripcion)}" />
<meta property="og:image" content="${SITIO}/vista-previa.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#9b3b2a" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400&family=Inter:wght@400;500;600&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/guias/guias.css" />
<script type="application/ld+json">${JSON.stringify(datos)}</script>
<script data-goatcounter="https://lecb.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</head>
<body>
<header class="nav">
  <a class="logo" href="/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 6c-2.3-1.6-5.3-2.2-9-2v14c3.7-.2 6.7.4 9 2 2.3-1.6 5.3-2.2 9-2V4c-3.7-.2-6.7.4-9 2Z"/><path d="M12 6v14"/></svg>LECB</a>
  <a class="nav-guias" href="/guias/">Guías</a>
  <a class="btn" href="/">Abrir LECB</a>
</header>
<main>
${contenido}
</main>
<footer class="pie">
  <p>LECB es un lector de libros EPUB y PDF gratis, que funciona en el navegador. Tus libros nunca salen de tu dispositivo.</p>
  <p><a href="/">Ir a LECB</a> · <a href="/guias/">Todas las guías</a> · <a href="mailto:contacto@lecb.ar">contacto@lecb.ar</a></p>
</footer>
</body>
</html>
`;
}

const LLAMADO = `<aside class="llamado">
  <h2>Leelo en LECB, gratis y sin instalar nada</h2>
  <p>Abrí tus EPUB y PDF en el celular o la compu, como un libro de verdad: subrayá, buscá palabras, escuchalo en voz alta y retomá donde lo dejaste. Sin crear cuenta, y tus libros no salen de tu dispositivo.</p>
  <a class="btn" href="/">Probar LECB</a>
</aside>`;

export function paginasDeGuias(carpeta = 'guias'): { archivo: string; html: string }[] {
  const guias = leerGuias(carpeta);
  const paginas = guias.map((g) => {
    const url = `${SITIO}/guias/${g.direccion}/`;
    const otras = guias.filter((o) => o !== g).map((o) => `<li><a href="/guias/${o.direccion}/">${o.corto}</a></li>`).join('\n');
    const contenido = `<article>
<nav class="migas" aria-label="Ubicación"><a href="/">LECB</a> › <a href="/guias/">Guías</a></nav>
<h1>${g.titulo}</h1>
<p class="fecha">Actualizado el ${fechaLarga(g.fecha)}</p>
${g.cuerpo}
${LLAMADO}
<section class="otras">
<h2>Otras guías</h2>
<ul>
${otras}
</ul>
</section>
</article>`;
    const datos = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          headline: g.titulo,
          description: g.descripcion,
          inLanguage: 'es',
          dateModified: g.fecha,
          mainEntityOfPage: url,
          image: `${SITIO}/vista-previa.jpg`,
          author: { '@type': 'Organization', name: 'LECB', url: `${SITIO}/` },
          publisher: { '@type': 'Organization', name: 'LECB', url: `${SITIO}/` },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'LECB', item: `${SITIO}/` },
            { '@type': 'ListItem', position: 2, name: 'Guías', item: `${SITIO}/guias/` },
            { '@type': 'ListItem', position: 3, name: g.corto, item: url },
          ],
        },
      ],
    };
    return { archivo: `guias/${g.direccion}/index.html`, html: pagina({ titulo: g.titulo, descripcion: g.descripcion, url, contenido, datos }) };
  });

  // Índice de guías
  const lista = guias
    .map((g) => `<li><a href="/guias/${g.direccion}/"><b>${g.titulo}</b><span>${g.descripcion}</span></a></li>`)
    .join('\n');
  paginas.push({
    archivo: 'guias/index.html',
    html: pagina({
      titulo: 'Guías para leer libros digitales',
      descripcion: 'Guías cortas y claras para abrir EPUB y PDF en el celular, conseguir libros gratis y legales, y leer más cómodo.',
      url: `${SITIO}/guias/`,
      contenido: `<article>
<nav class="migas" aria-label="Ubicación"><a href="/">LECB</a> › Guías</nav>
<h1>Guías para leer libros digitales</h1>
<p class="bajada">Respuestas cortas a las dudas más comunes: cómo abrir un libro, dónde conseguirlo y cómo leerlo cómodo.</p>
<ul class="lista-guias">
${lista}
</ul>
${LLAMADO}
</article>`,
      datos: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Guías de LECB', url: `${SITIO}/guias/`, inLanguage: 'es' },
    }),
  });
  return paginas;
}

export function sitemap(carpeta = 'guias') {
  const guias = leerGuias(carpeta);
  const hoy = guias.map((g) => g.fecha).sort().at(-1);
  const urls = [
    { loc: `${SITIO}/`, mod: undefined },
    { loc: `${SITIO}/guias/`, mod: hoy },
    ...guias.map((g) => ({ loc: `${SITIO}/guias/${g.direccion}/`, mod: g.fecha })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>${u.mod ? `\n    <lastmod>${u.mod}</lastmod>` : ''}\n  </url>`).join('\n')}
</urlset>
`;
}
