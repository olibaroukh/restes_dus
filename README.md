# Restes dus des franchisés – Optical Center

Page : https://olibaroukh.github.io/restes_dus/

Code public, **aucune donnée ni clé dans ce dépôt**. Les données sont dans le Worker Cloudflare `suivi-stats-api`
(tables `restes_dus_*`, code dans le dépôt suivi-stats, fichier `worker/src/restesdus.js`), accessibles seulement après connexion Zimbra.

- Le franchisé dépose son extraction Cosium « Liste des règlements » : elle est lue sur l'ordinateur ;
  seuls les dossiers de 45 jours à 1 an sont envoyés (regroupés par facture, sans n° de Sécurité sociale).
- Une justification par dossier (motif, date d'action prévue, commentaire), conservée tant que le dossier reste dans l'extraction.
- Administrateurs : suivi par magasin et gestion des comptes (adresse Zimbra → magasins).

Règle : incrémenter `version.json` (AAAA.MM.JJ-n) à chaque modification.
