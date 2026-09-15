# QAQC de Perfuração e Desmonte

Dashboard operacional estático para leitura e storytelling de planilhas de
perfuração/desmonte. A interface usa a estética Enaex/OpenBlast das referências
fornecidas: topo grafite, vermelho de operação, base clara, filtros compactos e
ilustrações SVG de malha, furo e perfil de carga. A leitura visual é organizada
em cinco perguntas curtas: onde está o desvio, como ele se relaciona, quantos
furos exigem ação, qual é a fila de campo e quando a iniciação acontece.

O painel inclui mapa XY, dispersão de profundidade × carga, cascata de triagem,
comparação previsto × realizado, ranking de exceções, distribuição dos tempos e
registro auditável. As faixas são triagem visual e permanecem explícitas na
interface; unidades ausentes na fonte não são inferidas.

## O que a base atual entrega

O fixture inicial foi extraído de `Plano_Fogo_Realizado_PP550926.xlsx` e contém
262 furos do plano 550926, com profundidade prevista/realizada, cargas, tampão,
cotas, coordenadas e tempos de detonação. O workbook original não é publicado;
`data/sample.json` é uma cópia reduzida e auditável para o site continuar
funcionando antes da primeira atualização do Drive.

## Atualização automática pelo Drive

1. Abra o projeto Apps Script em `script.google.com` e crie um projeto vazio.
2. Cole o conteúdo de `integrations/google-drive-sync/Code.gs`.
3. Publique como Web app executando como o proprietário, com acesso para quem
   possui o link. O script lê apenas arquivos `.xlsx`, `.xls` e `.csv` que sejam
   filhos diretos da pasta configurada; a pasta pode continuar privada.
4. Copie a URL `/exec` gerada para `driveIndexUrl` em `config.js` e faça um único
   commit. Depois disso, inserir ou substituir uma planilha na pasta alimenta o
   dashboard sem novo deploy do Pages: o botão Atualizar e o polling de cinco
   minutos refazem a listagem e a leitura.

O endpoint retorna a planilha em base64 apenas para manter a leitura privada do
Drive no servidor Apps Script. Não coloque outras colunas sensíveis no mesmo
arquivo se a URL do dashboard for pública.

## Desenvolvimento local

```powershell
npm install
npm test
npm run check
python scripts/extract_workbook.py `
  --input ".\MODELO DE BASE\Plano_Fogo_Realizado_PP550926.xlsx" `
  --output ".\data\sample.json"
python -m http.server 4173
```

Abra `http://localhost:4173/`. Para testar uma URL de Apps Script sem alterar o
repositório, use `http://localhost:4173/?drive=<URL_ENCODED_DO_ENDPOINT>`.

## Publicação

O workflow `.github/workflows/pages.yml` publica a raiz de `main` no GitHub
Pages. O endereço esperado para o repositório `SILVAThiagoFerreira/qaqc-desmonte`
é `https://silvathiagoferreira.github.io/qaqc-desmonte/`.
