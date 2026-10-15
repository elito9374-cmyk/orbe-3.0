# Mettre Orbe en ligne

## Ce que cette version contient
- Interface Orbe retravaillée, responsive et sombre
- Recherche de membres
- Messagerie privée
- Authentification serveur avec JWT + mots de passe hashés
- Endpoint `/health` pour le monitoring
- En-têtes de sécurité HTTP de base
- Orbe IA via la Responses API, protégée côté serveur
- Limitation simple des requêtes IA par utilisateur

## Déploiement recommandé : Railway
1. Connecte ce dossier à un dépôt GitHub.
2. Crée un service Railway depuis le dépôt.
3. Commande de démarrage : `npm start`.
4. Ajoute un volume persistant monté sur `/data` pour conserver SQLite.
5. Ajoute ces variables dans Railway :

```env
JWT_SECRET=une-longue-valeur-aleatoire
DB_PATH=/data/orbe.db
OPENAI_API_KEY=ta_cle_api
OPENAI_MODEL=gpt-6-luna
ORBE_ORIGIN=https://ton-domaine.example
```

La clé OpenAI reste uniquement côté serveur. Ne la mets jamais dans `public/index.html`.

## Test local
```bash
npm install
JWT_SECRET=dev-secret npm start
```
Puis ouvre `http://localhost:3000`.

## Vérification
`GET /health` doit renvoyer `{"ok":true,"service":"orbe"}`.

## Important pour une vraie ouverture au public
Avant de communiquer le lien publiquement, ajoute une politique de confidentialité, des outils de signalement/blocage et une vraie modération. Pour un réseau utilisé par des mineurs, ces éléments sont prioritaires.
