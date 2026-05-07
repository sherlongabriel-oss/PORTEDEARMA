# 357

Bot WhatsApp com voz e texto, OpenAI e Supabase. O QR code deve ser usado apenas pelo usuario master.

## Requisitos
- Node 18+
- Conta Supabase (DB e Storage)
- Chave OpenAI

## Configuracao
1. Copie .env.example para .env e preencha.
2. Crie tabelas no Supabase usando o arquivo de schema.
3. Preencha as tabelas com os dados de delegacias, organizacoes militares e clubes.
	- Voce pode importar um CSV no Supabase usando o modelo em supabase/seed.template.csv.

### Busca web verificavel (Google Custom Search)
Para respostas mais confiaveis sobre noticias e atualizacoes, o bot pode consultar fontes externas e exigir convergencia de fontes.

1. Ative a `Custom Search API` no Google Cloud.
2. Gere uma `API Key` no projeto.
3. Crie um mecanismo no Programmable Search Engine e copie o `cx`.
4. Configure no `.env`:
	- `GOOGLE_API_KEY`
	- `GOOGLE_CSE_ID`
	- `NEWS_SEARCH_ENABLED=true`
	- `NEWS_ALLOWED_DOMAINS=planalto.gov.br,in.gov.br,gov.br,stf.jus.br,stj.jus.br,camara.leg.br,senado.leg.br,g1.globo.com,uol.com.br,cnnbrasil.com.br`

Regra operacional da busca web:
- O bot so fecha afirmacao factual quando encontra ao menos 2 fontes confiaveis filtradas por dominio.
- Se nao houver convergencia, o bot responde com limite de confianca e pede recorte de data/orgao/norma.
- Quando houver fontes, o bot inclui links consultados na resposta.

## Base juridica oficial (MyShooting IA)
Para respostas juridicas verificaveis, alimente as tabelas de normas oficiais no Supabase.

### Fontes oficiais recomendadas
- Planalto: https://www.planalto.gov.br
- Diario Oficial da Uniao: https://www.in.gov.br
- Policia Federal (armas): https://www.gov.br/pf
- DFPC/Exercito: https://www.gov.br/dfpc

### Estrutura criada no schema
- `legal_sources`: catalogo de origem oficial
- `legal_norms`: leis/decretos/portarias/IN com vigencia
- `legal_articles`: artigos vinculados a cada norma
- `legal_admin_interpretations`: entendimentos administrativos documentados
- `legal_update_log`: trilha de alteracoes/importacoes

### Templates de importacao
- supabase/legal_sources.seed.template.csv
- supabase/legal_norms.seed.template.csv
- supabase/legal_articles.seed.template.csv
- supabase/legal_admin_interpretations.seed.template.csv

### Fluxo recomendado
1. Importar `legal_sources.seed.template.csv`.
2. Importar normas em `legal_norms.seed.template.csv` com URL oficial e status de vigencia.
3. Importar artigos relevantes em `legal_articles.seed.template.csv`.
4. Importar entendimentos administrativos em `legal_admin_interpretations.seed.template.csv`.
5. Atualizar periodicamente a partir do DOU e atos da PF/Exercito.

Regra operacional: se nao houver base oficial vigente cadastrada, a IA deve responder sem conclusao numerica e indicar ausencia de previsao expressa/necessidade de verificacao oficial.

## Desenvolvimento
- npm run dev

## Producao (Render)
- Build: npm run build
- Start: npm run start

## Observacoes
- O QR code aparece no log na primeira conexao.
- Somente o usuario master deve escanear o QR.
- O master e definido no primeiro QR conectado (ou via MASTER_PHONE se quiser fixar).
- Comando admin: "admin desconectar" encerra a sessao e limpa o master.
- Pagina admin: acesse a raiz do servico (/) para ver o QR e desconectar.
- Botao "Gerar novo QR" reinicia a sessao do WhatsApp e gera um novo QR.
- Os dados de conhecimento devem ser mantidos no Supabase.
- Voz TTS padrao configurada para masculina (`DEFAULT_VOICE=onyx`).

## Gestao de documentos CAC (WhatsApp)
Comandos disponiveis:
- `doc add <tipo-do-documento> <YYYY-MM-DD>`
- `doc list`
- `doc vencendo`

Exemplo:
- `doc add CR 2027-03-10`
- `doc add Habitualidade 2026-12-31`
