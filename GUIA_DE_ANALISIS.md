# Guía completa del informe de una cuenta de Instagram

## 1. Qué es este informe

Esta aplicación convierte archivos JSON de Instagram en un informe visual. Su objetivo es responder preguntas como:

- ¿Qué publicaciones contiene la fuente?
- ¿Cuántos likes y comentarios se reportan?
- ¿Qué cuentas aparecen como autores de interacciones cuando el archivo permite identificarlas?
- ¿Con qué cuentas se registra una colaboración?
- ¿Cómo se distribuyen las interacciones identificadas?
- ¿Qué cambios se observan a lo largo del tiempo?
- ¿Qué estructuras aparecen en las redes?

El informe es **descriptivo**. Describe señales que aparecen en los archivos; no demuestra por qué ocurrió algo, no predice el comportamiento futuro y no convierte una coincidencia en una relación personal o política.

### Principio de trabajo

1. Se leen los archivos recibidos.
2. Se explora la estructura sin suponer que todos los archivos tienen el mismo formato.
3. Se hace una copia en memoria.
4. Se normalizan usernames, fechas e identificadores sólo para calcular.
5. Se selecciona la cuenta y el alcance.
6. Se calculan indicadores, series, tablas y redes.
7. Se muestran los resultados con explicación y límites.

**Los archivos originales nunca se sobrescriben.**

---

## 2. La diferencia entre una cuenta principal y una cuenta secundaria

### Cuenta principal

Es la cuenta que el informe decide analizar. Puede seleccionarse manualmente o detectarse automáticamente como la cuenta que aparece como autora en más publicaciones.

La cuenta principal no es necesariamente la cuenta más popular, la que más likes tiene ni la que aparece como autora de todos los registros. Es simplemente la unidad de análisis seleccionada.

### Alcances disponibles

| Alcance | Qué publicaciones incluye | Cuándo usarlo |
|---|---|---|
| **Publicaciones propias** | Sólo publicaciones cuyo `ownerUsername` corresponde a la cuenta principal. | Analizar el contenido publicado directamente por la cuenta. |
| **Propias y colaboraciones** | Publicaciones propias y publicaciones de otras cuentas donde la principal aparece como autora invitada, etiquetada, mencionada o acreditada. | Ver publicaciones en las que participa la cuenta principal aunque la autora técnica sea otra. |
| **Todos los registros** | Todas las publicaciones disponibles en los archivos cargados. | Comparar el conjunto completo, sabiendo que puede mezclar autores y cuentas seleccionadas. |

En el alcance **Propias y colaboraciones**, una publicación de otra cuenta puede entrar porque la cuenta principal aparece en uno de estos campos:

- `coauthorProducers` u otro campo de colaboración;
- `mentions`;
- `taggedUsers`.

Eso no significa que la otra cuenta sea la misma persona ni que exista una relación personal. Sólo significa que el registro contiene una asociación explícita.

En **Todos los registros** también pueden aparecer publicaciones de otras autoras. Por eso las cifras de likes, comentarios y audiencia pueden mezclar cuentas. El panel indica el alcance utilizado.

### Varios archivos

Los archivos pueden combinarse mediante:

- `id`;
- `shortCode`;
- URL de la publicación;
- usernames normalizados;
- fechas, como criterio de contexto y no como identificador único.

Si dos registros tienen el mismo identificador de publicación, se cuenta una sola publicación y se conservan los nombres de los archivos de origen. No se modifican los datos originales.

---

## 3. Diccionario de datos

### Publicación

Una publicación es el registro principal que describe un contenido de Instagram. Puede ser una imagen, un vídeo, un reel o un carrusel.

En los archivos actuales, una publicación suele tener:

