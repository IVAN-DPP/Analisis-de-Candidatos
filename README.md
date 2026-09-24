# Atlas de cuenta

Aplicación web local para analizar publicaciones de Instagram de cualquier cuenta cuando los archivos conservan el esquema del scraper. No requiere bibliotecas externas: el servidor usa la biblioteca estándar de Python y la interfaz utiliza módulos JavaScript servidos localmente.

## Ejecutar

```bash
python app.py
```

Abre <http://127.0.0.1:8000>.

Para iniciar con un archivo concreto:

```bash
python app.py --dataset Hader.json --main rios.hader --port 8000
```

Si no se indica `--dataset`, la aplicación inicia sin ningún archivo y muestra la pantalla principal. El usuario puede seleccionar o arrastrar un JSON compatible. Si se usa `--dataset`, el archivo queda precargado en el servidor, pero la aplicación todavía comienza mostrando la pantalla inicial.

## Pantalla inicial

Al ejecutar `python app.py`, la aplicación no necesita que exista ningún JSON en la carpeta. Siempre comienza en la portada:

**Análisis Candidatos Aguante Popular**

Desde esta pantalla se puede:

- seleccionar un archivo `.json`;
- arrastrar y soltar el archivo;
- recibir mensajes de validación antes de procesar;
- continuar con un archivo previamente cargado durante la misma sesión del servidor.

El archivo debe descargarse de **Apify Instagram Scraper** y contener una lista JSON de publicaciones con campos compatibles, como `ownerUsername`, identificadores de publicación, fecha, métricas o comentarios.

La portada incluye los créditos:

**Equipo de analítica de datos AP**

## Archivos compatibles

La cuenta principal se detecta automáticamente como la autora con más publicaciones del JSON. Por eso el mismo programa funciona con cuentas diferentes, por ejemplo:

- `Fulanito1.json` → `@fulanito1`
- `Fulanito2.json` → `@fulanito2`
- `Fulanito3.json` → `@fulanito3`

El selector **Alcance** permite analizar:

1. **Publicaciones propias:** las cuyo `ownerUsername` coincide con la cuenta principal.
2. **Incluye colaboraciones:** publicaciones que mencionan, etiquetan o acreditan a la cuenta principal como coautora.
3. **Todo el archivo:** todos los registros.

## Organización

- `analysis.py`: normalización, fuentes de relación, redes, contexto y series mensuales.
- `app.py`: servidor local, carga segura y entrega de assets.
- `web/js/formatters.js`: formato seguro de números, fechas y texto.
- `web/js/charts.js`: gráficas SVG sin dependencias.
- `web/js/network-layout.js`: layouts radial, por hubs y por componentes.
- `web/js/network-camera.js`: zoom, rueda y arrastre.
- `web/app.js`: orquestación de estado, vistas, tablas y API.

## Funciones

### Indicadores y series mensuales

- Publicaciones, likes, comentarios reportados, cobertura de comentarios y cuentas conectadas.
- Gráfica de publicaciones por mes.
- Gráfica de likes por mes.
- Gráfica de colaboraciones por mes.

Las colaboraciones se calculan como autores distintos registrados en `coauthorProducers`, contados una vez por publicación y mes. La app también conserva el número de publicaciones con al menos un coautor.

### Red Principal ↔ otros

Red egocéntrica con la cuenta principal fija al centro. Puede ponderar:

| Fuente | Unidad de cálculo |
| --- | --- |
| Comentarios capturados | Comentario único incluido en `latestComments`. |
| Publicaciones comentadas | Publicaciones distintas con comentarios capturados. |
| Menciones | Máximo una ocurrencia por cuenta y publicación. |
| Etiquetas | Máximo una ocurrencia por cuenta y publicación. |
| Coautores | Máximo una ocurrencia por cuenta y publicación. |

En modo combinado:

```text
puntaje = Σ (fuente × peso)
```

### Red Otros ↔ otros

Dos cuentas periféricas se conectan si ambas comentan la misma publicación. El peso es la cantidad de publicaciones compartidas.

El layout usa grado y peso de las aristas: los nodos con más enlaces tienden a quedar más cerca, mientras los componentes densos se agrupan. No demuestra que las cuentas se conozcan o se comuniquen directamente.

### Red Principal ↔ contexto

La cuenta principal se conecta con:

- Cada `Location Name` observado.
- Cada pista de `Music Info`, identificada por `audio_id` o por artista + canción.

El peso es la cantidad de publicaciones que comparten el mismo lugar o pista. La ubicación describe el contenido publicado; no demuestra presencia física. Music Info solo existe cuando el scraper capturó el audio.

### Exploración

