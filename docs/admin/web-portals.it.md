# Portali web

La funzionalita **Portali web** (**Admin > Impostazioni > Portali web**) consente di creare **viste pubbliche di sola lettura** di dati selezionati delle card — accessibili senza autenticazione tramite un URL univoco.

## Caso d'uso

I portali web sono utili per condividere informazioni architetturali con stakeholder che non hanno un account Turbo EA:

- **Catalogo tecnologico** — Condividete il panorama applicativo con gli utenti business
- **Directory dei servizi** — Pubblicate i servizi IT e i loro responsabili
- **Mappa delle capability** — Fornite una vista pubblica delle business capability

## Creazione di un portale

1. Navigate su **Admin > Impostazioni > Portali web**
2. Cliccate su **+ Nuovo portale**
3. Configurate il portale:

| Campo | Descrizione |
|-------|-------------|
| **Nome** | Nome visualizzato per il portale |
| **Slug** | Identificatore URL-friendly (generato automaticamente dal nome, modificabile). Il portale sara accessibile su `/portal/{slug}` |
| **Tipo di card** | Quale tipo di card visualizzare |
| **Sottotipi** | Opzionalmente limitate a sottotipi specifici |
| **Mostra logo** | Se visualizzare il logo della piattaforma sul portale |

## Configurazione della visibilita

Per ogni portale, controllate esattamente quali informazioni sono visibili. Ci sono due contesti:

### Proprieta della vista elenco

Quali colonne/proprieta appaiono nell'elenco delle card:

- **Proprieta predefinite**: descrizione, ciclo di vita, tag, qualita dei dati, stato di approvazione
- **Campi personalizzati**: Ogni campo dallo schema del tipo di card puo essere attivato/disattivato individualmente

### Proprieta della vista dettaglio

Quali informazioni appaiono quando un visitatore clicca su una card:

- Stessi controlli toggle della vista elenco, ma per il pannello di dettaglio espanso

## Accesso al portale

I portali sono accessibili su:

```
https://your-turbo-ea-domain/portal/{slug}
```

Non e richiesto alcun login. I visitatori possono sfogliare l'elenco delle card, cercare e visualizzare i dettagli delle card — ma solo le proprieta che avete abilitato vengono mostrate.

!!! note
    I portali sono di sola lettura. I visitatori non possono modificare, commentare o interagire con le card. I dati sensibili (stakeholder, commenti, cronologia) non vengono mai esposti sui portali.
