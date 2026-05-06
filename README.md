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
- Os dados de conhecimento devem ser mantidos no Supabase.
