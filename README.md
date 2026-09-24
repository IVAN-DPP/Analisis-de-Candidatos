# Historia de cuenta

Aplicación web local para leer y explicar los datos de una cuenta de Instagram a partir de archivos JSON. El informe está pensado para alguien que no programa: las gráficas, las tablas y las explicaciones son el producto principal; el código sólo prepara los datos.

## Qué hace

La aplicación:

- explora la estructura de uno o varios JSON antes de analizar;
- conserva los archivos originales y trabaja sobre copias en memoria;
- detecta publicaciones, fechas, likes agregados, comentarios, menciones, etiquetas, coautores y, cuando existen, identidades de likes;
- reconstruye un perfil visual de la cuenta;
- muestra likes por publicación, evolución temporal, frecuencia, distribución, percentiles y valores excepcionales;
- construye tablas de audiencia, recurrencia, concentración, curva de Lorenz e índice de Gini cuando hay identidades suficientes;
- compara publicaciones colaborativas y no colaborativas sin presentar una asociación como causalidad;
- dibuja redes de interacción, colaboración y coincidencia, con comunidades, centralidad y cuentas puente cuando la estructura tiene suficientes vínculos;
- incluye una matriz publicación × cuenta, línea temporal de audiencia, correlaciones descriptivas, hallazgos, preguntas abiertas y limitaciones;
- permite descargar la tabla de publicaciones en CSV.

## Ejecutar

```bash
python app.py
```

Abre <http://127.0.0.1:8000>.

También se puede iniciar con un archivo concreto, sin sobrescribirlo:

```bash
python app.py --dataset Hader.json --main rios.hader --port 8000
```

La pantalla inicial permite:

- seleccionar o arrastrar uno o varios `.json`;
- usar los JSON que el servidor detectó en su carpeta;
- reemplazar la fuente sin modificar el archivo anterior.

En un despliegue se pueden activar las variables opcionales `ADMIN_USER` y `ADMIN_PASSWORD` para proteger la aplicación con autenticación básica. Si no se configuran, el flujo local no pide código ni contraseña.

## Formatos aceptados

El servidor no obliga a que todos los archivos tengan la misma forma. Acepta, entre otras:

- una lista de publicaciones;
- un objeto con `posts`, `data`, `items`, `results` o `records`;
- un sobre `{"files": [{"name": "archivo.json", "payload": ...}]}`;
- archivos separados para posts, likes, comentarios, seguidores o colaboraciones.

Los nombres de campos se reconocen mediante alias comunes (`id`, `shortCode`, `ownerUsername`, `timestamp`, `likesCount`, `latestComments`, `likers`, `likedBy`, `coauthorProducers`, etc.). Si una estructura no coincide, el informe la muestra en “¿Qué datos tenemos?” y limita el cálculo a lo que sí puede interpretar.

### Likes sin identidades

`likesCount` es una métrica agregada: permite comparar publicaciones, pero no identifica quién dio like. El mapa de audiencia sólo muestra cuentas cuando el JSON contiene una lista o evento de likers. En los archivos de Apify incluidos actualmente, los likes no tienen identidades; por eso la aplicación los usa para las gráficas, pero no inventa una audiencia a partir de un número.

Los comentarios de `latestComments` sí pueden identificar cuentas cuando incluyen `ownerUsername`. Su cobertura se muestra como una muestra, no como el total de comentarios reportados.

## Secciones del informe

1. **Qué datos tenemos** — inventario de archivos, campos, roles y cruces posibles.
2. **Publicaciones** — resumen, línea temporal, frecuencia, distribución, caja, tabla y excepciones.
3. **Audiencia** — cuentas, mapa, concentración, Lorenz, recurrencia y heatmap.
4. **Colaboraciones** — colaboradores, evolución, comparación y relación con la interacción.
5. **Redes** — interacción, colaboración, coincidencia, comunidades y puentes.
6. **Evolución** — línea temporal de la cuenta y de la audiencia.
7. **Hallazgos** — entre 5 y 10 conclusiones con evidencia, visualización y advertencia.

Cada gráfica incluye tres apartados: **¿Qué muestra?**, **¿Qué podemos observar?** y **¿Qué NO podemos concluir?**.

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

- `analysis.py`: detección de estructuras, normalización, métricas, series, concentración, redes y hallazgos.
- `app.py`: servidor Flask, estado temporal, carga segura y assets estáticos.
- `web/index.html`: estructura accesible del informe.
- `web/app.js`: carga, navegación, tablas, gráficas SVG y explicaciones.
- `web/styles.css`: sistema visual responsive.
- `tests/`: pruebas de análisis y de la capa HTTP.
- `GUIA_DE_ANALISIS.md`: guía detallada de secciones, cálculos, modelos, diccionario y límites.

## Dependencias

```bash
pip install -r requirements.txt
```

La aplicación utiliza Flask para el servidor y JavaScript/CSS servidos localmente para la interfaz. No necesita una base de datos ni un servicio externo para generar el informe.
