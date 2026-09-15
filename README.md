# QA/QC de Perfuração e Desmonte

Dashboard operacional para avaliar a aderência entre o plano de fogo e a
execução da perfuração e do carregamento, com classificação de conformidade,
priorização de verificações e rastreabilidade por furo.

## Objetivo

Organizar a leitura de campo em uma sequência curta e técnica:

`Fonte de dados → Recorte → Conformidade → Desvio → Verificação`

O painel apresenta a posição dos furos, o perfil de carregamento selecionado,
a comparação entre parâmetros planejados e executados, a distribuição dos
tempos de iniciação e o registro detalhado dos furos.

Os gráficos são operacionais: pontos do mapa, da dispersão e da distribuição
dos tempos podem ser focados, sobrevoados e selecionados para consultar o
furo. As barras de classificação filtram a fila de verificação por status.

## Vocabulário do painel

A interface adota a terminologia de engenharia de perfuração e desmonte:

- `Plano de fogo`, `malha de perfuração`, `afastamento`, `espaçamento` e
  `subperfuração` para o planejamento e a geometria;
- `Profundidade executada`, `carga carregada`, `tampão` e `tempo de iniciação`
  para os registros de execução;
- `Conforme`, `Em revisão`, `Fora da faixa` e `Sem referência` para a
  classificação dos furos;
- `Desvio técnico`, `critério de avaliação` e `rastreabilidade` para a leitura
  de QA/QC.

Os textos foram revisados com base nos seguintes materiais fornecidos para
referência terminológica e operacional:

- *Desmonte de rocha na Mina do Sossego*;
- *Mine to plant na mina de Salobo*;
- *Implementação do Programa QA/QC na Mina de Ferro de Carajás (Serra Norte)
  com a utilização da Blastscout Probe*.

Os materiais orientam a linguagem, mas não transformam resultados históricos
em metas universais. O painel mantém os critérios configurados no projeto e
não infere unidades ausentes na planilha de origem.

## Critério de avaliação

A classificação atual é uma triagem operacional configurada no painel:

- profundidade: desvio relativo de até ±10%;
- carga: desvio relativo de até ±20%;
- tampão: desvio absoluto de até ±0,5 na unidade da fonte.

O resultado é uma indicação para verificação. Não substitui o plano de fogo,
o procedimento operacional, a inspeção de campo ou os critérios normativos
vigentes.

## Dados publicados

O fixture público está em [`data/sample.json`](data/sample.json) e foi extraído
de `Plano_Fogo_Realizado_PP550926.xlsx`. Ele contém 262 furos do plano 550926,
com profundidade planejada e executada, cargas, tampão, cotas, coordenadas e
tempos de iniciação.

O workbook original não é publicado. A base reduzida permanece versionada como
fallback operacional para situações em que a ponte remota do Drive esteja
temporariamente indisponível.

## Atualização pelo Google Drive

A pasta operacional já está vinculada ao endpoint publicado em
`config.js`. O carregamento inicial, o botão **Atualizar dados** e o polling de
cinco minutos consultam essa ponte e reprocessam os arquivos encontrados na
pasta configurada. A base local só é usada se o endpoint remoto estiver
indisponível, com o status do dashboard sinalizando a fonte alternativa.

Para recriar a ponte em outra conta ou ambiente:

1. Crie um projeto vazio no Google Apps Script.
2. Cole [`integrations/google-drive-sync/Code.gs`](integrations/google-drive-sync/Code.gs).
3. Publique como Web app, executando como o proprietário, com acesso para
   qualquer pessoa.
4. Substitua a URL `/exec` em `driveIndexUrl`, no arquivo `config.js`.

O script lê apenas arquivos `.xlsx`, `.xls` e `.csv` filhos diretos da pasta
configurada. A atualização não exige novo deploy do GitHub Pages quando o
conteúdo de uma planilha é alterado no Drive.

O endpoint retorna a planilha em base64 para preservar a leitura privada da
fonte no servidor Apps Script. Não coloque colunas sensíveis no mesmo arquivo
se a URL do dashboard for pública.

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

Acesse `http://localhost:4173/`. Para testar um endpoint do Drive sem alterar
o repositório, use `http://localhost:4173/?drive=<URL_ENCODED_DO_ENDPOINT>`.

## Validação

Antes de publicar uma alteração, execute:

```powershell
npm test
npm run check
node --check config.js
git diff --check
```

O teste valida a existência da aba `Dados dos Furos`, os 262 registros, os
campos obrigatórios e a unicidade dos IDs.

Também é necessário abrir a aplicação servida por HTTP e conferir:

- carregamento da base, indicadores e gráficos;
- filtros, seleção de furos, tooltips e tabela;
- filtro por status acionado pela distribuição da conformidade;
- acentuação, capitalização e mensagens de estado;
- comportamento em desktop e em viewport móvel;
- ausência de overflow horizontal e de erros no console.

## Publicação

O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica
a raiz da branch `main` no GitHub Pages após cada push.

Repositório: `SILVAThiagoFerreira/qaqc-desmonte`
Página: <https://silvathiagoferreira.github.io/qaqc-desmonte/>

A publicação só deve ser considerada concluída quando o workflow **Deploy
QAQC dashboard to GitHub Pages** estiver concluído com sucesso e a página
pública carregar a mesma versão de `index.html`, `styles.css`, `app.js`,
`config.js` e `data/sample.json` do commit publicado.