- Rueda del ratón para zoom.
- Botones para acercar, alejar y restablecer.
- Arrastre del fondo para mover la red.
- Filtros de peso mínimo y número de elementos visibles.
- Inspector de nodos/aristas, tabla contextual y descarga CSV.

## Interpretación detallada de la red

### Principio general de interpretación

La aplicación describe **evidencia observable en el JSON**. Un valor alto significa que una cuenta o un contexto aparece muchas veces en los datos disponibles; no demuestra por sí mismo influencia, popularidad, afinidad política, amistad ni una relación personal.

En las redes:

- El **tamaño del nodo** representa la cantidad de evidencia o el puntaje visible.
- El **grosor de la arista** representa el peso del vínculo.
- La **distancia entre nodos** sirve para facilitar la lectura y agrupar hubs o componentes; por sí sola no es un puntaje.
- Al seleccionar un criterio específico, el tamaño y el grosor se recalculan utilizando únicamente ese criterio.
- En modo combinado, las fuentes se suman con los pesos elegidos.

---

### Red Cuenta principal ↔ otros

La cuenta principal permanece en el centro. Cada nodo periférico representa otra cuenta y cada arista una fuente de relación derivada de las publicaciones.

### Fórmula del puntaje combinado

```text
puntaje =
comentarios capturados × peso_comentarios
+ publicaciones comentadas × peso_publicaciones
+ menciones × peso_menciones
+ cuentas etiquetadas × peso_etiquetas
+ coautores × peso_coautores
```

Los pesos iniciales son `1` y pueden ajustarse entre `0` y `5`. Desactivar una fuente equivale a asignarle peso `0`.

### Comentarios capturados

Cada comentario único incluido en `latestComments` cuenta una vez para la cuenta que lo escribió.

```text
comentarios capturados = comentarios de la cuenta presentes en latestComments
```

Ejemplo:

| Cuenta | Comentarios capturados | Publicaciones comentadas |
| --- | ---: | ---: |
| Cuenta A | 3 | 1 |
| Cuenta B | 1 | 1 |

La cuenta A escribió tres veces en una publicación; la cuenta B escribió una vez.

**Qué indica:** actividad directa con el contenido.

**Limitación:** esta columna no usa el total de `commentsCount`. Si Instagram informa 250 comentarios y el archivo solo conserva una muestra de 12, solo se pueden atribuir 12 comentarios a cuentas concretas. Los comentarios ausentes no se distribuyen artificialmente.

### Publicaciones comentadas

Es la cantidad de publicaciones distintas donde la cuenta tiene al menos un comentario capturado.

```text
publicaciones comentadas =
número de publicaciones diferentes con comentarios de la cuenta
```

Ejemplo:

| Comentarios capturados | Publicaciones comentadas |
| ---: | ---: |
| 4 | 2 |

La cuenta escribió tres comentarios en una publicación y uno en otra. El ranking muestra `4` comentarios y `2` publicaciones.

**Qué indica:** si la interacción está concentrada en una publicación o distribuida en varios contenidos.

Esta columna reduce el efecto de una cuenta que escribe muchos comentarios en un solo contenido.

### Menciones

Una cuenta mencionada en el texto de una publicación, normalmente mediante `@usuario`.

Cada cuenta cuenta como máximo una vez por publicación.

```text
menciones =
número de publicaciones donde la cuenta aparece en mentions
```

**Qué indica:** una referencia explícita de la autora hacia esa cuenta.

**Interpretación:** tiene más intención que una mención indirecta, pero no necesariamente significa acuerdo, gratitud o colaboración. También puede ser una referencia informativa.

### Cuentas etiquetadas

Cuentas presentes en el contenido mediante `taggedUsers`, normalmente etiquetadas en una imagen o vídeo.

Cada cuenta cuenta como máximo una vez por publicación.

**Qué indica:** presencia visual dentro de la publicación.

**Interpretación:** aparecer etiquetado no demuestra acuerdo, apoyo ni colaboración. Una persona puede estar en una imagen sin participar en la publicación.

### Coautores

Cuentas registradas en `coauthorProducers`.

Cada cuenta cuenta como máximo una vez por publicación.

**Qué indica:** una colaboración explícita registrada por el scraper o por Instagram.

**Interpretación:** suele ser la señal más directa de colaboración disponible en el JSON, aunque describe una asociación técnica con la publicación y no necesariamente una relación personal completa.

---

### Cómo elegir los pesos

Los pesos permiten decidir qué señales considero más importantes. No existe un peso universalmente correcto.

Ejemplo de configuración:

