# Sondaggi

Il modulo **Sondaggi** (**Admin > Sondaggi**) consente agli amministratori di creare **sondaggi di manutenzione dati** che raccolgono informazioni strutturate dagli stakeholder su card specifiche.

## Caso d'uso

I sondaggi aiutano a mantenere aggiornati i dati architetturali contattando le persone piu vicine a ciascun componente. Ad esempio:

- Chiedete ai proprietari delle applicazioni di confermare la criticita aziendale e le date del ciclo di vita annualmente
- Raccogliete valutazioni dell'idoneita tecnica dai team IT
- Raccogliete aggiornamenti sui costi dai responsabili del budget

## Ciclo di vita del sondaggio

Ogni sondaggio progredisce attraverso tre stati:

| Stato | Significato |
|-------|-------------|
| **Draft** | In fase di progettazione, non ancora visibile ai rispondenti |
| **Active** | Aperto alle risposte, gli stakeholder assegnati lo vedono nei loro Todo |
| **Closed** | Non accetta piu risposte |

## Creazione di un sondaggio

1. Navigate su **Admin > Sondaggi**
2. Cliccate su **+ Nuovo sondaggio**
3. Si apre il **Costruttore di sondaggi** con la seguente configurazione:

### Tipo target

Selezionate a quale tipo di card si applica il sondaggio (es. Application, IT Component). Il sondaggio verra inviato per ogni card di questo tipo che corrisponde ai vostri filtri.

### Filtri

Opzionalmente restringete l'ambito filtrando le card (es. solo applicazioni Active, solo card di proprieta di un'organizzazione specifica).

### Domande

Progettate le vostre domande. Ogni domanda puo essere:

- **Testo libero** — Risposta aperta
- **Selezione singola** — Scegliete un'opzione da un elenco
- **Selezione multipla** — Scegliete piu opzioni
- **Numero** — Input numerico
- **Data** — Selettore di data
- **Booleano** — Interruttore Si/No

### Auto-azioni

Configurate regole che aggiornano automaticamente gli attributi della card in base alle risposte del sondaggio. Ad esempio, se un rispondente seleziona "Mission Critical" per la criticita aziendale, il campo `businessCriticality` della card puo essere aggiornato automaticamente.

## Invio di un sondaggio

Una volta che il vostro sondaggio e in stato **Active**:

1. Cliccate su **Invia** per distribuire il sondaggio
2. Ogni card target genera un todo per gli stakeholder assegnati
3. Gli stakeholder vedono il sondaggio nella scheda **I miei sondaggi** nella [pagina Attivita](../guide/tasks.md)

## Visualizzazione dei risultati

Navigate su **Admin > Sondaggi > [Nome sondaggio] > Risultati** per vedere:

- Stato delle risposte per card (risposto, in attesa)
- Risposte individuali con risposte per ogni domanda
- Un'azione **Applica** per applicare le regole di auto-azione agli attributi della card
