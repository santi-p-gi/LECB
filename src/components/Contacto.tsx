// Email de contacto, protegido contra los programas que recorren la web juntando direcciones
// para mandar spam: la dirección no está escrita entera en ningún lado, se arma recién
// cuando la página se muestra en el navegador.
import { useEffect, useState } from 'react';

const USUARIO = 'contacto';
const DOMINIO = ['lecb', 'ar'];

export default function Contacto() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => setEmail(`${USUARIO}@${DOMINIO.join('.')}`), []);

  return (
    <p className="contacto">
      ¿Dudas, sugerencias o encontraste un error? Escribinos a{' '}
      {email ? <a href={`mailto:${email}?subject=${encodeURIComponent('Consulta sobre LECB')}`}>{email}</a> : '…'}
    </p>
  );
}