| Campo común | Significado |
|---|---|
| `id` | Identificador interno de la publicación. |
| `shortCode` | Código corto que aparece en el enlace de Instagram. |
| `url` | Enlace de la publicación. |
| `ownerUsername` | Usuario de la cuenta autora. |
| `ownerFullName` | Nombre público de la cuenta autora. |
| `timestamp` | Fecha y hora reportadas por el scraper. |
| `caption` | Texto de la publicación. |
| `type` | Tipo técnico: `Image`, `Video`, `Sidecar`, etc. |
| `likesCount` | Cantidad agregada de likes. |
| `commentsCount` | Cantidad agregada de comentarios reportados. |
| `latestComments` | Muestra de comentarios recientes, si fue capturada. |
| `coauthorProducers` | Cuentas acreditadas como coautoras. |
| `taggedUsers` | Cuentas etiquetadas en la imagen o el vídeo. |
| `mentions` | Usuarios mencionados en el texto. |

Los `childPosts` de un carrusel no se cuentan como publicaciones independientes en el informe principal. Se mantienen como parte de la publicación principal para no duplicar la unidad de análisis.

### Like

Hay dos cosas distintas que pueden llamarse “likes”:

1. **Like agregado**: `likesCount`. Es un número total. Permite comparar publicaciones, pero no dice quién dio like ni cuántas personas diferentes participaron.
2. **Like identificado**: un registro como `likerUsername`, `likedBy`, `likers` o un evento separado con usuario y publicación. Este sí permite construir una tabla de cuentas.

En los archivos actuales, `likesCount` existe, pero no hay identidades de likers. Por eso el informe utiliza los likes para las gráficas de publicaciones y utiliza los comentarios identificados para el mapa de audiencia. No rellena el hueco inventando nombres.

Un valor `-1`, `null` o un campo ausente se trata como **likes no disponibles**, no como cero likes.

### Comentario

Un comentario es un texto asociado a una publicación y, cuando el archivo lo permite, a una cuenta autora.

- **Comentarios reportados**: `commentsCount`. Es el total que Instagram informa para la publicación.
- **comentarios capturados**: registros presentes en `latestComments` o en un archivo separado de comentarios.
- **comentarios únicos**: registros después de eliminar duplicados cuando tienen el mismo identificador.

El total reportado y la muestra capturada no deben mezclarse. Si Instagram informa 500 comentarios y el archivo conserva 12, el informe puede analizar esas 12 cuentas, pero no puede atribuir los otros 488.

### Interacción identificada

Es un evento que la fuente permite asociar a una cuenta concreta:

- un like con usuario identificado;
- un comentario con `ownerUsername` o usuario equivalente.

En el informe:

```text
interacciones identificadas = likes identificados + comentarios capturados identificados
```

Un like agregado no se convierte en interacción identificada. Si no hay likers, la cifra de interacciones de audiencia se basa en comentarios u otros eventos explícitos.

### Mención

Una mención es una referencia a una cuenta en el texto de la publicación. No equivale a like, comentario ni colaboración. La aplicación la muestra como contexto relacional, pero no la cuenta como interacción de audiencia.

### Etiqueta

Una etiqueta aparece en el contenido visual, por ejemplo `taggedUsers`. Indica que una cuenta fue etiquetada; no demuestra que la cuenta haya interactuado con la principal ni que exista una relación personal. Se mantiene aparte de las interacciones.

### Colaboración

Una colaboración es una cuenta que aparece en un campo de coautoría o colaboración, normalmente `coauthorProducers`.

Regla de conteo:

- una cuenta se cuenta una vez por publicación;
- si aparece repetida dentro de la misma publicación, no se duplica;
- la cuenta principal se excluye del grupo de colaboradores porque es el nodo central;
- una colaboración no se convierte automáticamente en interacción.

La colaboración describe una asociación técnica o editorial registrada en la fuente. No demuestra que las personas se conozcan, sean amigas, compartan una organización o tengan una relación política.

### Seguidor

Un seguidor es una cuenta incluida en un campo `followers` o similar. La lista de seguidores es diferente de la audiencia observada.

Una cuenta sólo se suma a las interacciones cuando el registro indica una interacción concreta y, cuando sea posible, la publicación asociada. Tener el mismo nombre de usuario en un archivo de seguidores no significa que esa persona haya interactuado con la cuenta principal.

