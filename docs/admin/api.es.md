# Referencia de la API

Turbo EA expone una **API REST** completa que impulsa todo lo que se puede hacer en la interfaz web. Puede usarla para automatizar actualizaciones de inventario, integrarse con pipelines CI/CD, construir paneles personalizados o llevar datos EA a otras herramientas (BI, GRC, ITSM, hojas de cálculo).

La misma API está documentada de forma interactiva mediante la **Swagger UI integrada en FastAPI**, de modo que administradores y desarrolladores pueden explorar cada endpoint, inspeccionar los esquemas de petición/respuesta y probar llamadas directamente desde el navegador.

---

## URL base

Todos los endpoints de la API viven bajo el prefijo `/api/v1`:

```
https://su-dominio.example.com/api/v1
```

En local (configuración Docker por defecto):

```
http://localhost:8920/api/v1
```

La única excepción es el endpoint de salud, montado en `/api/health` (sin prefijo de versión).

---

## Referencia interactiva de la API (Swagger UI)

FastAPI genera automáticamente una especificación OpenAPI 3 a partir del código del backend y sirve junto a ella una Swagger UI interactiva. Esta es la **fuente única de verdad** para cada endpoint, parámetro y forma de respuesta.

| URL | Descripción |
|-----|-------------|
| `/api/docs` | Swagger UI: explorar, buscar y probar endpoints desde el navegador |
| `/api/redoc` | ReDoc: vista alternativa de solo lectura de la documentación |
| `/api/openapi.json` | Esquema OpenAPI 3 en bruto (útil para generadores de código como `openapi-generator-cli`) |

!!! warning "Disponible solo en modo desarrollo"
    Por motivos de seguridad, los endpoints de documentación de la API están **deshabilitados en producción**. Solo se sirven cuando `ENVIRONMENT=development` está definido en su archivo `.env`. En despliegues de producción, el esquema OpenAPI no se expone públicamente, pero la API en sí funciona exactamente igual.

    Para explorar la referencia de la API de una instancia de producción, levante una instancia local de Turbo EA en modo desarrollo (el esquema es idéntico entre despliegues de la misma versión) o cambie temporalmente `ENVIRONMENT=development`, reinicie el backend y revierta el cambio cuando termine.

### Probar endpoints desde la Swagger UI

1. Abra `/api/docs` en su navegador.
2. Haga clic en **Authorize** en la parte superior derecha.
3. Pegue un JWT válido (sin el prefijo `Bearer `) en el campo `bearerAuth` y confirme.
4. Despliegue cualquier endpoint, haga clic en **Try it out**, complete los parámetros y pulse **Execute**.

Swagger envía la petición desde su navegador con su token, así que cualquier cosa que se pueda hacer mediante la API es accesible desde esta página: útil para tareas administrativas puntuales y para verificar el comportamiento de los permisos.

---

## Autenticación

Todos los endpoints excepto `/auth/*`, el chequeo de salud y los portales web públicos requieren un JSON Web Token enviado en la cabecera `Authorization`:

```
Authorization: Bearer <access_token>
```

### Obtener un token

`POST /api/v1/auth/login` con su correo y contraseña:

```bash
curl -X POST https://su-dominio.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "usted@example.com", "password": "su-contraseña"}'
```

La respuesta contiene un `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Los tokens son válidos durante 24 horas por defecto (`ACCESS_TOKEN_EXPIRE_MINUTES`). Use `POST /api/v1/auth/refresh` para extender una sesión sin reintroducir credenciales.

!!! tip "Usuarios SSO"
    Si su organización utiliza inicio de sesión único, no podrá iniciar sesión con correo y contraseña. Pida a un administrador que cree una cuenta de servicio con contraseña local para la automatización, o capture el JWT desde el session storage del navegador tras un inicio SSO normal (solo para desarrollo).

### Usar el token

```bash
curl https://su-dominio.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permisos

La API aplica **las mismas reglas RBAC que la interfaz web**. Cada endpoint que muta datos comprueba tanto el rol de aplicación del llamante como cualquier rol de parte interesada que tenga sobre la ficha afectada. No existen «permisos de API» separados ni atajos de cuenta de servicio: los scripts de automatización corren con los permisos del usuario cuyo token usan.

Si una petición falla con `403 Forbidden`, el token es válido pero al usuario le falta el permiso requerido. Consulte la página [Usuarios y roles](users.md) para ver el registro de permisos.

---

## Grupos de endpoints comunes

La referencia completa está en Swagger; la siguiente tabla es un mapa rápido de los grupos más usados:

