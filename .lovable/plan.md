# Nota del ítem en el carrito: cerrar bien al tocar el ícono

## Qué pasa hoy

El campo de nota se abre con el ícono, pero al tocar el ícono otra vez para cerrarlo vuelve a quedar abierto. Motivo: al tocar el ícono el textarea pierde el foco y se cierra solo (evento blur), y enseguida el clic del ícono lo vuelve a abrir. Resultado: parece que el botón "no apaga" la nota.

Además, si se toca el ícono por equivocación, queda un campo abierto y vacío ocupando espacio hasta tocar afuera.

## Qué se va a hacer

1. El ícono de nota funciona como interruptor real: abre y cierra siempre, sin importar el foco.
2. Toque por equivocación: si el campo queda vacío y se toca fuera, se cierra solo y no guarda nada (no queda nota vacía en el pedido).
3. Si ya hay texto escrito, al tocar fuera el campo se colapsa pero la nota queda visible en una línea (como ahora) y se puede reabrir tocándola.
4. El ícono queda resaltado solo cuando el ítem tiene nota guardada, para distinguir "tiene nota" de "campo abierto".

## Detalle técnico

Archivo: `src/components/ventas/CarritoPanel.tsx` (componente `CartItemRow`).

- Usar `onMouseDown` con `preventDefault()` en el botón de nota para que el textarea no dispare `blur` antes del toggle, manteniendo `onClick` para alternar `notesOpen`.
- En `onBlur` del `Textarea`: cerrar siempre, y si el valor está vacío/solo espacios, normalizar la nota a `""` vía `onUpdateNotes`.
- Ajustar el estilo activo del botón para que dependa de `item.notes` (ya lo hace) y agregar un estado visual sutil cuando `notesOpen` está activo.
- Verificación en navegador (Playwright): abrir carrito, tocar ícono → campo visible; tocar ícono de nuevo → campo cerrado; escribir nota, tocar afuera → nota en una línea; reabrir y borrar → cierra sin dejar nota.
