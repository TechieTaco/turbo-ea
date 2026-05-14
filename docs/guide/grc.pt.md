# GRC

O módulo **GRC** reúne Governança, Risco e Conformidade num único espaço de trabalho em `/grc`. Consolida tarefas que antes viviam entre Entrega EA e TurboLens, para que arquitetas, proprietários de risco e revisores de conformidade trabalhem sobre um terreno comum.

GRC tem três abas:

- **Governança** — Princípios EA e Architecture Decision Records (ADR).
- **Risco** — o [Registro de riscos](risks.md) segundo TOGAF Fase G.
- **Conformidade** — o scanner sob demanda (CVE + análise de lacunas regulatórias) que antes ficava em TurboLens.

Você pode apontar diretamente para qualquer aba via `/grc?tab=governance`, `/grc?tab=risk` ou `/grc?tab=compliance`.

![GRC — aba Governança](../assets/img/pt/52_grc_governanca.png)

## Governança

Dois painéis lado a lado:

- **Princípios** — visualizador somente leitura dos Princípios EA publicados no metamodelo (declaração, justificativa, implicações). O catálogo é editado em **Administração → Metamodelo → Princípios**.
- **Decisões** — Architecture Decision Records. Cada ADR registra status, contexto, decisão, alternativas consideradas e consequências. As decisões emitidas pelo assistente TurboLens Architect chegam aqui como rascunhos para aprovação.

## Risco

![GRC — Registro de riscos](../assets/img/pt/53_grc_registo_riscos.png)

Incorpora o **Registro de riscos** TOGAF Fase G. Ciclo de vida completo, fluxo de status, alternadores da matriz e comportamento dos proprietários estão documentados no [guia do Registro de riscos](risks.md). Os pontos mais relevantes:

- O registro vive em `/grc?tab=risk` (antes ficava em Entrega EA).
- Riscos podem ser criados manualmente ou **promovidos** a partir de uma conclusão CVE ou de conformidade na aba Conformidade.
- A promoção é idempotente — uma vez promovida uma conclusão, o botão alterna para **Abrir risco R-000123**.

## Conformidade

![GRC — scanner de conformidade](../assets/img/pt/54_grc_conformidade.png)

O scanner de segurança sob demanda, com duas metades independentes:

- **Varredura CVE** — consulta NIST NVD pelos fornecedores / produtos / versões do panorama vivo, e depois pede ao LLM que priorize as conclusões.
- **Varredura de conformidade** — análise de lacunas por regulação assistida por IA contra as regulações habilitadas. Seis frameworks vêm habilitados por padrão (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001); administradores podem habilitá-los ou desabilitá-los — e adicionar regulações personalizadas como HIPAA ou políticas internas — em [**Administração → Metamodelo → Regulações**](../admin/metamodel.md#compliance-regulations).

As conclusões são **duráveis entre re-varreduras** — decisões da usuária, notas de revisão, o veredicto de IA do usuário sobre um card e o vínculo de volta a um Risco promovido sobrevivem às varreduras subsequentes. Uma conclusão que a próxima passagem não relatar mais é marcada `auto_resolved` e ocultada por padrão; o Risco previamente promovido é preservado para não romper a trilha de auditoria.

A grade de Conformidade espelha a do Inventário: barra lateral de filtros com visibilidade de colunas, ordenação persistida, busca de texto completo e uma gaveta de detalhes que mostra o ciclo de vida de conformidade como uma linha do tempo horizontal de fases:

```
new → in_review → mitigated → verified
                      ↘ accepted          (requer justificativa)
                      ↘ not_applicable    (revisão de escopo)
                      ↘ risk_tracked      (definido automaticamente ao promover para Risco)
```

Com `security_compliance.manage`, marque a caixa do cabeçalho para uma **seleção-tudo filtrada**, e então use a barra de ferramentas fixa para **Editar decisão** (transição em lote) ou **Excluir** as conclusões selecionadas. Transições ilegais são relatadas linha a linha em um resumo de sucesso parcial, de modo que uma única linha ruim não faça o lote inteiro falhar. Veja [TurboLens → Segurança & Conformidade](turbolens.md#bulk-actions-on-the-compliance-grid) para a referência completa de ações.

Quando um Risco promovido a partir de uma conclusão é fechado ou aceito, a ação **se propaga de volta para a conclusão automaticamente** — a linha de conformidade vinculada muda para `mitigated` / `verified` / `accepted` / `in_review` para permanecer em sincronia, sem manutenção manual.

### Conformidade em um único card

Os cards no escopo de uma varredura de conformidade também expõem uma aba **Conformidade** em sua página de detalhe (governada por `security_compliance.view`). Ela lista cada conclusão atualmente vinculada ao card com as mesmas ações Reconhecer / Aceitar / **Criar risco** / **Abrir risco** que a visão GRC — para que um Application Owner possa triar suas conclusões sem sair do card.

## Permissões

| Permissão | Papéis padrão |
|-----------|---------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | ver [Registro de riscos § Permissões](risks.md) |
| `security_compliance.view` / `security_compliance.manage` | ver [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controla a visibilidade da própria rota GRC — sem ele, a entrada do menu superior fica oculta. Cada aba ainda impõe sua própria permissão de domínio, de modo que uma visualizadora possa ler o registro sem poder disparar uma varredura LLM, por exemplo.
