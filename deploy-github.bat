@echo off
cd /d "%~dp0"
where git >nul 2>nul || (echo Git bulunamadi. https://git-scm.com adresinden kurun. & pause & exit /b 1)
git init
git branch -M main
git add .
git commit -m "Kutsal Cumartesi Kasa Next.js initial deploy"
git remote remove origin 2>nul
git remote add origin https://github.com/kutas13/kutsalcumartesi.git
git push -u origin main
pause
