

## Plan: Configurar API key de ElevenLabs de forma segura

### Qué se hará

1. **Guardar el secret `ELEVENLABS_API_KEY`** usando la herramienta segura de secrets de Lovable Cloud. Te aparecerá un campo seguro donde pegar tu API key (la que empieza con `sk_...`). El valor NO queda visible en el chat.

2. **Verificar** que el secret quedó configurado correctamente.

### Después de este paso

Con la key configurada, procederemos a:
- Generar los stills de validación visual (frames 80, 180, 320, 560)
- Generar los 6 MP3 de voiceover con ElevenLabs
- Integrar audio en el video y render final

### Sin cambios de código

Este paso solo configura el secret. No se modifica ningún archivo del proyecto.