### Comentario de una publicación de otra cuenta

Cuando el alcance es `involving` o `all`, una publicación puede ser de otra autora. Los comentarios y likes que se atribuyen a esa publicación se cuentan para el conjunto seleccionado, pero no se presentan como publicaciones propias de la cuenta principal.

---

## 4. Fórmulas y cálculos

Las fórmulas siguientes se explican para que una persona sin conocimientos técnicos pueda entender qué significa cada indicador.

### Conteos y sumas

- **Número de publicaciones**: cantidad de registros seleccionados.
- **Likes totales conocidos**: suma de `likesCount` sólo cuando el valor es válido. Los valores faltantes o `-1` se excluyen.
- **Comentarios reportados**: suma de `commentsCount`.
- **Comentarios capturados**: número de registros de comentarios disponibles en la fuente.
- **Cuentas únicas**: cantidad de usernames diferentes después de normalizar mayúsculas, espacios y `@`.

### Promedio

```text
promedio = suma de likes conocidos / publicaciones con likes conocido
```

El promedio cambia mucho si una publicación es excepcionalmente alta. Por eso se muestra junto con la mediana.

### Mediana

La mediana ordena los likes de menor a mayor y toma el valor central. Si hay un número par de publicaciones, se promedian los dos valores centrales.

La mediana es útil cuando hay valores extremos: puede describir mejor la publicación “normal” que el promedio.

### Desviación estándar

La aplicación usa la desviación estándar poblacional:

```text
desviación = raíz(media de (likes - promedio)^2)
```

Mide qué tan lejos están los valores respecto del promedio. Una desviación grande indica que las publicaciones tienen niveles de likes muy distintos.

### Percentiles

Los percentiles ordenan los likes y encuentran un punto de corte:

- **P25**: el 25 % de las publicaciones está en o por debajo de este valor.
- **P50**: la mediana.
- **P75**: el 75 % está en o por debajo de este valor.
- **P90 y P95**: percentiles altos, útiles para contextualizar las publicaciones excepcionales.

La aplicación interpola linealmente entre posiciones ordenadas cuando el percentil cae entre dos valores.

### Likes por publicación

```text
likes por publicación = suma de likes conocidos / número total de publicaciones
```

También se calcula un promedio separado para publicaciones con likes y para publicaciones sin dato. Esta distinción evita confundir “no hay likes” con “no hay información de likes”.

### Frecuencia de publicación

```text
frecuencia mensual = publicaciones / meses con actividad
```

El periodo se calcula desde la primera hasta la última fecha válida. Si sólo hay una fecha, se informa una frecuencia observada simple; no se inventa una ventana temporal.

### Posición respecto al promedio

Para una publicación:

```text
posición relativa = (likes de la publicación - promedio) / promedio
```

- Positivo: más likes que el promedio.
- Negativo: menos likes que el promedio.
- Cerca de cero: nivel habitual.

---

## 5. Distribuciones y publicaciones excepcionales

### Histograma

El histograma agrupa las publicaciones en ocho rangos de likes, por defecto. Permite ver si la mayoría se concentra en un nivel o si hay varios grupos muy separados.

### Caja y bigotes

La caja representa el rango entre P25 y P75. La línea interior es la mediana. Los bigotes muestran valores habituales y los puntos isolated pueden señalar valores extremos.

### Valores atípicos

Una publicación se marca como excepcional si cumple al menos una de estas reglas:

1. supera `P75 + 1,5 × (P75 - P25)`;
2. está a dos o más desviaciones estándar del promedio.

La aplicación no afirma que una publicación excepcional fue producida por una causa concreta. Sólo dice que su nivel de likes se aleja del comportamiento habitual de la fuente.

### Gráfica de rendimiento

La gráfica de dispersión coloca cada publicación en el tiempo:

- eje horizontal: orden temporal;
- eje vertical: likes;
- color: si la publicación tiene colaboración.

Es una comparación descriptiva. No permite saber si la colaboración produjo el cambio.

