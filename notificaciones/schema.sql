-- Una fila por dispositivo que aceptó los avisos. Sin nombre, sin mail, sin libros:
-- solo la dirección anónima de notificación y, si el lector la compartió, una zona aproximada
-- (latitud y longitud redondeadas a un decimal, unos 10 km).
CREATE TABLE IF NOT EXISTS suscripciones (
  endpoint TEXT PRIMARY KEY,   -- dirección de notificación que da el navegador
  lat REAL,                    -- zona aproximada (NULL = no compartió la ubicación)
  lon REAL,
  zona_horaria TEXT NOT NULL,  -- para avisar a una hora razonable (ej. America/Argentina/Buenos_Aires)
  creado INTEGER NOT NULL,     -- milisegundos
  ultimo_envio INTEGER,        -- último aviso enviado (para no mandar más de uno por semana)
  ultimo_tipo TEXT             -- lluvia, sol, frio, calor o generica
);
