# OpenAI Academy Connector

Servidor MCP de código abierto para consultar **únicamente contenido público verificable** de OpenAI Academy. No es una API de OpenAI Academy, no inicia sesión en Academy y no accede a perfiles, progreso, cursos inscritos ni otros datos privados.

## Qué hace

El conector crea un catálogo desde un sitemap público de Academy que el operador haya verificado y configurado, después de comprobar `robots.txt`. Los recursos se mantienen en el mismo host HTTPS, se limitan por tamaño y timeout, y solo se abre contenido que ya aparece en el catálogo verificado.

Herramientas MCP:

- `search_academy`: busca texto y temas en el catálogo público.
- `get_academy_resource`: obtiene texto legible y un extracto de un recurso catalogado.
- `list_academy_resources`: enumera recursos públicos catalogados.
- `search_academy_topics`: enumera temas normalizados detectados.
- `get_academy_learning_path`: devuelve un error explícito hasta que exista una fuente pública oficial verificable para rutas de aprendizaje.

## Límites deliberados

- No hay autenticación de Academy ni "Sign in with ChatGPT" implementado. No se ha verificado una API pública de Academy para esos datos.
- El servidor no solicita ni almacena contraseñas, cookies, tokens de sesión o credenciales de Academy.
- No evita CAPTCHA, paywalls, límites, login, controles anti-bot ni reglas de `robots.txt`.
- Si `robots.txt` no puede leerse, el acceso queda bloqueado por defecto.
- El sitemap es un documento web público; no se trata como un endpoint de API. Debe configurarse solo tras verificar su existencia y permiso. Si no existe, no es público o no permite indexación, la búsqueda devuelve un error controlado en vez de inventar resultados.

## Requisitos

- Node.js 22 o posterior.
- Acceso de red legítimo a la fuente pública configurada.

## Instalación y ejecución local

```bash
npm install
cp .env.example .env
npm run dev
```

Comprueba el servicio:

```bash
curl http://localhost:3000/health
```

Para compilar y ejecutar JavaScript compilado:

```bash
npm run build
npm start
```

## Configuración

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP local. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | URL pública del servicio remoto; debe ser HTTPS en producción. |
| `ACADEMY_BASE_URL` | `https://academy.openai.com` | Origen permitido de Academy. |
| `ACADEMY_SITEMAP_URL` | — | Sitemap público previamente verificado; debe tener el mismo origen. Sin él, las herramientas de catálogo devuelven `CATALOG_SOURCE_NOT_CONFIGURED`. |
| `REQUEST_TIMEOUT_MS` | `15000` | Límite por solicitud a Academy. |
| `MAX_RESPONSE_BYTES` | `1000000` | Tamaño máximo de una respuesta de Academy. |
| `CACHE_TTL_MS` | `300000` | Duración de caché del sitemap y `robots.txt`. |
| `MAX_SEARCH_RESULTS` | `20` | Máximo que devuelve una búsqueda. |
| `USER_AGENT` | `OpenAI-Academy-Connector/1.0` | Identificador para solicitudes públicas. |

## Codex: configuración MCP local

Después de compilar, registra el servidor según la configuración MCP actual de Codex. Un ejemplo de transporte local por `stdio` requiere un pequeño lanzador `stdio`, que **no está incluido todavía**: este proyecto entrega Streamable HTTP en `/mcp`. Para una instancia local HTTP, usa un cliente MCP compatible con Streamable HTTP apuntando a `http://localhost:3000/mcp`.

Antes de conectar ChatGPT o Codex a un despliegue remoto, consulta la documentación oficial vigente de [Apps SDK](https://developers.openai.com/apps-sdk/), [servidores MCP para Apps SDK](https://developers.openai.com/apps-sdk/build/mcp-server/) y [MCP de Codex](https://developers.openai.com/codex/mcp/). La disponibilidad de conectores y el procedimiento de alta dependen del producto, plan y políticas de espacio de trabajo.

## Despliegue HTTPS remoto

1. Construye una imagen con `docker build -t openai-academy-connector .`.
2. Ejecútala detrás de un proxy HTTPS con una URL pública, por ejemplo `https://connector.example.com`.
3. Configura `PUBLIC_BASE_URL=https://connector.example.com` y las demás variables de entorno.
4. Publica solo HTTPS y apunta el cliente compatible al endpoint `https://connector.example.com/mcp`.

No hay un proveedor cloud obligatorio. Para desarrollo se puede usar la máquina local; para una demostración temporal puede usarse un túnel HTTPS, sujeto a sus límites y condiciones. Un host gratuito puede suspender instancias, limitar tráfico o cambiar sus condiciones; verifica siempre sus límites antes de depender de él.

## Pruebas

```bash
npm run check
npm test
```

Las pruebas no contactan Academy: sustituyen `fetch` por respuestas controladas para verificar catálogo, reglas `robots.txt`, límites de catálogo y rechazo de recursos no catalogados.

## Seguridad

Los errores de herramientas son objetos JSON con `code` y `message`. Los logs de servidor no incluyen cabeceras de autorización, cookies ni cuerpos. El conector no contiene secretos ni requiere un token de OpenAI. Revisa las condiciones de Academy y el contenido de `robots.txt` desde el entorno de despliegue antes de habilitar el acceso web.