| Fuente | Peso | Justificación |
| --- | ---: | --- |
| Comentarios | 1 | Interacción frecuente, pero basada en una muestra. |
| Publicaciones | 2 | Valora la continuidad entre varios contenidos. |
| Menciones | 3 | Señal explícita de la autora hacia la cuenta. |
| Etiquetas | 1 | Presencia visual, sin asumir acuerdo. |
| Coautores | 5 | Colaboración explícita. |

Ejemplo de cálculo:

Una cuenta tiene:

- 2 comentarios capturados;
- 2 publicaciones comentadas;
- 1 mención;
- 1 cuenta etiquetada;
- 1 coautoría.

Con los pesos del ejemplo:

```text
2×1 + 2×2 + 1×3 + 1×1 + 1×5 = 15 puntos
```

El resultado sigue siendo una suma de evidencia observada, no una probabilidad, porcentaje de influencia ni clasificación de la cuenta.

---

### Columnas del ranking de Cuentas relacionadas

Este ranking corresponde a la red **Cuenta principal ↔ otros**.

#### Cuenta

Muestra el nombre de usuario y, debajo, el nombre público cuando Instagram lo proporciona.

Ejemplo:

```text
@cuenta
Nombre público de la cuenta
```

Al seleccionar la fila se resalta el nodo dentro de la red. El enlace abre el perfil de Instagram.

#### Puntaje

Es el valor utilizado para ordenar el ranking de mayor a menor.

- En modo combinado, suma todas las fuentes multiplicadas por sus pesos.
- En un criterio específico, es exactamente el valor de ese criterio.
- No está normalizado y no tiene un máximo de 100.

Una cuenta puede superar a otra porque acumula más evidencia, participa en más fuentes o aparece en más publicaciones.

#### Comentarios

Es la cantidad de comentarios capturados de la cuenta en `latestComments`.

No es el total de comentarios de la publicación ni una atribución proporcional de `commentsCount`.

#### Publicaciones

Es la cantidad de publicaciones distintas donde la cuenta tiene al menos un comentario capturado.

Puede ser menor que **Comentarios** cuando una cuenta escribe varias veces en la misma publicación.

#### Menciones

Es la cantidad de publicaciones donde la cuenta aparece en `mentions`.

#### Etiquetas

Es la cantidad de publicaciones donde la cuenta aparece en `taggedUsers`.

#### Coautores

Es la cantidad de publicaciones donde la cuenta aparece en `coauthorProducers`.

#### Ejemplo completo

| Cuenta | Puntaje | Comentarios | Publicaciones | Menciones | Etiquetas | Coautores |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| @cuenta | 14 | 6 | 4 | 2 | 1 | 1 |

Con todos los pesos en `1`:

```text
6 + 4 + 2 + 1 + 1 = 14
```

Esto no significa que la cuenta haya realizado “14 interacciones”. Significa que acumula 14 unidades de evidencia según la configuración elegida.

---

### Efecto del alcance

El selector **Alcance** cambia los valores del ranking, las redes y las gráficas.

#### Publicaciones propias

Incluye solamente publicaciones cuyo `ownerUsername` coincide con la cuenta principal. Es el alcance recomendado para estudiar exclusivamente el contenido y la actividad asociados a esa cuenta.

#### Incluye colaboraciones

Añade publicaciones de otras autoras donde la cuenta principal aparece en `mentions`, `taggedUsers` o `coauthorProducers`.

#### Todo el archivo

Incluye todas las publicaciones, aunque no estén relacionadas directamente con la cuenta principal.

Ampliar el alcance puede aumentar los puntajes, pero también puede mezclar interacciones que no corresponden exclusivamente a la cuenta analizada. Conviene comparar resultados utilizando el mismo alcance.

---

### Red Otros ↔ otros

Esta red conecta únicamente cuentas periféricas. No utiliza la suma de comentarios, menciones, etiquetas y coautores de la red central.

Dos cuentas se conectan cuando ambas dejan comentarios capturados en la misma publicación.

```text
peso(A, B) =
número de publicaciones donde aparecen comentarios de A y de B
```

Ejemplo:

- Cuenta A y cuenta B comentan la publicación 1.
- También comentan la publicación 4.

La arista tiene peso `2`.

El ranking de esta vista contiene:

| Columna | Significado |
| --- | --- |
| Cuenta A | Primera cuenta del par. |
| Cuenta B | Segunda cuenta del par. |
| Publicaciones | Cantidad de publicaciones donde ambas comentan. |

#### Fuerza de una coincidencia

- Una coincidencia es una señal débil.
- Dos o más publicaciones compartidas hacen el vínculo más repetido dentro de los datos.
- La coincidencia no demuestra que las cuentas se conozcan, se escriban o interactúen fuera de Instagram.

