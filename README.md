# LinkedIn Notas

Extensión de Chrome (Manifest V3) para añadir, editar y eliminar un titular privado sobre
personas que aparecen en LinkedIn. Los titulares se guardan en una carpeta local, un fichero
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
Al pulsarlo se abre un panel para escribir, editar y eliminar el titular. El titular
se muestra como etiqueta amarilla junto al nombre.

## Formato de los ficheros

Un fichero por persona, con su nombre real como nombre de fichero: `Nombre Apellido.md`.
El frontmatter no lleva `name`: el nombre de la persona es el del fichero. La identidad es el campo
`slugLinkedIn` (el slug de su URL `/in/<slug>/`).

```markdown
---
slugLinkedIn: "slug-del-perfil"
url: https://www.linkedin.com/in/slug-del-perfil/
type: contacto
titular: "Conocida del evento. Interesante para el proyecto X."
tags:
  - linkedIn
---
```

- `type` es siempre `contacto` y `tags` siempre incluye `linkedIn`. Si añades otras etiquetas a mano, se conservan.
- `titular` es el único texto de la persona y vive en el frontmatter; el cuerpo del fichero no se usa
  (se reescribe vacío). Los saltos de línea se guardan como `
` dentro de las comillas.
- **Nombre de fichero:** se fija al crear la nota, saneado para Windows (se eliminan `<>:"/\|?*`).
  Si ya existe otra persona con ese nombre, se usa `Nombre (slug).md`. Después no se renombra
  automáticamente, así que puedes renombrarlo tú: se localiza por `slugLinkedIn`, no por el nombre,
  y el nuevo nombre pasa a ser el de la persona. Un `name:` de versiones anteriores se acepta al
  leer y desaparece al reescribir el fichero.
- **Formato anterior:** los ficheros `<slug>.md` sin `slugLinkedIn` se siguen leyendo (el slug se
  deduce de `url`) y se renombran al formato nuevo la primera vez que se modifican.
  El nombre `slugLinkedId` usado en la versión 1.2.0 también se acepta al leer y se reescribe como `slugLinkedIn`.
- Los ficheros `.md` de la carpeta sin `slugLinkedIn` ni URL de LinkedIn se ignoran y no se tocan.
- Para eliminar, el panel comprueba que el titular siga siendo el que mostraba; si editas el fichero
  a mano mientras está abierto, la operación se descarta y el panel se refresca en vez de pisar nada.
- Un fichero con `slugLinkedIn` pero sin `titular` (o en blanco) cuenta como persona sin titular: el texto
  del cuerpo no se lee ni se muestra. Al guardar un titular se reutiliza ese fichero y se reescribe sin cuerpo.
- Al eliminar el titular de una persona se borra su fichero.

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
