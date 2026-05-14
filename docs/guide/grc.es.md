# GRC

El módulo **GRC** reúne Gobernanza, Riesgo y Cumplimiento en un único espacio de trabajo en `/grc`. Consolida tareas que antes vivían entre Entrega EA y TurboLens, de modo que arquitectas, propietarios de riesgo y revisores de cumplimiento operen sobre una base común.

GRC tiene tres pestañas:

- **Gobernanza** — Principios EA y Architecture Decision Records (ADR).
- **Riesgo** — el [Registro de riesgos](risks.md) según TOGAF Fase G.
- **Cumplimiento** — el escáner bajo demanda (CVE + análisis de brechas regulatorias) que antes se encontraba en TurboLens.

Puedes apuntar directamente a cualquier pestaña con `/grc?tab=governance`, `/grc?tab=risk` o `/grc?tab=compliance`.

## Gobernanza

Dos paneles uno junto al otro:

- **Principios** — visor de solo lectura de los Principios EA publicados en el metamodelo (declaración, justificación, implicaciones). El catálogo se edita desde **Administración → Metamodelo → Principios**.
- **Decisiones** — Architecture Decision Records. Cada ADR captura estado, contexto, decisión, alternativas consideradas y consecuencias. Las decisiones emitidas por el asistente TurboLens Architect aterrizan aquí como borradores para revisión.

## Riesgo

Incrusta el **Registro de riesgos** TOGAF Fase G. El ciclo de vida completo, el flujo de estados, los conmutadores de matriz y el comportamiento de propietarios están documentados en la [guía del Registro de riesgos](risks.md). Lo más relevante:

- El registro vive en `/grc?tab=risk` (antes estaba bajo Entrega EA).
- Los riesgos pueden crearse manualmente o **promoverse** desde un hallazgo CVE o de cumplimiento en la pestaña Cumplimiento.
- La promoción es idempotente — una vez promovido un hallazgo, su botón cambia a **Abrir riesgo R-000123**.

## Cumplimiento

El escáner de seguridad bajo demanda, con dos mitades independientes:

- **Escaneo CVE** — consulta NIST NVD para los proveedores / productos / versiones del paisaje vivo, y luego pide al LLM que priorice los hallazgos.
- **Escaneo de cumplimiento** — análisis de brechas por regulación con IA frente a las regulaciones habilitadas (por defecto EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001; los administradores pueden habilitar más en **Administración → Regulaciones**).

Los hallazgos son **duraderos entre re-escaneos** — las decisiones de la usuaria, las notas de revisión y el enlace de vuelta a un Riesgo promovido sobreviven a los escaneos posteriores. Un hallazgo que la siguiente pasada ya no reporta se marca `auto_resolved` y se oculta por defecto; el Riesgo previamente promovido se conserva para no romper la pista de auditoría.

La cuadrícula de Cumplimiento refleja la del Inventario: barra lateral de filtros con visibilidad de columnas, orden persistido y un panel de detalle que muestra el ciclo de vida de cumplimiento (`new → in_review → mitigated → verified`, con `risk_tracked`, `accepted` y `not_applicable` como ramas laterales).

## Permisos

| Permiso | Roles por defecto |
|---------|-------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | ver [Registro de riesgos § Permisos](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | ver [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controla la visibilidad de la propia ruta GRC — sin él, la entrada del menú superior queda oculta. Cada pestaña además exige su permiso de dominio, de modo que una visualizadora puede leer el registro sin poder disparar un escaneo LLM, por ejemplo.