La red coloca los nodos con más enlaces cerca del centro y agrupa componentes densos. La proximidad facilita la exploración, pero no reemplaza al peso de la arista.

---

### Red Cuenta principal ↔ contexto

Esta red relaciona la cuenta principal con atributos del contenido, no con otras cuentas.

#### Location Name

Agrupa publicaciones que tienen el mismo nombre de ubicación.

```text
peso de una ubicación =
número de publicaciones con esa Location Name
```

Ejemplo:

```text
San Cristobal Sur, Bogotá → 4 publicaciones
```

Una ubicación demuestra que la publicación fue etiquetada con ese lugar. No demuestra que la autora estuviera físicamente allí ni que resida en esa ubicación.

#### Music Info

Agrupa publicaciones que comparten la misma pista. La pista se identifica preferiblemente mediante `audio_id`; si no existe, se utiliza la combinación de artista y nombre de canción.

```text
peso de una pista =
número de publicaciones que usan esa Music Info
```

Music Info solo aparece cuando el scraper capturó información de audio. Las publicaciones sin audio identificado no aparecen en esta fuente.

El ranking de contexto contiene:

| Columna | Significado |
| --- | --- |
| Contexto | Nombre del lugar o de la pista musical. |
| Publicaciones | Cantidad de publicaciones que comparten ese contexto. |

Esta red describe contexto de contenido; no representa una relación interpersonal.

---

### Interpretación de las gráficas mensuales

#### Publicaciones por mes

Cuenta las publicaciones con fecha dentro de cada mes.

No se llenan meses sin publicaciones; solo se muestran meses donde existe actividad.

#### Likes por mes

Suma `likesCount` para las publicaciones de cada mes.

Los likes son agregados. La gráfica no identifica qué cuentas dieron like.

#### Colaboraciones por mes

Suma los autores distintos registrados en `coauthorProducers`, contando cada autor una sola vez por publicación.

```text
colaboraciones_del_mes =
Σ autores_únicos_por_publicación
```

Este valor puede ser mayor que el número de publicaciones porque una publicación puede tener varios coautores.

---

### Por qué los likes no aparecen en el ranking

El JSON contiene:

```text
likesCount = total de likes de la publicación
```

Pero no contiene las cuentas que dieron like. Por esa razón no se puede crear un vínculo verificable entre la cuenta principal y cada persona que dio like. Los likes sí se utilizan en:

- el total de indicadores;
- la gráfica de likes por mes;
- el orden de publicaciones destacadas.

---

### Lista de verificación antes de comparar cuentas

Antes de comparar dos cuentas, comprobar:

1. Que ambas usan el mismo alcance.
2. Qué criterio de ponderación está seleccionado.
3. Cuántos pesos tiene cada fuente.
4. Qué porcentaje de comentarios está disponible.
5. Si se está comparando una red central con una red de co-comentadores o contexto.
6. Si el puntaje está normalizado o es una suma directa.
7. Si las diferencias se deben a una muestra de comentarios desbalanceada.

---

### Recomendaciones de interpretación

- Usar **Comentarios** para volumen de interacción observada.
- Usar **publicaciones comentadas** para medir continuidad entre contenidos.
- Usar **menciones** para referencias explícitas de la autora.
- Usar **etiquetas** para presencia visual, sin asumir apoyo.
- Usar **coautores** para colaboración explícita.
- Usar **otros–otros** para encontrar co-comentarios repetidos, no como prueba de amistad.
- Usar **contexto** para patrones de lugar y música, no para relaciones personales.
- No convertir un puntaje alto en una clasificación de influencia, popularidad, afinidad política o intención social.

## Series mensuales

Las fechas se agrupan por año y mes. Las publicaciones sin fecha se excluyen de las gráficas. Para las colaboraciones:

```text
colaboraciones_del_mes = Σ autores_únicos_en_coauthorProducers_por_publicación
```

## Limitaciones

- `latestComments` es una muestra; muchos comentarios reportados no tienen una cuenta identificable en el JSON.
- `likesCount` es un agregado y no identifica quién dio like.
- Los vínculos otros–otros prueban co-presencia en comentarios, no una relación social directa.
- `Location Name` es una etiqueta de contenido, no evidencia de ubicación física.
- `Music Info` solo representa publicaciones donde el campo fue capturado.
- Los datos pueden contener información personal y deben usarse de forma proporcional y respetuosa.

## Pestaña Manual

La aplicación incluye una pestaña **Manual** con instrucciones, fórmulas, definiciones de las tres redes, interpretación de las series mensuales y buenas prácticas de zoom.

## Pruebas

```bash
python -m unittest discover -s tests -v
```

Las pruebas usan `unittest` y no necesitan dependencias externas.
