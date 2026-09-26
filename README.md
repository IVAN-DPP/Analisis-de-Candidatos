# Historia de cuenta

Aplicación web local para leer y explicar los datos de una cuenta de Instagram a partir de archivos JSON. El informe está pensado para alguien que no programa: las gráficas Plotly, las tablas, las explicaciones y el retrato descriptivo son el producto principal; el código sólo prepara los datos.

## Qué hace

La aplicación:

- explora la estructura de uno o varios JSON antes de analizar;
- conserva los archivos originales y trabaja sobre copias en memoria;
- detecta publicaciones, fechas, likes agregados, comentarios, menciones, etiquetas, coautores y, cuando existen, identidades de likes;
- presenta cada nivel en una página HTML independiente, con navegación **Anterior**, **Siguiente** y acceso directo;
- usa etiquetas `Publicación 1`, `Publicación 2`, etc., y mantiene enlaces reales a cada publicación;
- muestra los likes en una línea temporal separada de la actividad editorial;
- compara la colaboración mediante distribuciones de caja, no mediante una dispersión ambigua;
- muestra likes por publicación, evolución temporal, frecuencia, distribución, percentiles y valores excepcionales;
- construye tablas de audiencia, recurrencia, concentración, curva de Lorenz e índice de Gini cuando hay identidades suficientes;
- compara publicaciones colaborativas y no colaborativas sin presentar una asociación como causalidad;
- dibuja redes de interacción, colaboración y coincidencia con Plotly;
- incluye una matriz publicación × cuenta, correlaciones descriptivas y hallazgos;
- profundiza en un retrato provisional de la cuenta: ritmo, contenido, respuesta, conversación, colaboraciones y estructura de vínculos;
- permite descargar la tabla de publicaciones en CSV.

## Ejecutar

Instala las dependencias y ejecuta Flask:

```bash
python -m pip install -r requirements.txt
python app.py
```

Abre <http://127.0.0.1:8000>.

La pantalla inicial permite:

- seleccionar o arrastrar uno o varios `.json`;
- usar los JSON detectados en la carpeta del servidor;
- continuar un informe ya cargado en memoria;
- reemplazar la fuente sin modificar el archivo anterior.

El límite local de carga es de 100 MB. Los archivos se procesan en memoria y nunca se sobrescriben.

En un despliegue se pueden activar las variables opcionales `ADMIN_USER` y `ADMIN_PASSWORD` para proteger Flask con autenticación básica. Si no se configuran, el flujo local no pide contraseña.

## Páginas del informe

Cada nivel tiene su propio archivo HTML y su propia ruta:

1. `/informe/resumen` — panorama, retrato inicial y métricas.
2. `/informe/datos` — inventario, cobertura de identidades y diccionario.
3. `/informe/publicaciones` — likes, distribución, excepciones y tabla.
4. `/informe/audiencia` — cuentas observadas, concentración, recurrencia y mapa.
5. `/informe/colaboraciones` — colaboradores y comparaciones descriptivas.
6. `/informe/redes` — interacción, colaboración, coincidencia y puentes.
7. `/informe/evolucion` — series mensuales con leyenda de colores.
8. `/informe/hallazgos` — retrato profundo, evidencia, preguntas y límites.

Cada gráfica indica qué muestra, qué se puede observar y qué no se puede concluir. Las gráficas se construyen con Plotly y el JavaScript se sirve localmente desde la dependencia `plotly`, sin depender de un CDN.

## Formatos aceptados

El motor de análisis no obliga a que todos los archivos tengan la misma forma. Acepta, entre otras:

- una lista de publicaciones;
- un objeto con `posts`, `data`, `items`, `results` o `records`;
- un sobre `{"files": [{"name": "archivo.json", "payload": ...}]}`;
- archivos separados para posts, likes, comentarios, seguidores o colaboraciones.

Los nombres de campos se reconocen mediante alias comunes (`id`, `shortCode`, `ownerUsername`, `timestamp`, `likesCount`, `latestComments`, `likers`, `likedBy`, `coauthorProducers`, etc.). Si una estructura no coincide, el informe la muestra en “¿Qué datos tenemos?” y limita el cálculo a lo que sí puede interpretar.

### Likes sin identidades

`likesCount` es una métrica agregada: permite comparar publicaciones, pero no identifica quién dio like. El mapa de audiencia sólo muestra cuentas cuando el JSON contiene una lista o evento de likers. En los archivos actuales, los likes no tienen identidades; por eso la aplicación los usa para las gráficas, pero no inventa una audiencia a partir de un número.

Los comentarios de `latestComments` sí pueden identificar cuentas cuando incluyen `ownerUsername`. Su cobertura se muestra como una muestra, no como el total de comentarios reportados.

## Hallazgos y límites

El retrato narrativo describe el comportamiento observable de la cuenta en los archivos: ritmo, formatos, respuesta agregada, conversación identificada, colaboraciones y redes. No diagnostica personalidad, intención, valores ni vida privada. Cada dimensión incluye evidencia y una advertencia explícita.

La explicación completa de los cálculos, modelos matemáticos, diccionario de datos y alcance de cada sección está en [`GUIA_DE_ANALISIS.md`](GUIA_DE_ANALISIS.md). La documentación detallada de la arquitectura y de cada función está en [`GUIA_ARQUITECTURA.pdf`](GUIA_ARQUITECTURA.pdf) y su fuente editable en [`GUIA_ARQUITECTURA.md`](GUIA_ARQUITECTURA.md).

## API local

- `GET /api/health` — comprobación de servicio.
- `GET /api/status` — estado y JSON detectados en el servidor.
- `POST /api/analysis` — acepta un JSON o un sobre de varios archivos; devuelve el informe.
- `GET /api/analysis?main=cuenta&scope=owned` — recalcula el informe de la fuente cargada.
- `POST /api/load-server` — carga en memoria todos los JSON de la carpeta del servidor.
- `GET /api/sources` — lista los archivos disponibles.

`scope` puede ser `owned`, `involving` o `all`. El estado se mantiene sólo en memoria y se reemplaza de forma transaccional: si un archivo nuevo es inválido, el informe anterior permanece intacto.

## Estructura

- `analysis.py`: detección de estructuras, normalización, métricas, series, concentración, redes, hallazgos y retrato narrativo.
- `app.py`: servidor Flask, estado temporal, carga segura, API, páginas HTML y asset local de Plotly.
- `web/index.html`: pantalla de carga.
- `web/pages/`: una página HTML independiente por nivel del informe.
- `web/dashboard.js`: navegación de páginas, tablas y gráficas Plotly.
- `web/landing.js`: carga de archivos y acceso al informe.
- `web/dashboard.css`: sistema visual responsive y tipografía ampliada.
- `web/app.js` y `web/js/`: compatibilidad histórica del panel anterior.
- `tests/`: pruebas de análisis y de la capa HTTP.

## Dependencias

```bash
pip install -r requirements.txt
```

La aplicación utiliza Flask para el servidor y Plotly para las gráficas. No necesita una base de datos ni un servicio externo para generar el informe.