---

## 6. Evolución y series temporales

Las series agrupan publicaciones con fecha válida por mes o por semana. Las publicaciones sin fecha no se inventan ni se asignan a un mes.

### Línea temporal de la cuenta

Colores:

| Color | Serie | Significado |
|---|---|---|
| Azul | Publicaciones | Número de publicaciones del mes. |
| Coral | Likes conocidos | Suma de likes con dato en el mes. |
| Ámbar | Comentarios reportados | Suma de `commentsCount` del mes. |
| Verde | Colaboraciones | Número de cuentas colaboradoras distintas por publicación/mes. |

### Historia de la audiencia

Colores:

| Color | Serie | Significado |
|---|---|---|
| Azul | Cuentas activas | Cuentas con al menos un evento de interacción identificado en el mes. |
| Coral | Cuentas nuevas | Cuentas activas que no habían aparecido en meses anteriores del informe. |
| Gris | Cuentas no observadas | Cuentas que aparecieron antes y no tienen un evento en ese mes. |

“Cuenta no observada” no significa que la cuenta haya desaparecido de Instagram. Sólo significa que no aparece en los registros disponibles para ese mes.

La simultaneidad entre dos líneas no demuestra causalidad. Por ejemplo, que una publicación y una colaboración coincidan en el mismo mes no demuestra que una haya producido la otra.

---

## 7. Audiencia y recurrencia

### Tabla de cuentas

Cada fila puede contener:

- usuario;
- interacciones identificadas;
- publicaciones distintas en las que apareció;
- primera y última aparición;
- categoría de recurrencia;
- likes y comentarios separados, cuando existen.

### Categorías de recurrencia

Son una clasificación creada para este informe:

| Categoría | Regla implementada | Lectura sencilla |
|---|---|---|
| **Ocasional** | Una interacción o un solo mes de actividad. | Aparece poco o en un solo periodo. |
| **Recurrente** | Más de una interacción y más de un mes, pero no cumple la regla persistente. | Vuelve a aparecer. |
| **Persistente** | Al menos tres interacciones y al menos tres meses o una ventana de 60 días. | Aparece varias veces y durante un periodo más largo. |

Una cuenta con muchas interacciones dentro de un solo mes puede quedar como “ocasional” según esta regla. Es una clasificación透明 de repetición, no una etiqueta social.

### Mapa de audiencia

La cuenta principal se coloca al centro. Cada nodo periférico es una cuenta identificada. El tamaño del nodo representa la frecuencia observada. En la interfaz:

- azul: interacción identificada por comentarios;
- verde: identificada por likes;
- morado: aparece en ambos tipos;
- centro oscuro: cuenta principal.

Una línea representa una relación con la cuenta principal. No se necesita una línea si la fuente no identifica la interacción.

---

## 8. Concentración, Lorenz y Gini

### Grupos más recurrentes: top 5, top 10 y top 20

Se ordenan las cuentas por interacciones identificadas y se calcula:

```text
participación del grupo N =
interacciones del grupo N / todas las interacciones identificadas
```

Ejemplo: si el grupo de las 10 cuentas más recurrentes representa 35 %, significa que esas diez cuentas concentran el 35 % de los eventos atribuibles a una cuenta en la fuente. No significa que esas personas hayan recibido el 35 % del alcance de Instagram.

### Índice de Gini

Para valores ordenados `x(1) ≤ ... ≤ x(n)`:

```text
G = (2 × suma(i × x(i))) / (n × suma(x)) - (n + 1) / n
```

- Gini cercano a 0: reparto relativamente uniforme.
- Gini cercano a 1: concentración alta.

El cálculo usa únicamente interacciones con cuenta identificada. Si no hay likers, normalmente se basa en comentarios capturados.

### Curva de Lorenz

La curva ordena las cuentas de menor a mayor interacción y acumula:

- eje horizontal: proporción de cuentas;
- eje vertical: proporción de interacciones.

Cuanto más se aleje de la diagonal, más concentrada es la interacción observada. La curva no corrige sesgos de cobertura.

