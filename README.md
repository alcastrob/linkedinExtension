# LinkedIn Notas

Extensión de Chrome (Manifest V3) para añadir, editar y eliminar comentarios privados sobre
personas que aparecen en LinkedIn. Los comentarios se guardan en una carpeta local, un fichero
Markdown por persona.

## Instalación

1. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
2. **Cargar descomprimida** → selecciona esta carpeta.
3. Haz clic en el icono de la extensión: se abre la página de opciones.
4. **Elegir carpeta…** y concede permiso de lectura/escritura. Chrome no permite carpetas
   protegidas del sistema (Documentos, Descargas, Escritorio…): usa una subcarpeta.
   Si Chrome ofrece "Permitir en cada visita", acéptalo para no tener que reconectar.

## Uso

En resultados de búsqueda, feed y perfiles aparece un botón `📝 +` junto al nombre de cada persona.
Al pulsarlo se abre un panel para añadir, editar y eliminar comentarios. El último comentario
se muestra como etiqueta amarilla junto al nombre.

## Formato de los ficheros

Un fichero por persona, con el slug de su URL (`/in/<slug>/`) como nombre: `<slug>.md`.

```markdown
---
name: "Nombre Apellido"
url: https://www.linkedin.com/in/slug-del-perfil/
---

## 2026-10-10 11:40

Conocida del evento. Interesante para el proyecto X.

## 2026-10-12 09:15

Me respondió al mensaje, propone llamada.
```

- Cada sección `##` es un comentario; su título es la fecha de creación.
- Los comentarios no llevan identificador: se localizan por posición y se comprueba su texto,
  de modo que si editas un fichero a mano mientras el panel está abierto, la operación se
  descarta y el panel se refresca en vez de pisar nada.
- Texto escrito a mano antes de la primera sección cuenta como un comentario sin fecha
  (se guardará con el título `## Sin fecha`).
- Una línea de un comentario que empiece por `## ` se guarda escapada (`\## `).
- Al eliminar el último comentario de una persona se borra su fichero.
- Los caracteres no seguros del slug en nombres de fichero se codifican como `%XX`.

Los ficheros se releen en cada operación, así que puedes editarlos a mano.

## Comportamiento sin acceso a la carpeta

Si el permiso caduca o la carpeta no está disponible, los cambios se guardan en `chrome.storage.local`
y se vuelcan a sus ficheros al reconectar (para las personas modificadas, la caché prevalece sobre
el fichero). Si eliges una carpeta vacía, se vuelca a ella el contenido de la caché.

## Limitaciones

- LinkedIn cambia su HTML con frecuencia. La detección se basa en enlaces `a[href*="/in/"]` con texto
  y en el `h1` del perfil; si algún bloque no muestra el botón, hay que ajustar `processAnchor` y
  `placeBadge` en `content.js`.
- Chrome no permite que una extensión lea/escriba carpetas arbitrarias sin que el usuario las elija
  (File System Access API); por eso hay que seleccionarla una vez.
- Cada carga lee todos los `.md` de la carpeta; con miles de personas habría que añadir caché por fecha
  de modificación.
