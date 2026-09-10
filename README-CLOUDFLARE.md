# AfriMedia — mise en ligne gratuite sans carte

## Architecture
- Cloudflare Workers : serveur/API
- Cloudflare D1 : base SQLite managée et persistante
- Cloudflare Assets : interface web
- GitHub : code source

## 1. Créer la base D1
Dans Cloudflare Dashboard > Workers & Pages > D1, créer une base appelée `afrimedia-db`.
Récupérer son **Database ID** et remplacer `REPLACE_WITH_YOUR_D1_DATABASE_ID` dans `wrangler.jsonc`.

## 2. Installer Wrangler
Sur ton ordinateur :
```bash
npm install
npx wrangler login
```

## 3. Appliquer la migration
```bash
npm run db:migrate:remote
```

## 4. Définir les variables secrètes
Créer au minimum :
```bash
npx wrangler secret put ADMIN_KEY
npx wrangler secret put COMMISSION_RATE
```
`ADMIN_KEY` doit être une longue clé aléatoire. Ne jamais la publier dans GitHub.

## 5. Déployer
```bash
npm run deploy
```
Cloudflare affichera l'adresse `*.workers.dev` du site.

## Important
Le dépôt contient désormais une version Cloudflare protégée, mais le paiement réel n'est pas encore branché. Pour encaisser au Cameroun, il faut créer le compte marchand du prestataire choisi, obtenir ses identifiants/API et configurer le webhook avec vérification de signature. Ne mets jamais les clés API dans GitHub.

L'ancienne version Express/SQLite reste dans le dépôt pour référence; `wrangler.jsonc` et `worker.js` constituent la nouvelle cible de déploiement.
