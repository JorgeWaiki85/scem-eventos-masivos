# DEPLOY SCEM - GitHub Pages + Supabase

## 1) Crear repositorio en GitHub
1. Ir a https://github.com/new
2. Repository name: scem-eventos-masivos (o sistema-comando-eventos-masivos)
3. Visibility: Public
4. NO inicializar con README/.gitignore/license
5. Crear repositorio

## 2) Subir código (desde esta carpeta)
`ash
cd "C:\Users\Jorge Huiquicheo\Documents\Default Project\SistemaComandoEventosMasivos"
git remote set-url origin https://github.com/JorgeHuiquicheo/scem-eventos-masivos.git  # ajusta si usaste otro nombre
git branch -M main
git push -u origin main
`

## 3) GitHub Pages
1. Settings > Pages
2. Source: Deploy from a branch
3. Branch: main / /(root)
4. Save -> URL: https://jorgehuiquicheo.github.io/scem-eventos-masivos/

## 4) Supabase
1. https://supabase.com -> New project
2. SQL Editor > New query -> pegar TODO supabase/schema.sql -> Run
3. Edge Functions > New function: dmin-usuarios
   - Pegar contenido de supabase/functions/admin-usuarios/index.ts
   - Deploy
4. Settings > API: copiar Project URL y anon public key
5. Editar js/config.js con esos valores

## 5) Probar
Abrir URL de GitHub Pages (HTTPS). Funciona offline-first (PWA). Al volver online sincroniza.