| Prefijo | Propósito |
|---------|-----------|
| `/auth` | Inicio de sesión, registro, callback SSO, refresco de token, datos del usuario actual |
| `/cards` | CRUD de fichas (entidad central), jerarquía, historial, aprobación, exportación CSV |
| `/relations` | CRUD de relaciones entre fichas |
| `/metamodel` | Tipos de ficha, campos, secciones, subtipos, tipos de relación |
| `/reports` | KPI del panel, portafolio, matriz, ciclo de vida, dependencias, coste, calidad de datos |
| `/bpm` | Gestión de procesos de negocio: diagramas, elementos, versiones de flujo, evaluaciones |
| `/ppm` | Gestión de portafolio de proyectos: iniciativas, informes de estado, EDT, tareas, costes, riesgos |
| `/turbolens` | Análisis impulsado por IA (proveedores, duplicados, seguridad, IA de arquitectura) |
| `/risks` | Registro de riesgos EA (Fase G de TOGAF) |
| `/diagrams` | Diagramas DrawIO |
| `/soaw` | Documentos Statement of Architecture Work |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Administración de usuarios y roles (solo admin) |
| `/settings` | Ajustes de la aplicación (logo, divisa, SMTP, IA, interruptores de módulos) |
| `/servicenow` | Sincronización bidireccional con la CMDB de ServiceNow |
| `/events`, `/notifications` | Pista de auditoría y notificaciones de usuario (incluido el flujo SSE) |

---

## Paginación, filtrado y ordenación

Los endpoints de listado aceptan un conjunto coherente de parámetros de consulta:

| Parámetro | Descripción |
|-----------|-------------|
| `page` | Número de página (empieza en 1) |
| `page_size` | Elementos por página (por defecto 50, máximo 200) |
| `sort_by` | Campo de ordenación (por ejemplo `name`, `updated_at`) |
| `sort_dir` | `asc` o `desc` |
| `search` | Filtro de texto libre (donde se admita) |

Los filtros específicos de cada recurso están documentados por endpoint en Swagger (p. ej. `/cards` admite `type`, `status`, `parent_id`, `approval_status`).

---

## Eventos en tiempo real (Server-Sent Events)

`GET /api/v1/events/stream` es una conexión SSE de larga duración que envía eventos a medida que ocurren (ficha creada, actualizada, aprobada, etc.). La interfaz web la usa para refrescar contadores y listas sin sondeo. Cualquier cliente HTTP compatible con SSE puede suscribirse: útil para construir paneles en tiempo real o puentes de notificación externos.

---

## Generación de código

Como la API está totalmente descrita por OpenAPI 3, puede generar clientes con tipado estático en cualquier lenguaje principal:

```bash
# Descargar el esquema desde una instancia de desarrollo
curl http://localhost:8920/api/openapi.json -o turbo-ea-openapi.json

# Generar un cliente Python
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … o TypeScript, Go, Java, C#, etc.
```

Para automatización en Python, lo más sencillo suele ser `httpx` o `requests` con llamadas escritas a mano: la API es lo bastante pequeña como para que rara vez compense un generador.

---

## Limitación de tasa

Los endpoints sensibles a la autenticación (login, registro, restablecimiento de contraseña) están limitados con `slowapi` para protegerse de ataques de fuerza bruta. Los demás endpoints no están limitados por defecto; si necesita ralentizar un script de automatización pesado, hágalo del lado del cliente o detrás de su proxy inverso.

---

## Versionado y estabilidad

- La API se versiona mediante el prefijo `/api/v1`. Un cambio incompatible introduciría un `/api/v2` en paralelo.
- Dentro de `v1`, los cambios aditivos (nuevos endpoints, nuevos campos opcionales) pueden llegar en versiones menores y de parche. Las eliminaciones o cambios de contrato se reservan para un cambio de versión mayor.
- La versión actual se reporta en `GET /api/health` para que la automatización pueda detectar actualizaciones.

---

## Resolución de problemas

| Problema | Solución |
|----------|----------|
| `/api/docs` devuelve 404 | Swagger UI está deshabilitada en producción. Defina `ENVIRONMENT=development` y reinicie el backend, o use una instancia de desarrollo para explorar el esquema. |
| `401 Unauthorized` | El token falta, está mal formado o ha expirado. Reautentíquese vía `/auth/login` o `/auth/refresh`. |
| `403 Forbidden` | El token es válido pero al usuario le falta el permiso requerido. Compruebe el rol en [Usuarios y roles](users.md). |
| `422 Unprocessable Entity` | Falló la validación de Pydantic. El cuerpo de la respuesta lista los campos inválidos y el motivo. |
| Errores CORS desde una app de navegador | Añada el origen del frontend a `ALLOWED_ORIGINS` en `.env` y reinicie el backend. |
