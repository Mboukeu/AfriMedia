# AfriMedia V2

Plateforme média et services. Cette version est préparée pour un déploiement Node.js/Express sur Render.

## Développement local
1. Installer Node.js 18+.
2. `npm install`
3. Copier `.env.example` vers `.env`.
4. `npm start`
5. Ouvrir `http://localhost:3000`.

## Render
- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`
- La variable `PORT` est fournie automatiquement par Render.

## Fonctionnalités
- Utilisateurs client/créateur/admin
- Catalogue de services
- Commandes
- Commission configurable (10% par défaut)
- Portefeuille créateur
- Statistiques propriétaire
- Webhook de paiement de démonstration

## Production
Le paiement réel, l'authentification sécurisée, les retraits créateurs et une base de données persistante doivent être configurés avant une mise en production commerciale. Ne jamais placer de clés secrètes dans le frontend.
