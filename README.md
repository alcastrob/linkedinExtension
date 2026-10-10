# LinkedIn Notas

Extensión de Chrome (Manifest V3) para añadir, editar y eliminar comentarios privados sobre
personas que aparecen en LinkedIn. Los comentarios se guardan en un fichero JSON local.

## Instalación

1. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
2. **Cargar descomprimida** → selecciona esta carpeta.
3. Haz clic en el icono de la extensión: se abre la página de opciones.
4. **Crear fichero nuevo…** (o **Elegir fichero existente…**) y concede permiso de lectura/escritura.
   Si Chrome ofrece "Permitir en cada visita", acéptalo para no tener que reconectar.

## Uso

En resultados de búsqueda, feed y perfiles aparece un botón `📝 +` junto al nombre de cada persona.
Al pulsarlo se abre un panel para añadir, editar y eliminar comentarios. El último comentario
se muestra como etiqueta amarilla junto al nombre.

## Formato del fichero

```json
{
  "version": 1,
  "people": {
    "slug-del-perfil": {
      "name": "Nombre Apellido",
      "url": "https://www.linkedin.com/in/slug-del-perfil/",
      "comments": [
        { "id": "uuid", "text": "…", "createdAt": "ISO", "updatedAt": "ISO" }
      ]
    }
  }
}
```

La persona se identifica por el slug de su URL (`/in/<slug>/`). El fichero se relee en cada
operación, así que puedes editarlo a mano.

## Comportamiento sin acceso al fichero

Si el permiso caduca o el fichero no está disponible, los cambios se guardan en `chrome.storage.local`
y se vuelcan al fichero al reconectar (en ese caso la caché prevalece sobre el contenido del fichero).
Si el fichero contiene JSON inválido, la extensión no lo sobrescribe.

## Limitaciones

- LinkedIn cambia su HTML con frecuencia. La detección se basa en enlaces `a[href*="/in/"]` con texto
  y en el `h1` del perfil; si algún bloque no muestra el botón, hay que ajustar `processAnchor` en `content.js`.
- Chrome no permite que una extensión lea/escriba ficheros arbitrarios sin que el usuario los elija
  (File System Access API); por eso hay que seleccionarlo una vez.
