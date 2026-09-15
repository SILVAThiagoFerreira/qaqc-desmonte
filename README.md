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

As unidades operacionais configuradas no painel são: profundidade, tampão e
subperfuração em metros (`m`); carga em quilogramas (`kg`); e tempo de
iniciação em milissegundos (`ms`). O diâmetro permanece identificado como
unidade não informada porque a planilha atual não confirma sua convenção.

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
- tampão: desvio absoluto de até ±0,5 m.

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
pasta configurada. Para evitar uma tela vazia durante uma resposta lenta, o
fixture local é exibido imediatamente com o status **Atualizando dados**; assim
que a ponte responde, ele é substituído pelos dados atuais do Drive. Se a
ponte estiver indisponível, o dashboard mantém os dados visíveis e sinaliza a
fonte alternativa.

Para recriar a ponte em outra conta ou ambiente:

1. Crie um projeto vazio no Google Apps Script.
2. Cole [`integrations/google-drive-sync/Code.gs`](integrations/google-drive-sync/Code.gs).
3. Publique como Web app, executando como o proprietário, com acesso para
   qualquer pessoa.
4. Substitua a URL `/exec` em `driveIndexUrl`, no arquivo `config.js`.

O script lê apenas arquivos `.xlsx`, `.xls` e `.csv` filhos diretos da pasta
configurada. A atualização não exige novo deploy do GitHub Pages quando o
conteúdo de uma planilha é alterado no Drive.

O seletor de arquivo não é exposto na interface operacional. O dashboard
combina automaticamente as planilhas encontradas na pasta configurada; a
origem continua sendo atualizada pelo botão **Atualizar dados** no cabeçalho e
pelo polling periódico.

O endpoint retorna a planilha em base64 para preservar a leitura privada da
fonte no servidor Apps Script. Não coloque colunas sensíveis no mesmo arquivo
se a URL do dashboard for pública.

## Filtros operacionais

A barra lateral concentra o recorte da análise em controles curtos e
combináveis:

- busca por nome ou código do plano de fogo;
- tipo de desmonte, data do desmonte e classificação de conformidade;
- intervalos numéricos com dois marcadores arrastáveis, exibidos apenas para
  colunas com variação real no recorte carregado e organizados em painéis
  compactos; a profundidade executada fica aberta como referência inicial.

Os intervalos atualmente disponíveis incluem profundidade planejada e
executada, carga planejada e carregada, tampão planejado e executado e tempo
de iniciação, quando essas colunas apresentam valores distintos. Os gráficos,
indicadores, mapa e tabela são recalculados em conjunto a cada alteração. O
campo de busca por ID do furo permanece disponível na tabela para uma consulta
pontual. Quando a origem disponibiliza uma coluna específica de nome do plano,
a busca também a utiliza; caso contrário, o código da coluna `Plano` permanece
como identificador exibido.

## Visão macro para gestão

A rota [`macro.html`](macro.html) permanece no mesmo repositório e no mesmo
deploy do GitHub Pages. Ela consolida os registros por evento operacional,
considerando data, horário, plano e tipo de desmonte, e mantém a visão por furo
disponível na página Micro.

A visão macro apresenta:

- quantidade de desmontes e furos consolidados;
- cobertura do QA/QC, conformidade consolidada e furos fora da faixa;
- série histórica interativa da conformidade;
- desvios médios de profundidade e carga, com leitura do tampão em `m`;
- distribuição de furos conformes, em revisão e fora da faixa;
- tabela executiva por desmonte, com data, horário, plano, tipo, contagens,
  conformidade e desvios;
- filtros independentes por plano de fogo e data do desmonte.

Os pontos e barras dos gráficos podem ser selecionados por clique ou teclado
para atualizar a leitura executiva e os valores do evento. A análise usa a
mesma ponte do Drive e o botão **Atualizar dados** reprocessa todas as
planilhas encontradas na pasta operacional, sem depender de arquivos locais do
computador do usuário.

Quando ainda há poucos eventos ou quando os planos não são comparáveis, o
painel exibe **Comparação inicial** e **Sinal não conclusivo**. Isso evita
classificar automaticamente uma diferença entre planos distintos como melhora
ou piora do processo. À medida que novos desmontes comparáveis forem
incorporados ao Drive, a série passa a suportar a leitura de melhora, piora ou
estabilidade frente ao evento anterior.

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
campos obrigatórios, a unicidade dos IDs, a configuração das unidades e a
presença estrutural da visão macro.

Também é necessário abrir a aplicação servida por HTTP e conferir:

- carregamento da base, indicadores e gráficos;
- filtros, seleção de furos, tooltips e tabela;
- filtro por status acionado pela distribuição da conformidade;
- acentuação, capitalização e mensagens de estado;
- comportamento em desktop e em viewport móvel;
- ausência de overflow horizontal e de erros no console.

Na visão macro, conferir também a quantidade de eventos, o estado de
comparabilidade, a seleção interativa dos pontos e barras, os filtros de plano
e data e a atualização pelo Drive.

## Publicação

O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica
a raiz da branch `main` no GitHub Pages após cada push.

Repositório: `SILVAThiagoFerreira/qaqc-desmonte`
Página: <https://silvathiagoferreira.github.io/qaqc-desmonte/>

A publicação só deve ser considerada concluída quando o workflow **Deploy
QAQC dashboard to GitHub Pages** estiver concluído com sucesso e as rotas
públicas `/` e `/macro.html` carregarem a mesma versão de `index.html`,
`macro.html`, `styles.css`, `app.js`, `macro.js`, `config.js` e
`data/sample.json` do commit publicado.
