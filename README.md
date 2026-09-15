# QA/QC de Perfuração e Desmonte

Dashboard operacional para avaliar a conformidade entre o plano de fogo e a
execução da perfuração e do carregamento, classificar desvios e rastrear cada
furo.

## Visões

- **Micro**: análise por plano de fogo e por furo, com mapa, perfil de
  carregamento, desvios, prioridades e tabela de controle.
- **Macro**: comparação consolidada entre desmontes, com indicadores,
  tendência, desvios médios, composição dos status e resumo por evento.

Fluxo de leitura: **Dados → Seleção → Conformidade → Desvios → Verificação**.

## Terminologia e unidades

- Planejamento: plano de fogo, malha de perfuração, afastamento, espaçamento e
  subperfuração.
- Execução: profundidade executada, carga carregada, tampão e tempo de
  iniciação.
- Classificação: conforme, em revisão, fora da faixa e não avaliável.
- Unidades: profundidade, tampão e subperfuração em **m**; carga em **kg**;
  tempo de iniciação em **ms**. A unidade do diâmetro permanece não informada
  enquanto a fonte não confirmar sua convenção.

A terminologia foi revisada com apoio dos materiais técnicos fornecidos sobre
QA/QC em operações de mineração. Esses materiais orientam a linguagem, mas
não transformam resultados históricos em metas universais.

## Critérios de avaliação

- Profundidade: desvio relativo de até **±10%**.
- Carga: desvio relativo de até **±20%**.
- Tampão: diferença absoluta de até **±0,5 m**.

Os resultados indicam pontos para verificação. Não substituem o plano de fogo,
o procedimento operacional, a inspeção de campo ou os critérios normativos
vigentes.

## Fonte e atualização

A fonte operacional é a pasta configurada no Google Drive. O carregamento
inicial, o botão **Atualizar dados** e a consulta automática periódica leem
as planilhas disponíveis nessa pasta. Quando há mais de um arquivo, o
dashboard combina os registros e elimina duplicidades pela versão mais
recente.

A base local em [`data/sample.json`](data/sample.json) é apenas uma referência
de inicialização e contingência para manter a tela utilizável durante uma
resposta lenta ou indisponibilidade temporária do Drive. Os dados remotos
substituem essa base assim que a integração responde.

A integração lê arquivos `.xlsx`, `.xls` e `.csv` diretamente contidos na
pasta configurada. Como o dashboard é público, não inclua colunas sensíveis
nas planilhas de origem.

Para configurar a integração em outro ambiente:

1. Crie um projeto no Google Apps Script.
2. Publique [`integrations/google-drive-sync/Code.gs`](integrations/google-drive-sync/Code.gs)
   como aplicativo da Web, executando como proprietário e permitindo acesso a
   qualquer pessoa.
3. Atualize a URL `/exec` de `driveIndexUrl` em [`config.js`](config.js).

## Filtros e interações

Na visão Micro, os filtros combinam nome ou código do plano, tipo, data,
status e intervalos numéricos. Cada intervalo usa dois marcadores arrastáveis
e aparece somente quando há variação no recorte. O campo da tabela filtra por
ID do furo.

Os pontos do mapa, da dispersão, dos tempos de iniciação e da visão Macro são
selecionáveis por clique ou teclado. Dicas contextuais mostram o ponto;
as barras de classificação filtram a fila de verificação. A atualização
recalcula indicadores, gráficos, mapa e tabelas em conjunto.

## Desenvolvimento local

```powershell
npm install
npm test
npm run check
python -m http.server 4173
```

Acesse `http://localhost:4173/`. Para testar uma integração do Drive sem
alterar o repositório, acrescente `?drive=<URL_ENCODED_DA_INTEGRACAO>` à rota.

Antes de publicar, execute:

```powershell
npm test
npm run check
node --check config.js
git diff --check
```

Também confira no navegador: carregamento remoto, atualização, filtros,
seleção de furos, dicas contextuais, tabela, acentuação, viewport móvel, ausência de
rolagem horizontal involuntária e ausência de erros no console. Na visão Macro,
confira a seleção de pontos e barras, os filtros de plano e data e o estado de
comparabilidade entre eventos.

## Publicação

O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica
a branch `main` no GitHub Pages.

- Repositório: `SILVAThiagoFerreira/qaqc-desmonte`
- Micro: <https://silvathiagoferreira.github.io/qaqc-desmonte/>
- Macro: <https://silvathiagoferreira.github.io/qaqc-desmonte/macro.html>

A publicação só é considerada concluída quando o workflow **Deploy QAQC
dashboard to GitHub Pages** termina com sucesso e as duas rotas carregam os
arquivos do commit publicado.