---

## 9. Colaboraciones

### Conteo

El total de colaboraciones suma las cuentas colaboradoras distintas de cada publicación. Si una cuenta aparece en tres publicaciones, cuenta como tres colaboraciones.

### Comparación

Se separan publicaciones:

- con al menos una colaboración;
- sin colaboración.

Se comparan cantidad, likes conocidos, promedio, mediana, desviación, máximo y mínimo. La diferencia de promedios se muestra como observación. No se interpreta como causalidad porque los grupos pueden diferir en fecha, contenido, formato o tamaño de cuenta.

### Relación entre colaboración e interacción

La aplicación muestra si una cuenta:

- aparece en ambas redes;
- sólo tiene interacciones;
- sólo aparece como colaboradora;
- no aparece en ninguna de las dos relaciones.

Estas son relaciones distintas. Una cuenta puede colaborar sin que exista un like o comentario identificable, y puede comentar sin colaborar.

---

## 10. Redes y modelos matemáticos

Las redes son modelos matemáticos aplicados para visualizar relaciones observadas.

### Red de interacción

- nodo: cuenta;
- nodo central: cuenta principal;
- arista: interacción identificada con la cuenta principal;
- peso: número de interacciones identificadas.

### Red de colaboración

- nodo: cuenta;
- arista: colaboración;
- peso: número de publicaciones en las que aparece como colaboradora.

### Red de coincidencia

Dos cuentas periféricas se conectan si ambas aparecen como cuentas con interacción en una misma publicación. El peso es el número de publicaciones compartidas.

Esto no demuestra que las cuentas se hablen. Es una coincidencia documental.

### Grado

El grado cuenta cuántos vecinos tiene un nodo. El grado ponderado suma los pesos de sus vínculos. Un nodo con más vínculos puede parecer más central, pero eso sólo describe la red.

### Intermediación (betweenness)

La intermediación o *betweenness* estima qué proporción de los caminos más cortos entre pares de nodos pasa por cada cuenta. En términos sencillos:

> una cuenta puente aparece en muchos caminos que conectan partes distintas de la red.

La cuenta con mayor intermediación no es automáticamente líder, más popular o más influyente. Es una posición estructural dentro de los datos disponibles.

### Componentes y comunidades

La aplicación calcula componentes conectados. Una comunidad es un conjunto de cuentas conectadas entre sí. No se interpreta automáticamente como grupo de amigos, partido, familia u organización.

También se calcula modularidad como una medida de qué tan separadas están las comunidades. El valor sólo describe la partición de la red; no demuestra una frontera social real.

### Núcleo k-core

El *k-core* conserva un núcleo de cuentas con mayor número de vínculos. Sirve para identificar una parte más densamente conectada. Si la red es demasiado pequeña o dispersa, el resultado puede ser trivial.

---

## 11. Matriz publicación × cuenta

Cada fila es una cuenta y cada columna es una publicación. El valor es el número de interacciones identificadas de esa cuenta en esa publicación.

- `0` o celda vacía: no se observó interacción identificada.
- `1`: un evento identificado.
- `2` o superior: varios eventos identificados.

La vista se limita a un número de cuentas y publicaciones para no bloquear el navegador. El panel indica cuando está recortada. La matriz no representa la audiencia completa ni demuestra causalidad.

---

## 12. Tipos de publicación

La clasificación usa principalmente el campo técnico:

| Tipo técnico | Categoría de lectura |
|---|---|
| `Image`, `Photo` | Imagen |
| `Video`, `IGTV` | Vídeo |
| `Reel` | Reel |
| `Sidecar`, `Carousel` | Carrusel |
| Sin tipo claro | Otro / sin clasificar |

Si el tipo falta, la aplicación puede usar campos técnicos como `videoUrl` o la cantidad de imágenes. No intenta interpretar el tema, la emoción o la intención de una publicación.

---

## 13. Correlaciones

Se calculan correlaciones de Pearson y Spearman cuando hay al menos tres observaciones y las variables no son constantes.

### Pearson

Pearson mide si dos variables numéricas se mueven juntas de forma aproximadamente lineal. Un valor positivo indica asociación en el mismo sentido; uno negativo, en sentidos opuestos. El valor no dice cuál causa cuál.

### Spearman

Spearman transforma los valores en posiciones ordinales y calcula una asociación basada en el orden. Es menos sensible a valores extremos.

La fuerza mostrada se basa en el valor absoluto de la correlación:

| Valor absoluto | Etiqueta |
|---:|---|
| menor que 0,2 | muy débil |
| 0,2 a menos de 0,4 | débil |
| 0,4 a menos de 0,6 | moderada |
| 0,6 a menos de 0,8 | fuerte |
| 0,8 o más | muy fuerte |

La etiqueta no es una prueba estadística de significación. No se calculan causalidad, p-valores ni predicciones.

---

## 14. Hallazgos, preguntas y límites

Cada hallazgo intenta seguir esta estructura:

```text
Hallazgo → evidencia → visualización → advertencia
```

Las preguntas abiertas son cosas que los datos sugieren investigar, pero que no pueden responder por sí solos. El informe añade un `profile_narrative` con seis dimensiones —ritmo, contenido, respuesta, conversación, colaboración y red— para ofrecer una lectura más humana de la cuenta sin convertir datos en un diagnóstico. Cada dimensión conserva evidencia, pregunta y límite.

Las limitaciones indican:
- qué campos faltan;
- qué cobertura es parcial;
- qué diferencia hay entre likes agregados e interacciones identificadas;
- qué no se puede saber sobre audiencia, alcance o relaciones personales;
- qué sesgos puede tener la descarga.

---

## 15. Cómo leer cada sección del panel

| Sección | Pregunta principal | Qué revisar primero |
|---|---|---|
| ¿Qué datos tenemos? | ¿Qué archivos y variables existen? | Roles, cobertura y campos ausentes. |
| Publicaciones | ¿Qué se publicó y cómo respondió? | Likes por publicación, distribución y excepciones. |
| Audiencia | ¿Quiénes aparecen y con qué frecuencia? | Identificación de likes, comentarios y cobertura. |
| Colaboraciones | ¿Con quién y con qué diferencia? | Comparación de grupos sin inferir causa. |
| Redes | ¿Cómo se conectan las cuentas? | Peso, comunidades e intermediación. |
| Evolución | ¿Qué cambia con el tiempo? | Leyendas de colores y periodos sin fecha. |
| Hallazgos | ¿Qué resume el informe? | Evidencia y advertencia de cada hallazgo. |

---

## 16. Nota sobre los archivos actuales

Los cuatro JSON disponibles en el proyecto (`Cesar.json`, `Daniela.json`, `Hader.json` y `Maira.json`) contienen publicaciones con `likesCount`, comentarios en `latestComments`, menciones, etiquetas y coautores. No contienen una lista identificable de personas que dieron like.

Por eso:

- las gráficas de likes son válidas como métricas agregadas;
- la audiencia disponible se reconstruye principalmente con comentarios identificados;
- el mapa de audiencia no debe presentarse como el total de personas que interactuaron;
- cualquier conclusión sobre alcance, comunidad o influencia debe incluir esa limitación.

---

## 17. Reproducibilidad y privacidad

- El análisis trabaja sobre copias en memoria.
- No se escriben archivos derivados junto a los JSON originales.
- Los nombres originales se conservan para mostrar la fuente.
- Los identificadores se normalizan para unir registros, pero la información original se conserva en la fuente.
- El informe no necesita enviar los archivos a un servicio externo.
- La aplicación Flask sirve el dashboard visual por páginas HTML independientes y puede protegerse con `ADMIN_USER` y `ADMIN_PASSWORD` en el servidor.

Para una lectura responsable, la pregunta correcta no es “¿esta persona es influyente?”, sino:

> ¿qué relación observable aparece en estos archivos, con qué cobertura y qué límites?
